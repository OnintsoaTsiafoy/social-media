"""Contrôle de sécurité d'une proposition de réponse (Sprint 10 Jour 3).

Le contrôle s'applique **quel que soit le générateur** — local, modèle
distant, ou texte réécrit à la main par le community manager. C'est un point
important : la réécriture humaine est justement le moment où un engagement
non autorisé a le plus de chances d'apparaître, et un contrôle qui ne
s'appliquerait qu'aux sorties du modèle passerait à côté.

Deux niveaux, et un seul bloque :

- `blocking` — la réponse ne peut pas être approuvée en l'état. Réservé à ce
  qui engage juridiquement la marque ou expose une donnée personnelle.
- `warning` / `info` — signalé, l'humain décide. Un contrôle qui bloque trop
  serait contourné, donc inutile.

Les avertissements sont structurés (`code`, `severity`, `message`, `matches`)
et non de simples chaînes : l'écran mobile doit pouvoir les afficher et, à
terme, les traiter différemment selon le code.
"""
import re

from modules.nlp.language import detect_language
from modules.nlp.preprocessing import strip_accents

# Engagements qu'un community manager seul ne peut pas prendre au nom de la
# marque. Bloquants : ce sont eux qui transforment une réponse maladroite en
# litige commercial.
PROMISE_PATTERNS = [
    (r"\brembours\w*\s+(?:integral|immediat|total|sous)", "promesse de remboursement"),
    (r"\bnous vous rembours\w*", "promesse de remboursement"),
    (r"\bje vous rembours\w*", "promesse de remboursement"),
    (r"\bon te rembours\w*", "promesse de remboursement"),
    (r"\bnous vous garantis\w*", "garantie donnée au client"),
    (r"\bnous garantissons\b", "garantie donnée au client"),
    (r"\bc'est garanti\b", "garantie donnée au client"),
    (r"\bsous\s+\d+\s*(?:h|heures?|jours?)\b", "délai chiffré"),
    (r"\bdes demain\b", "délai chiffré"),
    (r"\bavant ce soir\b", "délai chiffré"),
    (r"\bgeste commercial\b", "compensation annoncée"),
    (r"\bbon d'achat\b", "compensation annoncée"),
    (r"\bdedommagement\b", "compensation annoncée"),
    (r"\bnous vous offrons\b", "compensation annoncée"),
]

# Données personnelles demandées ou exposées en public.
PERSONAL_DATA_PATTERNS = [
    (r"\b(?:numero de )?carte bancaire\b", "donnée bancaire"),
    (r"\biban\b", "donnée bancaire"),
    (r"\bcode (?:secret|pin|de securite)\b", "donnée bancaire"),
    (r"\bvotre mot de passe\b", "identifiant"),
    (r"\b[\w.+-]+@[\w-]+\.[\w.]+\b", "adresse e-mail en clair"),
    (r"\b0\d([ .-]?\d{2}){4}\b", "numéro de téléphone en clair"),
]

MARKDOWN_PATTERN = re.compile(r"(\*\*|^#{1,6}\s|^[-*]\s+\w|```)", re.MULTILINE)

_PROMISES = [(re.compile(pattern), label) for pattern, label in PROMISE_PATTERNS]
_PERSONAL = [(re.compile(pattern), label) for pattern, label in PERSONAL_DATA_PATTERNS]


def _warning(code: str, severity: str, message: str, matches: list[str] | None = None) -> dict:
    warning = {"code": code, "severity": severity, "message": message}
    if matches:
        warning["matches"] = sorted(set(matches))
    return warning


def check(
    *,
    text: str,
    brand: dict,
    language: str,
    max_characters: int,
) -> list[dict]:
    """Retourne la liste des avertissements. Vide = rien à signaler."""
    warnings: list[dict] = []
    stripped = (text or "").strip()

    if not stripped:
        return [
            _warning(
                "empty_response",
                "blocking",
                "La réponse est vide : il n'y a rien à envoyer.",
            )
        ]

    haystack = strip_accents(stripped.lower())

    forbidden_hits = [
        term
        for term in (brand.get("forbiddenTerms") or [])
        if term and term.strip() and strip_accents(term.strip().lower()) in haystack
    ]
    if forbidden_hits:
        # Bloquant : la marque a explicitement listé ces termes comme interdits,
        # c'est une décision qu'elle a déjà prise et que l'outil doit tenir.
        warnings.append(
            _warning(
                "forbidden_term",
                "blocking",
                "La réponse contient un terme interdit par les paramètres de la marque.",
                forbidden_hits,
            )
        )

    promise_hits = [label for pattern, label in _PROMISES if pattern.search(haystack)]
    if promise_hits:
        warnings.append(
            _warning(
                "unauthorised_promise",
                "blocking",
                "La réponse engage la marque (remboursement, garantie, délai ou compensation). "
                "Seul un responsable peut valider un tel engagement.",
                promise_hits,
            )
        )

    personal_hits = [label for pattern, label in _PERSONAL if pattern.search(haystack)]
    if personal_hits:
        warnings.append(
            _warning(
                "personal_data",
                "blocking",
                "La réponse contient ou réclame une donnée personnelle en public. "
                "Basculez en message privé.",
                personal_hits,
            )
        )

    if len(stripped) > max_characters:
        warnings.append(
            _warning(
                "too_long",
                "blocking",
                f"La réponse fait {len(stripped)} caractères pour un maximum de {max_characters}.",
            )
        )

    detected, confidence = detect_language(stripped)
    # La détection ne distingue que « français » et « autre chose » : on ne
    # peut donc signaler qu'un seul cas de façon honnête — une réponse censée
    # être en français qui ne l'est manifestement pas.
    if language == "fr" and detected == "other" and confidence > 0.3:
        warnings.append(
            _warning(
                "language_mismatch",
                "warning",
                "La réponse ne semble pas rédigée en français alors que c'est la langue demandée.",
            )
        )

    if not brand.get("emojisAllowed") and any(ord(char) > 0x2000 for char in stripped):
        warnings.append(
            _warning(
                "emoji_not_allowed",
                "warning",
                "La marque n'autorise pas les emojis dans ses réponses.",
            )
        )

    if MARKDOWN_PATTERN.search(stripped):
        # Facebook et Instagram n'interprètent pas le Markdown : les astérisques
        # s'afficheraient tels quels dans la réponse publique.
        warnings.append(
            _warning(
                "markdown_formatting",
                "warning",
                "La réponse contient de la mise en forme Markdown, qui s'affichera telle quelle "
                "sur Facebook et Instagram.",
            )
        )

    return warnings


def is_blocked(warnings: list[dict]) -> bool:
    return any(warning.get("severity") == "blocking" for warning in warnings)

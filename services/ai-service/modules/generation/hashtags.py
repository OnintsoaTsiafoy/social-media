"""Génération de hashtags à partir du texte d'une publication (Sprint 10 Jour 5).

Extraction déterministe, **sans modèle de langue**, y compris quand
`AI_GENERATION_MODE=llm`. C'est une limite assumée et non un oubli : les
hashtags proposés ici sont tirés du texte que l'auteur vient d'écrire et des
termes recommandés de la marque. Ils sont donc toujours pertinents et jamais
inventés, mais ils ne proposeront pas de thématique que le texte ne contient
pas déjà (« #madeinfrance » ne sortira pas d'un post qui ne parle pas de
fabrication). L'écran laisse de toute façon le community manager en ajouter à
la main, et ses ajouts sont préservés (voir `preserve`).

La normalisation reproduit exactement `normaliseHashtag()` du mobile
(social-media/src/lib/validation.ts) : deux implémentations qui divergeraient
produiraient des doublons invisibles (« #Été » et « #ete » comptés séparément).
"""
import re
from collections import Counter

from modules.nlp.preprocessing import strip_accents

EXISTING_HASHTAG_RE = re.compile(r"#(\w+)", re.UNICODE)
WORD_RE = re.compile(r"[^\W\d_]{3,}", re.UNICODE)
NON_ALNUM_RE = re.compile(r"[^a-z0-9_]")

MIN_WORD_LENGTH = 4

# Mots vides français et anglais. Volontairement large sur les verbes et
# auxiliaires courants : un hashtag « #nous » ou « #avec » est du bruit.
STOPWORDS = {
    "alors", "aucun", "aussi", "autre", "avant", "avec", "avoir", "bien", "cela",
    "cette", "ceux", "chaque", "comme", "dans", "depuis", "deux", "donc", "dont",
    "elle", "elles", "encore", "entre", "etait", "etre", "faire", "fait", "fois",
    "grace", "ici", "jamais", "leur", "leurs", "mais", "meme", "moins", "notre",
    "nous", "pour", "plus", "peut", "pendant", "quand", "quel", "quelle", "sans",
    "sera", "seront", "sous", "sur", "tous", "tout", "toute", "toutes", "tres",
    "trop", "vers", "votre", "vos", "vous", "etes", "sont", "chez", "afin",
    "deja", "toujours", "beaucoup", "vraiment", "nouveau", "nouvelle", "petit",
    "grand", "bonne", "bonjour", "merci", "aujourd", "hui", "ainsi", "celui",
    "about", "after", "again", "also", "been", "before", "being", "between",
    "from", "have", "here", "into", "just", "more", "most", "only", "other",
    "over", "same", "some", "such", "than", "that", "then", "there", "these",
    "they", "this", "through", "very", "were", "what", "when", "where", "which",
    "while", "with", "your", "yours",
}


def normalise(raw: str) -> str:
    """`Été 2026!` → `#ete2026`, comme le mobile."""
    cleaned = NON_ALNUM_RE.sub("", strip_accents(raw.strip().lstrip("#")).lower())
    return f"#{cleaned}" if cleaned else ""


def _candidates(text: str) -> list[str]:
    words = [word for word in WORD_RE.findall(text)]
    scored: Counter[str] = Counter()
    order: dict[str, int] = {}

    for position, word in enumerate(words):
        key = strip_accents(word.lower())
        if len(key) < MIN_WORD_LENGTH or key in STOPWORDS:
            continue
        scored[key] += 1
        order.setdefault(key, position)

    # Fréquence décroissante, puis longueur décroissante (un mot long est plus
    # spécifique donc plus utile comme hashtag), puis ordre d'apparition — les
    # trois critères rendent le classement total, donc reproductible.
    return sorted(scored, key=lambda key: (-scored[key], -len(key), order[key]))


def _bigrams(text: str) -> list[str]:
    """Paires de mots pleins adjacents : « collection été » → `#collectionete`."""
    words = [strip_accents(word.lower()) for word in WORD_RE.findall(text)]
    pairs = []
    for first, second in zip(words, words[1:]):
        if first in STOPWORDS or second in STOPWORDS:
            continue
        if len(first) < MIN_WORD_LENGTH or len(second) < MIN_WORD_LENGTH:
            continue
        pairs.append(f"{first}{second}")
    return pairs


def generate(
    *,
    text: str,
    brand: dict | None = None,
    preserve: list[str] | None = None,
    limit: int = 15,
) -> list[str]:
    """Retourne une liste de hashtags normalisés, sans doublon, plafonnée.

    `preserve` (les hashtags déjà choisis par le community manager) passe
    toujours en tête et n'est jamais évincé par le plafond : une régénération
    ne doit pas faire disparaître ce que l'utilisateur a saisi — risque
    explicite de la fiche du sprint.
    """
    brand = brand or {}
    result: list[str] = []

    def add(value: str) -> None:
        tag = normalise(value)
        if tag and tag not in result and len(result) < limit:
            result.append(tag)

    for tag in preserve or []:
        add(tag)

    # Les hashtags déjà écrits dans le texte de la publication comptent comme
    # un choix de l'auteur, au même titre que ceux qu'il a sélectionnés.
    for match in EXISTING_HASHTAG_RE.findall(text or ""):
        add(match)

    # Mots simples et paires alternés, en commençant par les mots. Les mots
    # sont classés par fréquence réelle, les paires seulement par position :
    # enchaîner toutes les paires d'abord poussait « #troispieces » devant
    # « #collection » dès que le plafond était bas.
    words = _candidates(text or "")
    pairs = _bigrams(text or "")
    for index in range(max(len(words), len(pairs))):
        if index < len(words):
            add(words[index])
        if index < len(pairs):
            add(pairs[index])

    for term in brand.get("recommendedTerms") or []:
        add(term)

    return result


def keywords(text: str, limit: int = 6) -> list[str]:
    """Mots-clés bruts (sans « # »), pour l'encart « Mots-clés détectés »."""
    return _candidates(text or "")[:limit]

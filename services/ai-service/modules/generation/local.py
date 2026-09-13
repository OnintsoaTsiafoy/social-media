"""Générateur déterministe piloté par les réglages de marque.

Même précédent que `services/shared/social-provider.js` (Sprint 04) : un
connecteur local et reproductible permet de démontrer et de tester tout le
cycle sans dépendre d'un service externe. Ici, cela signifie surtout que la
démonstration du sprint fonctionne **hors ligne et sans clé d'API**, et que
les tests de cohérence portent sur des sorties stables plutôt que sur les
réponses d'un modèle qui change d'une exécution à l'autre.

Ce n'est pas un modèle de langue : il compose des fragments (voir
`templates.py`) en fonction de l'analyse et des réglages de marque. Ses
limites sont donc connues et assumées — notamment le ton `custom`, décrit en
texte libre, qu'aucune composition déterministe ne peut appliquer.
"""
from modules.generation.templates import (
    EMOJI_BY_SENTIMENT,
    EN,
    FR_TU,
    FR_VOUS,
    TONE_PREFIX,
)

GENERATOR_NAME = "local-template-1.0.0"
SUPPORTED_LANGUAGES = ("fr", "en")

LENGTH_TO_SENTENCES = {"1 phrase": 1, "2 phrases": 2, "3 phrases": 3}
DEFAULT_SENTENCES = 2


def _register(language: str, formality: str) -> dict:
    if language == "en":
        return EN
    # `adaptive` reste au vouvoiement : c'est le choix sûr par défaut en
    # relation client francophone, le tutoiement doit être demandé.
    return FR_TU if formality == "informal" else FR_VOUS


def _first_name(author_name: str | None) -> str | None:
    if not author_name:
        return None
    parts = [part for part in author_name.strip().split() if part]
    return parts[0] if parts else None


def _sentence_budget(target_length: str | None) -> int | None:
    if target_length in LENGTH_TO_SENTENCES:
        return LENGTH_TO_SENTENCES[target_length]
    if target_length == "Libre":
        return None
    return DEFAULT_SENTENCES


def _capitalise(sentence: str) -> str:
    return sentence[:1].upper() + sentence[1:] if sentence else sentence


def generate(
    *,
    brand: dict,
    analysis: dict | None,
    author_name: str | None,
    language: str,
    tone: str,
    instruction: str | None,
) -> tuple[str, list[dict]]:
    """Retourne `(texte, avertissements)`.

    Les avertissements ne sont pas des erreurs : ils disent au community
    manager ce que le générateur n'a **pas** su appliquer, plutôt que de le
    laisser croire que sa consigne a été prise en compte.
    """
    warnings: list[dict] = []

    if language not in SUPPORTED_LANGUAGES:
        warnings.append(
            {
                "code": "language_not_supported",
                "severity": "warning",
                "message": (
                    f"Le générateur local ne rédige qu'en français et en anglais ; "
                    f"réponse produite en français au lieu de « {language} »."
                ),
            }
        )
        language = "fr"

    formality = brand.get("formality") or "adaptive"
    register = _register(language, formality)

    sentiment = (analysis or {}).get("sentiment", "neutral")
    intent = (analysis or {}).get("intent", "other")
    urgent = bool((analysis or {}).get("urgent"))

    if tone == "custom":
        # Le ton personnalisé est une consigne en texte libre ; la composition
        # par fragments ne peut pas s'y conformer. Le dire est préférable à
        # produire une réponse au ton neutre en laissant croire le contraire.
        warnings.append(
            {
                "code": "custom_tone_not_applied",
                "severity": "info",
                "message": (
                    "Le ton personnalisé de la marque n'est pas appliqué par le générateur "
                    "local : la réponse suit le ton professionnel par défaut."
                ),
            }
        )

    # Chaque phrase porte un rang d'importance. L'ordre de la LISTE est l'ordre
    # de lecture ; le rang ne sert qu'à choisir quoi sacrifier quand la marque
    # impose une longueur courte. Tronquer bêtement par la fin supprimerait le
    # fond du message (« nous prenons votre dossier en charge ») en gardant
    # l'ornement (« nous comprenons votre frustration »).
    RANK_URGENT, RANK_ACK, RANK_BODY = 2, 3, 4
    sentences: list[tuple[int, str]] = []

    # Un ton ne s'exprime pas en AJOUTANT une phrase — il change la formulation.
    # L'empathie remplace donc l'accusé de réception standard au lieu de le
    # précéder : ajoutée en plus, elle était systématiquement la première
    # sacrifiée par la limite de longueur, et le ton choisi par la marque
    # n'apparaissait jamais dans les réponses courtes.
    prefix = TONE_PREFIX.get(tone, {})
    if prefix and sentiment == "negative":
        key = "en" if language == "en" else ("fr_tu" if register is FR_TU else "fr")
        acknowledgement = prefix[key]
    else:
        acknowledgement = register["ack"].get(
            (sentiment, intent), register["ack"][("neutral", "other")]
        )
    sentences.append((RANK_ACK, _capitalise(acknowledgement)))

    if urgent:
        sentences.append((RANK_URGENT, register["urgent"]))

    if instruction and instruction.strip():
        sentences.append((RANK_BODY, _capitalise(instruction.strip().rstrip(".") + ".")))
    else:
        sentences.append((RANK_BODY, register["body"].get(intent, register["body"]["other"])))

    budget = _sentence_budget(brand.get("targetLength"))
    if budget is not None and len(sentences) > budget:
        kept = sorted(
            sorted(range(len(sentences)), key=lambda index: -sentences[index][0])[:budget]
        )
        sentences = [sentences[index] for index in kept]

    # Les formules d'accueil et de clôture de la marque sont rédigées dans SA
    # langue : les réutiliser telles quelles dans une réponse en anglais
    # produirait un message bilingue (« Bonjour Alice, Thank you for… »). Hors
    # de la langue de la marque, on retombe donc sur les formules du registre.
    brand_language = (brand.get("language") or "fr").lower()
    use_brand_formulas = language == brand_language

    greeting_template = brand.get("greeting") if use_brand_formulas else None
    first_name = _first_name(author_name)
    if greeting_template:
        greeting = greeting_template.replace("{prénom}", first_name or "").replace(
            "{prenom}", first_name or ""
        )
        greeting = " ".join(greeting.split()).replace(" ,", ",")
    else:
        greeting = (
            register["greeting"].format(name=first_name)
            if first_name
            else register["greeting_anonymous"]
        )

    closing = (brand.get("closing") if use_brand_formulas else None) or register["closing"]

    body = " ".join(sentence.strip() for _, sentence in sentences if sentence.strip())

    if brand.get("emojisAllowed") and tone in ("friendly", "empathetic"):
        body += EMOJI_BY_SENTIMENT.get(sentiment, "")

    text = f"{greeting} {body} {closing}".strip()
    return " ".join(text.split()), warnings

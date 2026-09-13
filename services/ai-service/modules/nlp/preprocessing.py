"""Normalisation du texte, partagée par l'entraînement et l'inférence.

C'est volontairement le *même* module aux deux étapes : un prétraitement qui
diverge entre `training/` et le service est la façon la plus courante de
produire un modèle dont les métriques hors ligne ne se retrouvent jamais en
production. `normalise()` est donc importé par `training/train.py` comme par
`modules/nlp/pipeline.py`, jamais réimplémenté.
"""
import re
import unicodedata

URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
MENTION_RE = re.compile(r"@\w+")
HASHTAG_RE = re.compile(r"#(\w+)")
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")
# Numéro français écrit avec ou sans séparateurs, et suites de chiffres longues
# (numéros de commande, de dossier) : le chiffre exact n'a aucune valeur
# prédictive, sa *présence* en a une (un commentaire qui cite un numéro de
# dossier est presque toujours une réclamation).
PHONE_RE = re.compile(r"\b0\d([ .-]?\d{2}){4}\b")
ORDER_RE = re.compile(r"\b(?:n°|no|#)\s?[a-z]?-?\d{3,}\b|\b\d{4,}\b", re.IGNORECASE)
NUMBER_RE = re.compile(r"\b\d+\b")
REPEAT_RE = re.compile(r"(.)\1{2,}")
SPACE_RE = re.compile(r"\s+")

POSITIVE_EMOJIS = set(
    "❤️😍😘🥰😻💖💕💗💓💞💘💝❤🧡💛💚💙💜🤍🖤🤎👍👏🙌🙏😊😃😄😁😆😀🤩🥳🎉🎊✨🌟⭐🔥"
    "💪🥇🏆🏅🎯💯👌🤗😋🤤🥂🍾🌈🌸🌼🌻🌺🌹💐🥹😌💫🎩🎨🎂🎁🥐☕🍀💛💫🧡"
)
NEGATIVE_EMOJIS = set("😡🤬😠👎😤😩😖😞😔😢😭💔🤮🤢😒🙄😑😬⚠️❌🚫💩")

# Marqueurs de négation français. Le français a une négation discontinue
# (« ne … pas »), donc les deux moitiés déclenchent la portée : « jamais reçu »
# et « ne recommande pas » doivent toutes deux produire des tokens niés.
NEGATION_CUES = {
    "ne", "n", "pas", "plus", "jamais", "rien", "aucun", "aucune", "aucuns",
    "aucunes", "ni", "sans", "personne", "nul", "nulle",
}
NEGATION_SCOPE = 3
# Fin de proposition : la négation ne traverse pas une ponctuation forte.
CLAUSE_BREAK = {".", ",", ";", "!", "?", ":", "…"}

TOKEN_RE = re.compile(r"\w+|[.,;!?:…]", re.UNICODE)


def strip_accents(value: str) -> str:
    return "".join(
        char for char in unicodedata.normalize("NFD", value)
        if unicodedata.category(char) != "Mn"
    )


def _emoji_tokens(text: str) -> list[str]:
    tokens = []
    for char in text:
        if char in POSITIVE_EMOJIS:
            tokens.append("emopos")
        elif char in NEGATIVE_EMOJIS:
            tokens.append("emoneg")
        elif ord(char) > 0x2000 and unicodedata.category(char) == "So":
            tokens.append("emoother")
    return tokens


def apply_negation(tokens: list[str]) -> list[str]:
    """Préfixe `neg_` les tokens sous la portée d'une négation.

    Sans ça, « je recommande » et « je ne recommande pas » partagent leurs
    tokens les plus discriminants et deviennent indistinguables pour un modèle
    sac-de-mots.
    """
    result: list[str] = []
    remaining = 0
    for token in tokens:
        if token in CLAUSE_BREAK:
            remaining = 0
            continue
        if remaining > 0:
            result.append(f"neg_{token}")
            remaining -= 1
        else:
            result.append(token)
        if token in NEGATION_CUES:
            remaining = NEGATION_SCOPE
    return result


def normalise_for_rules(text: str) -> str:
    """Normalisation *légère*, pour la correspondance lexicale des règles.

    Distincte de `normalise()` et pas un détail : la normalisation ML préfixe
    les tokens niés (« toujours pas » devient « neg_toujours neg_pas ») et
    remplace les nombres, ce qui détruit exactement les expressions que les
    lexiques d'urgence cherchent. Les règles gardent donc la ponctuation, les
    nombres et l'ordre des mots ; seuls la casse, les accents, les apostrophes
    typographiques et les données personnelles sont uniformisés.
    """
    if not text:
        return ""
    working = text.replace("’", "'").lower()
    working = URL_RE.sub(" tokurl ", working)
    working = EMAIL_RE.sub(" tokemail ", working)
    working = PHONE_RE.sub(" tokphone ", working)
    working = strip_accents(working)
    return SPACE_RE.sub(" ", working).strip()


def normalise(text: str) -> str:
    """Texte brut → chaîne normalisée donnée au vectoriseur.

    Les entités dont la *valeur* ne porte pas d'information mais dont la
    *présence* en porte (URL, mention, e-mail, téléphone, numéro de dossier)
    sont remplacées par un marqueur unique, ce qui évite en plus de faire
    entrer des données personnelles dans le vocabulaire du modèle.
    """
    if not text:
        return ""

    emojis = _emoji_tokens(text)

    working = text.lower()
    working = URL_RE.sub(" tokurl ", working)
    working = EMAIL_RE.sub(" tokemail ", working)
    working = PHONE_RE.sub(" tokphone ", working)
    working = MENTION_RE.sub(" tokmention ", working)
    working = HASHTAG_RE.sub(r" tokhashtag \1 ", working)
    working = ORDER_RE.sub(" tokorder ", working)
    working = NUMBER_RE.sub(" toknum ", working)
    # « trooop » et « troop » doivent donner le même token ; on garde un
    # doublement (français : « bonne », « tellement ») mais pas au-delà.
    working = REPEAT_RE.sub(r"\1\1", working)
    working = strip_accents(working)

    tokens = TOKEN_RE.findall(working)
    tokens = apply_negation(tokens)
    tokens.extend(emojis)

    return SPACE_RE.sub(" ", " ".join(tokens)).strip()

"""Détection de langue minimale, volontairement sans dépendance.

Le dataset (voir `dataset/ANNOTATION_GUIDE.md`) est exclusivement francophone :
un modèle entraîné dessus classera un commentaire anglais ou espagnol avec une
confiance arbitraire, sans qu'aucune métrique ne le signale. Cette fonction
existe pour *refuser* ce cas plutôt que de produire une analyse inventée.

Elle ne cherche donc pas à identifier la langue réelle — seulement à répondre
« ce texte est-il du français ? » avec assez de prudence pour ne jamais
écarter un vrai commentaire français mal orthographié. En cas de doute, elle
répond `fr` : un faux négatif (français rejeté) coûte plus cher qu'un faux
positif (anglais analysé à tort, que la confiance basse signalera ensuite).
"""
import re

from modules.nlp.preprocessing import strip_accents

TOKEN_RE = re.compile(r"[a-z']+")

FRENCH_MARKERS = {
    "je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "le", "la",
    "les", "un", "une", "des", "du", "de", "et", "est", "sont", "pas", "ne",
    "que", "qui", "pour", "avec", "sur", "dans", "mais", "bonjour", "merci",
    "tres", "trop", "plus", "moins", "commande", "livraison", "produit",
    "votre", "vos", "mon", "ma", "mes", "ce", "cette", "ces", "toujours",
    "jamais", "rien", "avez", "etes", "faire", "fait", "bien", "chez", "au",
    "aux", "par", "sans", "quand", "comment", "pourquoi", "quel", "quelle",
    "est-ce", "s'il", "svp", "bjr", "vraiment", "encore", "depuis",
}

ENGLISH_MARKERS = {
    "the", "and", "is", "are", "you", "your", "my", "this", "that", "with",
    "for", "have", "has", "was", "were", "would", "could", "please", "thanks",
    "thank", "hello", "order", "delivery", "product", "shipping", "refund",
    "customer", "service", "when", "why", "how", "what", "very", "really",
    "never", "always", "still", "cannot", "don't", "doesn't", "i'm", "it's",
}

SPANISH_MARKERS = {
    "el", "los", "las", "una", "por", "para", "con", "pero", "muy", "gracias",
    "hola", "pedido", "entrega", "producto", "cuando", "como", "porque",
    "quiero", "tengo", "esta", "estoy", "buenos", "dias",
}


def detect_language(text: str) -> tuple[str, float]:
    """Retourne `(code, confiance)`, confiance dans [0, 1].

    `code` vaut `fr` ou `other` — jamais un code précis comme `en`, que rien
    ici ne permettrait d'affirmer honnêtement.
    """
    if not text or not text.strip():
        return "fr", 0.0

    tokens = TOKEN_RE.findall(strip_accents(text.lower()))
    if len(tokens) < 3:
        # Un « merci », un « ok » ou un commentaire d'emojis seuls ne portent
        # aucun signal de langue exploitable : on ne prétend pas trancher.
        return "fr", 0.0

    french = sum(1 for token in tokens if token in FRENCH_MARKERS)
    foreign = sum(1 for token in tokens if token in ENGLISH_MARKERS or token in SPANISH_MARKERS)

    if french == 0 and foreign >= 2:
        return "other", min(1.0, foreign / max(len(tokens), 1) * 2)
    if foreign > french * 2 and foreign >= 3:
        return "other", min(1.0, (foreign - french) / max(len(tokens), 1) * 2)
    return "fr", min(1.0, french / max(len(tokens), 1) * 2)

"""Urgence, sensibilité et priorité — par règles, pas par apprentissage.

Choix assumé (Sprint 09 Jour 3). Ces trois sorties ne sont pas apprises alors
que le sentiment et l'intention le sont, pour trois raisons :

1. **Trop peu d'exemples positifs.** 71 `urgent` et 51 `sensitive` sur 535 :
   un classifieur entraîné là-dessus apprendrait surtout à répondre « faux ».
2. **Le coût des erreurs est asymétrique.** Rater une allergie ou une mise en
   demeure coûte infiniment plus cher qu'une fausse alerte ; une règle permet
   de choisir ce compromis explicitement, un modèle le subit.
3. **Auditabilité.** Un community manager (et un juriste) peuvent lire la
   raison exacte d'une escalade. `matched_terms` la rend visible dans l'API.

Les listes restent donc du code lisible et testable, pas des poids. Elles sont
évaluées comme le reste (voir `training/evaluate.py`, qui mesure précision et
rappel de ces règles contre les annotations `urgent`/`sensitive`).
"""
import re

from modules.nlp.preprocessing import normalise_for_rules

Priority = str


def _pattern(terms: list[str]) -> re.Pattern:
    # Les termes sont écrits sans accent : le texte est désaccentué avant
    # comparaison, pour que « reglement » et « règlement » déclenchent pareil.
    return re.compile(r"|".join(rf"(?<![\w]){re.escape(term)}" for term in terms))


LEGAL_TERMS = [
    "avocat", "mise en demeure", "porter plainte", "porte plainte", "je porte plainte",
    "depose plainte", "deposer plainte", "tribunal", "justice", "juridique",
    "repression des fraudes", "dgccrf", "mediateur", "association de consommateurs",
    "ufc", "que choisir", "60 millions", "droit de retractation", "c'est illegal",
    "est illegal", "saisir la justice", "saisis la justice", "saisie la justice",
    "poursuite", "je conteste", "je vais signaler", "vais signaler", "je signale",
    "j'alerte", "alerte la",
    # « signaler » et « signalement » nus ont été retirés : ils déclenchaient
    # sur « rien à signaler, merci » et sur « Signalement : votre lien est
    # cassé » — deux messages sans le moindre enjeu juridique.
]

PUBLIC_THREAT_TERMS = [
    "je poste partout", "poste mon experience", "j'appelle la presse", "appeler la presse",
    "journaliste", "temoigner publiquement", "avis partout", "je balance",
]

NO_ANSWER_TERMS = [
    "aucune reponse", "toujours aucune reponse", "sans reponse", "personne ne repond",
    "personne ne me repond", "ne repond pas", "aucun retour", "toujours rien",
    "toujours pas", "je relance", "relance pour la", "3e fois", "4e fois",
    "troisieme fois", "quatrieme fois", "plusieurs messages", "5 messages",
    "aucune nouvelle", "aucune information", "aucune avancee", "ne sont plus lus",
    "personne ne decroche", "ne decroche", "raccroche au nez", "raccroche",
    "trois fois", "quatre fois", "deux fois de suite", "3 fois de suite",
    "encore d'attendre", "on me dit d'attendre", "jamais recu", "jamais arrive",
    "jamais livree", "jamais livre", "jamais expedie", "aucune explication",
    "impossible de joindre", "ne me repond", "rien recu", "n'ai rien recu",
    "jamais souscrit",
]

# Argent prélevé à tort : le préjudice est déjà réalisé et grandit tant que
# rien n'est fait, ce qui en fait une urgence au même titre qu'un blocage.
BILLING_TERMS = [
    "debite deux fois", "debitee deux fois", "preleve deux fois", "prelevee deux fois",
    "double prelevement", "double debit", "facture deux fois", "preleve alors que",
    "prelevee alors que", "debite alors que", "regulariser",
]

# Blocage opérationnel en cours : le client ne peut pas acheter, payer,
# accéder à son compte ou utiliser le produit *maintenant*. Ajouté après
# mesure sur l'ensemble de développement (le lexique initial n'en attrapait
# aucun), et reflété dans dataset/ANNOTATION_GUIDE.md.
OUTAGE_TERMS = [
    "en panne", "impossible de commander", "impossible de finaliser",
    "impossible de payer", "impossible de me connecter", "ne fonctionne plus",
    "ne s'allume plus", "ne marche plus", "plante a chaque", "plante", "site est down",
    "toujours en panne", "inutilisable", "hors service", "compte a ete suspendu",
    "compte suspendu", "n'arrive plus a me connecter", "a ete vole", "a ete pirate",
    "utilisee pour du spam", "site en panne",
    # « impossible d'installer » a été retiré : un montage bloqué par une pièce
    # manquante est une réclamation ordinaire, pas une panne de service.
]

# Durée d'attente citée par l'auteur. Une liste de termes ne peut pas
# distinguer « depuis 2 jours » de « depuis 2 mois » : c'est une mesure, pas
# un mot-clé, donc c'est traité par un calcul.
DURATION_RE = re.compile(
    r"(?:depuis|ca fait|il y a|au bout de|en attente de)\s+"
    r"(?:plus de\s+)?"
    r"(\d{1,3}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*"
    r"(minutes?|heures?|jours?|semaines?|mois|ans?|annees?)"
)
# « des mois » et « plusieurs semaines » ont été volontairement exclus : sans
# quantité, la tournure sert aussi bien à se plaindre qu'à féliciter
# (« jamais déçu depuis des années »), et elle produisait plus de fausses
# alertes qu'elle n'en rattrapait.
WORD_NUMBERS = {
    "un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4, "cinq": 5,
    "six": 6, "sept": 7, "huit": 8, "neuf": 9, "dix": 10,
}
UNIT_DAYS = {
    "minute": 0, "minutes": 0, "heure": 0, "heures": 0,
    "jour": 1, "jours": 1, "semaine": 7, "semaines": 7,
    "mois": 30, "an": 365, "ans": 365, "annee": 365, "annees": 365,
}
# Deux semaines : au-delà, l'attente sort de tout délai commercial annoncé et
# le dossier se dégrade (droit de rétractation, remboursement légal à 14 jours).
LONG_WAIT_DAYS = 14

# Une durée peut aussi mesurer une ancienneté de client, ce qui est en général
# le contraire d'une alerte (« client depuis 10 ans », « satisfaite après
# 2 ans d'utilisation »). Ces tournures annulent le signal d'attente.
LOYALTY_RE = re.compile(
    r"client(?:e)?\s+depuis|cliente?\s+fidele|abonne(?:e)?\s+depuis|"
    r"d'utilisation|de fidelite|fidele depuis|commande chez vous depuis"
)

DEADLINE_TERMS = [
    "avant demain", "avant samedi", "avant vendredi", "avant noel", "pour noel",
    "demain matin", "demain soir", "en urgence", "urgent", "urgente",
    "immediatement", "au plus vite", "mariage", "anniversaire de ma fille",
    "anniversaire de mon fils", "je pars en voyage", "intervention medicale",
    "veux annuler", "annuler ma commande", "annuler la seconde",
    # « ce soir », « aujourd'hui » et « avant expédition » ont été retirés :
    # ils déclenchaient sur « à quelle heure ferme la boutique ce soir ? » et
    # sur « possible de modifier ma commande avant expédition ? ».
]

# Santé : deux niveaux distincts, parce qu'ils n'appellent pas la même chose.
# Un **incident** (quelqu'un a été blessé ou est tombé malade) est urgent ET
# sensible. Un **contexte** de santé (« je suis diabétique », « convient aux
# femmes enceintes ? ») impose une relecture humaine — donc sensible — mais
# n'a aucune raison d'être traité en urgence : c'est une question, pas un
# accident. Les confondre envoyait toutes les questions d'allergène en tête
# de file d'attente.
HEALTH_INCIDENT_TERMS = [
    "allergi", "allergique", "hospitalis", "urgences", "malade", "intoxic",
    "blesse", "blessee", "blessure", "coupe avec", "brulure", "brule", "pris feu",
    "a explose", "malaise", "reaction indesirable", "effet secondaire", "empoisonn",
    "perime", "perimee", "peremption", "dangereux",
]

HEALTH_CONTEXT_TERMS = [
    "diabetique", "enceinte", "femmes enceintes", "peaux sensibles", "gluten",
    "fruits a coque", "professionnels de sante", "mobilite reduite",
]

PERSONAL_DATA_TERMS = [
    "tokphone", "tokemail", "carte bancaire", "iban", "rib", "numero de carte",
    "mon adresse", "mes donnees", "donnees personnelles", "rgpd", "confidentialite",
]

MINOR_TERMS = [
    "ma fille de", "mon fils de", "mon enfant", "ma petite fille", "mon petit garcon",
    "mineur", "4 ans", "6 ans", "9 ans",
]

DISCRIMINATION_TERMS = [
    "raciste", "racisme", "sexiste", "sexisme", "discrimination", "harcelement",
    "homophobe", "insultes", "propos deplaces", "mon voile",
]

# Reproche d'exclusion (gamme de tailles, accessibilité) : à relire par un
# humain, mais ce n'est pas un incident de discrimination à traiter le jour
# même — séparé de DISCRIMINATION_TERMS pour cette seule raison.
EXCLUSION_TERMS = ["excluant", "exclut", "tailles plus grandes", "grandes tailles"]

# Accusation grave et nommée : le préjudice d'image est immédiat.
FRAUD_STRONG_TERMS = [
    "arnaque", "escroquerie", "c'est du vol", "vol pur", "contrefa", "frauduleux",
    "pirate", "piratage", "sans mon accord",
]

# Reproche de pratique commerciale déloyale : sensible (il engage la marque
# publiquement) mais pas urgent — rien ne s'aggrave en quelques heures.
FRAUD_SOFT_TERMS = [
    "mensonger", "publicite mensongere", "trompeur", "censure",
    "commentaires negatifs sont supprimes", "supprimez les avis",
    "avis clients qui derangent", "prix de reference a ete gonfle",
]

_MATCHERS: dict[str, tuple[re.Pattern, str]] = {
    "legal": (_pattern(LEGAL_TERMS), "menace juridique ou signalement"),
    "public_threat": (_pattern(PUBLIC_THREAT_TERMS), "menace de publicité négative"),
    "no_answer": (_pattern(NO_ANSWER_TERMS), "relance après absence de réponse"),
    "deadline": (_pattern(DEADLINE_TERMS), "échéance datée"),
    "outage": (_pattern(OUTAGE_TERMS), "blocage opérationnel en cours"),
    "billing": (_pattern(BILLING_TERMS), "prélèvement contesté"),
    "health_incident": (_pattern(HEALTH_INCIDENT_TERMS), "incident de santé ou de sécurité"),
    "health_context": (_pattern(HEALTH_CONTEXT_TERMS), "contexte de santé"),
    "personal_data": (_pattern(PERSONAL_DATA_TERMS), "données personnelles exposées"),
    "minor": (_pattern(MINOR_TERMS), "mineur concerné"),
    "discrimination": (_pattern(DISCRIMINATION_TERMS), "discrimination ou harcèlement"),
    "exclusion": (_pattern(EXCLUSION_TERMS), "reproche d'exclusion"),
    "fraud": (_pattern(FRAUD_STRONG_TERMS), "accusation de fraude"),
    "unfair_practice": (_pattern(FRAUD_SOFT_TERMS), "pratique commerciale contestée"),
}

URGENT_SIGNALS = (
    "legal", "public_threat", "no_answer", "deadline", "outage", "billing",
    "health_incident", "long_wait", "discrimination", "minor", "fraud",
)
SENSITIVE_SIGNALS = (
    "health_incident", "health_context", "personal_data", "minor", "discrimination",
    "exclusion", "legal", "fraud", "unfair_practice",
)


def _long_wait(haystack: str) -> int | None:
    """Durée d'attente citée, en jours, si elle dépasse `LONG_WAIT_DAYS`."""
    if LOYALTY_RE.search(haystack):
        return None
    longest = 0
    for quantity, unit in DURATION_RE.findall(haystack):
        value = WORD_NUMBERS.get(quantity) or (int(quantity) if quantity.isdigit() else 0)
        longest = max(longest, value * UNIT_DAYS.get(unit, 0))
    return longest if longest >= LONG_WAIT_DAYS else None


def match_signals(text: str) -> dict[str, str]:
    """Signaux déclenchés → libellé lisible, à partir du texte **brut**.

    La normalisation légère est faite ici plutôt que laissée à l'appelant :
    passer par erreur le texte normalisé pour le ML neutralisait silencieusement
    la moitié des lexiques (la négation y préfixe « toujours pas » en
    « neg_toujours neg_pas »), sans qu'aucune erreur ne soit levée.
    """
    haystack = normalise_for_rules(text)
    signals = {
        name: label
        for name, (pattern, label) in _MATCHERS.items()
        if pattern.search(haystack)
    }
    days = _long_wait(haystack)
    if days is not None:
        signals["long_wait"] = f"attente citée de plus de {LONG_WAIT_DAYS} jours"
    return signals


def is_urgent(signals: dict[str, str]) -> bool:
    return any(signal in signals for signal in URGENT_SIGNALS)


def is_sensitive(signals: dict[str, str]) -> bool:
    return any(signal in signals for signal in SENSITIVE_SIGNALS)


def compute_priority(sentiment: str, intent: str, urgent: bool, sensitive: bool) -> Priority:
    """Priorité de traitement — dérivée, jamais prédite directement.

    Une priorité apprise serait ininterprétable ; dérivée, elle reste stable
    quand un modèle est réentraîné et se justifie ligne à ligne devant le CM.
    """
    if urgent or sensitive:
        return "high"
    if sentiment == "negative" and intent == "claim":
        return "high"
    if sentiment == "negative" or intent in ("claim", "complaint"):
        return "medium"
    return "low"


RECOMMENDED_ACTIONS = {
    "claim": "Ouvrir un dossier et répondre avec le statut réel de la commande.",
    "complaint": "Accuser réception du mécontentement et proposer une solution concrète.",
    "info_request": "Répondre avec l'information demandée.",
    "question": "Répondre sur le fond, sans engagement commercial.",
    "other": "Remercier brièvement ou ne pas répondre.",
}


def recommend_action(intent: str, urgent: bool, sensitive: bool) -> str:
    if sensitive:
        return "Faire relire par un responsable avant toute réponse : sujet sensible."
    if urgent:
        return "Traiter en priorité aujourd'hui : le délai aggrave la situation."
    return RECOMMENDED_ACTIONS.get(intent, RECOMMENDED_ACTIONS["other"])


SENTIMENT_LABELS = {
    "positive": "Message positif",
    "neutral": "Message neutre",
    "negative": "Message négatif",
}

INTENT_LABELS = {
    "question": "question ouverte",
    "info_request": "demande d'information",
    "complaint": "mécontentement sans réclamation",
    "claim": "réclamation sur un cas personnel",
    "other": "message sans demande",
}


def build_explanation(
    sentiment: str,
    intent: str,
    signals: dict[str, str],
    top_terms: list[str],
    low_confidence: bool,
) -> str:
    """Explication lisible par un humain, jamais un score brut.

    `top_terms` vient des coefficients réels du modèle linéaire (voir
    `pipeline.explain_terms`) : c'est la vraie raison de la prédiction, pas une
    justification reconstruite après coup.
    """
    parts = [f"{SENTIMENT_LABELS[sentiment]}, classé comme {INTENT_LABELS[intent]}."]
    if top_terms:
        quoted = ", ".join(f"« {term} »" for term in top_terms)
        parts.append(f"Termes déterminants : {quoted}.")
    if signals:
        parts.append("Signaux détectés : " + ", ".join(sorted(set(signals.values()))) + ".")
    if low_confidence:
        parts.append("Confiance faible : à vérifier manuellement.")
    return " ".join(parts)

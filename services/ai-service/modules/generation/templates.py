"""Fragments de réponse du générateur local.

Séparés du générateur lui-même pour que relire « ce que la marque va dire »
ne demande pas de lire une logique de composition. Le tutoiement n'est pas
dérivé par transformation du vouvoiement (le français ne s'y prête pas) :
chaque registre a ses propres formulations.
"""

# Registres français : `vous` (vouvoiement) et `tu` (tutoiement).
FR_VOUS = {
    "greeting": "Bonjour {name},",
    "greeting_anonymous": "Bonjour,",
    "ack": {
        ("negative", "claim"): "nous sommes sincèrement désolés pour ce désagrément.",
        ("negative", "complaint"): "merci pour votre retour, nous comprenons votre déception.",
        ("negative", "question"): "merci pour votre question, et désolés pour la gêne occasionnée.",
        ("negative", "info_request"): "merci pour votre message, désolés pour la gêne occasionnée.",
        ("negative", "other"): "merci pour votre message, nous entendons votre remarque.",
        ("neutral", "claim"): "merci de nous avoir signalé ce point.",
        ("neutral", "complaint"): "merci pour votre retour.",
        ("neutral", "question"): "merci pour votre question.",
        ("neutral", "info_request"): "merci pour votre message.",
        ("neutral", "other"): "merci pour votre message.",
        ("positive", "claim"): "merci pour votre message et pour votre confiance.",
        ("positive", "complaint"): "merci pour votre retour constructif.",
        ("positive", "question"): "merci beaucoup pour votre message et pour votre question.",
        ("positive", "info_request"): "merci beaucoup pour votre message.",
        ("positive", "other"): "merci beaucoup pour votre message, cela nous touche.",
    },
    "body": {
        "claim": "Nous prenons votre dossier en charge et revenons vers vous avec le statut exact.",
        "complaint": "Nous transmettons votre remarque à l'équipe concernée.",
        "info_request": "Nous vous communiquons l'information demandée en message privé.",
        "question": "Nous vous répondons avec précision dès que possible.",
        "other": "Nous restons à votre disposition si besoin.",
    },
    "urgent": "Nous traitons votre demande en priorité.",
    "closing": "À très vite,",
}

FR_TU = {
    "greeting": "Bonjour {name},",
    "greeting_anonymous": "Bonjour,",
    "ack": {
        ("negative", "claim"): "on est vraiment désolés pour ce désagrément.",
        ("negative", "complaint"): "merci pour ton retour, on comprend ta déception.",
        ("negative", "question"): "merci pour ta question, et désolés pour la gêne.",
        ("negative", "info_request"): "merci pour ton message, désolés pour la gêne.",
        ("negative", "other"): "merci pour ton message, on entend ta remarque.",
        ("neutral", "claim"): "merci de nous avoir signalé ce point.",
        ("neutral", "complaint"): "merci pour ton retour.",
        ("neutral", "question"): "merci pour ta question.",
        ("neutral", "info_request"): "merci pour ton message.",
        ("neutral", "other"): "merci pour ton message.",
        ("positive", "claim"): "merci pour ton message et pour ta confiance.",
        ("positive", "complaint"): "merci pour ton retour constructif.",
        ("positive", "question"): "merci beaucoup pour ton message et pour ta question.",
        ("positive", "info_request"): "merci beaucoup pour ton message.",
        ("positive", "other"): "merci beaucoup pour ton message, ça nous touche.",
    },
    "body": {
        "claim": "On prend ton dossier en charge et on revient vers toi avec le statut exact.",
        "complaint": "On transmet ta remarque à l'équipe concernée.",
        "info_request": "On t'envoie l'information demandée en message privé.",
        "question": "On te répond avec précision dès que possible.",
        "other": "On reste dispo si besoin.",
    },
    "urgent": "On traite ta demande en priorité.",
    "closing": "À très vite,",
}

EN = {
    "greeting": "Hi {name},",
    "greeting_anonymous": "Hello,",
    "ack": {
        ("negative", "claim"): "we're truly sorry for the inconvenience.",
        ("negative", "complaint"): "thank you for your feedback, we understand your disappointment.",
        ("negative", "question"): "thank you for your question, and sorry for the trouble.",
        ("negative", "info_request"): "thank you for reaching out, and sorry for the trouble.",
        ("negative", "other"): "thank you for your message, we hear your point.",
        ("neutral", "claim"): "thank you for flagging this.",
        ("neutral", "complaint"): "thank you for your feedback.",
        ("neutral", "question"): "thank you for your question.",
        ("neutral", "info_request"): "thank you for reaching out.",
        ("neutral", "other"): "thank you for your message.",
        ("positive", "claim"): "thank you for your message and for your trust.",
        ("positive", "complaint"): "thank you for your constructive feedback.",
        ("positive", "question"): "thank you so much for your message and your question.",
        ("positive", "info_request"): "thank you so much for reaching out.",
        ("positive", "other"): "thank you so much for your message, it means a lot.",
    },
    "body": {
        "claim": "We're taking care of your case and will come back to you with the exact status.",
        "complaint": "We're passing your feedback on to the team concerned.",
        "info_request": "We'll send you the information you asked for by private message.",
        "question": "We'll get back to you with a precise answer as soon as possible.",
        "other": "We remain at your disposal if needed.",
    },
    "urgent": "We're handling your request as a priority.",
    "closing": "Talk soon,",
}

# Nuances de ton appliquées par-dessus le registre. `custom` n'apparaît pas :
# un ton décrit en texte libre ne peut pas être appliqué par un générateur
# déterministe — voir la note dans local.py.
TONE_PREFIX = {
    "empathetic": {
        "fr": "Nous comprenons votre frustration et nous en sommes désolés.",
        "fr_tu": "On comprend ta frustration et on en est désolés.",
        "en": "We understand your frustration and we're sorry about it.",
    },
}

EMOJI_BY_SENTIMENT = {"positive": " 😊", "neutral": " 🙂", "negative": ""}

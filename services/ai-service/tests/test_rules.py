import pytest

from modules.nlp.rules import (
    compute_priority,
    is_sensitive,
    is_urgent,
    match_signals,
    recommend_action,
)


def urgent(text: str) -> bool:
    return is_urgent(match_signals(text))


def sensitive(text: str) -> bool:
    return is_sensitive(match_signals(text))


@pytest.mark.parametrize(
    "text",
    [
        "Sans réponse d'ici lundi je saisis la répression des fraudes.",
        "Trois relances, zéro réponse. Je passe par mon avocat demain matin.",
        "Je poste mon expérience partout si personne ne répond.",
        "Personne ne décroche depuis ce matin, je relance pour la 4e fois.",
        "Le colis doit arriver avant samedi pour un mariage.",
        "Site en panne, impossible de finaliser ma commande.",
        "J'ai été débitée deux fois pour la même commande.",
        "Le produit a pris feu pendant la charge.",
        "Le vendeur m'a tenu des propos racistes en boutique.",
    ],
)
def test_urgent_signals_are_detected(text):
    assert urgent(text)


@pytest.mark.parametrize(
    "text",
    [
        "Bonjour, quels sont vos horaires le dimanche ?",
        "Magnifique collection, bravo à l'équipe !",
        "Je trouve le packaging un peu trop volumineux.",
        "À quelle heure ferme la boutique ce soir ?",
        "Rien à signaler, merci pour la livraison.",
    ],
)
def test_ordinary_comments_are_not_urgent(text):
    assert not urgent(text)


def test_long_wait_beyond_the_threshold_is_urgent():
    assert urgent("J'attends mon remboursement depuis 6 semaines.")


def test_short_wait_is_not_urgent():
    assert not urgent("Commande passée il y a 2 jours, tout va bien.")


def test_customer_tenure_is_not_a_wait():
    """« client depuis 10 ans » est une durée, mais c'est de la fidélité, pas
    une attente — le cas contraire remontait des clients satisfaits en tête
    de file."""
    assert not urgent("Je suis client depuis 10 ans et toujours ravi.")
    assert not urgent("Toujours aussi satisfaite après 2 ans d'utilisation.")


def test_health_incident_is_urgent_and_sensitive():
    text = "Le produit m'a provoqué une réaction allergique, j'ai dû aller aux urgences."

    assert urgent(text)
    assert sensitive(text)


def test_health_question_before_purchase_is_sensitive_but_not_urgent():
    """Une question sur un allergène engage la responsabilité de la marque
    (donc relecture humaine) mais personne n'est en danger : la traiter en
    urgence noierait les vraies urgences."""
    text = "Est-ce que la crème convient aux femmes enceintes ?"

    assert sensitive(text)
    assert not urgent(text)


@pytest.mark.parametrize(
    "text",
    [
        "Mon numéro 06 12 34 56 78 a été communiqué sans mon accord.",
        "Vous avez ma carte bancaire enregistrée sans mon accord.",
        "Ma fille de 9 ans a reçu des messages déplacés.",
        "Votre publicité est franchement sexiste.",
    ],
)
def test_sensitive_signals_are_detected(text):
    assert sensitive(text)


def test_unfair_practice_is_sensitive_without_being_urgent():
    text = "Vous annoncez -50% mais le prix de référence a été gonflé avant, c'est trompeur."

    assert sensitive(text)
    assert not urgent(text)


def test_signals_are_reported_with_readable_labels():
    signals = match_signals("Je porte plainte, mon fils de 6 ans a été blessé.")

    assert "legal" in signals
    assert "minor" in signals
    assert all(isinstance(label, str) and label for label in signals.values())


@pytest.mark.parametrize(
    "sentiment,intent,urgent_flag,sensitive_flag,expected",
    [
        ("negative", "claim", False, False, "high"),
        ("neutral", "info_request", True, False, "high"),
        ("positive", "other", False, True, "high"),
        ("negative", "complaint", False, False, "medium"),
        ("neutral", "claim", False, False, "medium"),
        ("neutral", "info_request", False, False, "low"),
        ("positive", "other", False, False, "low"),
    ],
)
def test_priority_is_derived_from_the_other_signals(
    sentiment, intent, urgent_flag, sensitive_flag, expected
):
    assert compute_priority(sentiment, intent, urgent_flag, sensitive_flag) == expected


def test_sensitive_action_takes_precedence_over_urgency():
    assert "relire" in recommend_action("claim", urgent=True, sensitive=True)
    assert "priorité" in recommend_action("claim", urgent=True, sensitive=False)

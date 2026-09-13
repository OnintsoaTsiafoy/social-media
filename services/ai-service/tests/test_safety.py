import pytest

from modules.safety.checks import check, is_blocked

BRAND = {
    "forbiddenTerms": ["remboursement immédiat", "garanti"],
    "emojisAllowed": True,
}


def codes(text: str, brand: dict | None = None, language: str = "fr", limit: int = 500) -> set[str]:
    return {
        warning["code"]
        for warning in check(text=text, brand=brand or BRAND, language=language, max_characters=limit)
    }


def blocking_codes(text: str, brand: dict | None = None) -> set[str]:
    warnings = check(text=text, brand=brand or BRAND, language="fr", max_characters=500)
    return {warning["code"] for warning in warnings if warning["severity"] == "blocking"}


def test_a_clean_response_raises_nothing():
    assert check(
        text="Bonjour Alice, merci pour votre message. Nous revenons vers vous rapidement.",
        brand=BRAND,
        language="fr",
        max_characters=500,
    ) == []


def test_empty_response_is_blocking():
    assert "empty_response" in blocking_codes("   ")


def test_forbidden_brand_term_is_blocking():
    """La marque a déjà pris cette décision : l'outil la tient."""
    assert "forbidden_term" in blocking_codes("Nous proposons un remboursement immédiat.")


def test_forbidden_term_matching_ignores_case_and_accents():
    assert "forbidden_term" in blocking_codes("REMBOURSEMENT IMMEDIAT possible.")


@pytest.mark.parametrize(
    "text",
    [
        "Nous vous remboursons dès aujourd'hui.",
        "C'est garanti, aucun souci.",
        "Nous traitons votre dossier sous 48h.",
        "Nous vous offrons un geste commercial.",
        "Un bon d'achat vous sera envoyé.",
    ],
)
def test_unauthorised_promises_are_blocking(text):
    """Ces phrases engagent juridiquement la marque : seul un responsable peut
    les valider, donc elles bloquent l'approbation."""
    assert "unauthorised_promise" in blocking_codes(text)


@pytest.mark.parametrize(
    "text",
    [
        "Merci de nous communiquer votre carte bancaire.",
        "Envoyez votre IBAN en commentaire.",
        "Écrivez-nous à contact@exemple.fr",
        "Appelez le 06 12 34 56 78",
    ],
)
def test_personal_data_in_public_is_blocking(text):
    assert "personal_data" in blocking_codes(text)


def test_too_long_is_blocking():
    assert "too_long" in blocking_codes("a" * 501)


def test_length_limit_is_configurable():
    assert "too_long" in codes("a" * 120, limit=100)
    assert "too_long" not in codes("a" * 80, limit=100)


def test_emoji_is_only_a_warning_when_the_brand_forbids_them():
    brand = {**BRAND, "emojisAllowed": False}
    warnings = check(text="Merci beaucoup 😊", brand=brand, language="fr", max_characters=500)

    assert [warning["code"] for warning in warnings] == ["emoji_not_allowed"]
    # Signalé mais non bloquant : un contrôle qui bloque trop serait contourné.
    assert not is_blocked(warnings)


def test_markdown_is_flagged_because_meta_does_not_render_it():
    assert "markdown_formatting" in codes("Merci **beaucoup** pour votre message.")


def test_an_english_response_is_flagged_when_french_was_requested():
    assert "language_mismatch" in codes(
        "Thank you for your message, we will get back to you as soon as possible."
    )


def test_a_french_response_is_not_flagged():
    assert "language_mismatch" not in codes(
        "Merci pour votre message, nous revenons vers vous dès que possible."
    )


def test_blocking_detection_reports_the_matches():
    warnings = check(
        text="Nous vous remboursons intégralement.",
        brand=BRAND,
        language="fr",
        max_characters=500,
    )
    promise = next(warning for warning in warnings if warning["code"] == "unauthorised_promise")

    assert promise["matches"]
    assert is_blocked(warnings)

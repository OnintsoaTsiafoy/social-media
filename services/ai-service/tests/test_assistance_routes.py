from fastapi.testclient import TestClient

from core.config import settings
from main import app
from tests.conftest import auth_header

GENERATE = "/internal/v1/responses/generate"
WORKFLOW = "/internal/v1/workflows/comment-assistance"
SAFETY = "/internal/v1/responses/safety-check"
HASHTAGS = "/internal/v1/hashtags/generate"

BRAND = {
    "name": "Studio Vega",
    "tone": "friendly",
    "language": "fr",
    "emojisAllowed": True,
    "targetLength": "2 phrases",
    "greeting": "Bonjour {prénom},",
    "closing": "À très vite !",
    "forbiddenTerms": ["remboursement immédiat"],
    "recommendedTerms": ["sur-mesure"],
}


def payload(**overrides):
    body = {
        "commentId": "c-1",
        "commentText": "Bonjour, vous livrez en Belgique ?",
        "authorName": "Alice Martin",
        "brand": BRAND,
    }
    body.update(overrides)
    return body


def scope() -> dict[str, str]:
    return auth_header(scope=["ai:generate"])


def test_generate_returns_a_complete_suggestion(client, service_jwt_settings):
    response = client.post(GENERATE, json=payload(), headers=scope())

    assert response.status_code == 200
    body = response.json()
    assert body["commentId"] == "c-1"
    suggestion = body["suggestion"]
    for field in ("text", "language", "tone", "generator", "promptVersion", "blocked", "action", "warnings"):
        assert field in suggestion, field
    assert suggestion["text"]
    assert suggestion["blocked"] is False


def test_generation_never_returns_an_action_that_sends(client, service_jwt_settings):
    action = client.post(GENERATE, json=payload(), headers=scope()).json()["suggestion"]["action"]

    assert action in ("propose", "escalate", "blocked")


def test_a_blocked_suggestion_is_returned_not_hidden(client, service_jwt_settings):
    """L'écran doit pouvoir montrer le texte ET la raison du blocage, sinon le
    community manager ne sait pas quoi corriger."""
    response = client.post(
        GENERATE,
        json=payload(instruction="proposer un remboursement immédiat"),
        headers=scope(),
    )

    suggestion = response.json()["suggestion"]
    assert suggestion["blocked"] is True
    assert suggestion["action"] == "blocked"
    assert suggestion["text"]
    assert any(warning["severity"] == "blocking" for warning in suggestion["warnings"])


def test_an_empty_comment_is_a_validation_error(client, service_jwt_settings):
    response = client.post(GENERATE, json=payload(commentText="   "), headers=scope())

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_failed"


def test_the_workflow_route_exposes_the_assembled_context(client, service_jwt_settings):
    response = client.post(WORKFLOW, json=payload(), headers=scope())

    assert response.status_code == 200
    body = response.json()
    assert body["analysis"]["sentiment"]
    assert body["priority"] in ("low", "medium", "high")
    assert "marque=Studio Vega" in body["context"]
    assert body["suggestion"]["text"]


def test_the_workflow_keeps_the_history_it_was_given(client, service_jwt_settings):
    """Le service ne va jamais chercher d'historique lui-même : il ne voit que
    ce qu'Express a décidé d'envoyer."""
    response = client.post(
        WORKFLOW,
        json=payload(history=[{"author": "marque", "text": "Bonjour, nous vérifions."}]),
        headers=scope(),
    )

    assert "historique=1" in response.json()["context"]


def test_more_history_than_allowed_is_rejected(client, service_jwt_settings):
    response = client.post(
        GENERATE,
        json=payload(history=[{"author": "marque", "text": "x"} for _ in range(11)]),
        headers=scope(),
    )

    assert response.status_code == 422


def test_safety_check_validates_a_human_written_text(client, service_jwt_settings):
    response = client.post(
        SAFETY,
        json={"text": "Nous vous remboursons intégralement dès demain.", "brand": BRAND, "language": "fr"},
        headers=scope(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["blocked"] is True
    assert any(warning["code"] == "unauthorised_promise" for warning in body["warnings"])


def test_safety_check_accepts_a_clean_text(client, service_jwt_settings):
    response = client.post(
        SAFETY,
        json={"text": "Bonjour Alice, merci pour votre message.", "brand": BRAND, "language": "fr"},
        headers=scope(),
    )

    assert response.json() == {"blocked": False, "warnings": []}


def test_hashtags_are_generated_and_bounded(client, service_jwt_settings):
    response = client.post(
        HASHTAGS,
        json={"text": "Nouvelle collection été, pièces pensées pour les journées longues.", "brand": BRAND, "limit": 5},
        headers=scope(),
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["hashtags"]) <= 5
    assert all(tag.startswith("#") for tag in body["hashtags"])
    assert body["keywords"]


def test_hashtags_preserve_the_manual_selection(client, service_jwt_settings):
    response = client.post(
        HASHTAGS,
        json={"text": "Nouvelle collection été", "brand": BRAND, "preserve": ["#amoi"], "limit": 2},
        headers=scope(),
    )

    assert response.json()["hashtags"][0] == "#amoi"


def test_an_empty_publication_text_is_refused(client, service_jwt_settings):
    response = client.post(HASHTAGS, json={"text": "", "brand": BRAND}, headers=scope())

    assert response.status_code == 422


def test_every_assistance_route_requires_authentication(client, service_jwt_settings):
    anonymous = TestClient(app)

    assert anonymous.post(GENERATE, json=payload()).status_code == 401
    assert anonymous.post(WORKFLOW, json=payload()).status_code == 401
    assert anonymous.post(SAFETY, json={"text": "Bonjour"}).status_code == 401
    assert anonymous.post(HASHTAGS, json={"text": "Bonjour"}).status_code == 401


def test_the_analysis_scope_alone_does_not_open_generation(client, service_jwt_settings):
    """Scopes distincts : analyser un commentaire et rédiger en son nom ne sont
    pas la même autorisation."""
    response = client.post(GENERATE, json=payload(), headers=auth_header(scope=["ai:analyze"]))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_a_token_for_graph_api_is_rejected(client, service_jwt_settings):
    response = client.post(
        GENERATE, json=payload(), headers=auth_header(scope=["ai:generate"], audience="social-service")
    )

    assert response.status_code == 401


def test_the_response_length_limit_comes_from_configuration(client, service_jwt_settings, monkeypatch):
    monkeypatch.setattr(settings, "max_response_characters", 10)

    response = client.post(
        SAFETY,
        json={"text": "Un texte nettement plus long que dix caractères.", "brand": BRAND},
        headers=scope(),
    )

    assert any(warning["code"] == "too_long" for warning in response.json()["warnings"])

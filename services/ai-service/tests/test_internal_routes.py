from fastapi.testclient import TestClient

from core.config import settings
from main import app
from tests.conftest import auth_header, make_service_token

ANALYZE = "/internal/v1/comments/analyze"


def test_analyze_returns_every_expected_field(client, service_jwt_settings):
    response = client.post(
        ANALYZE,
        json={"commentId": "c-1", "text": "Commande jamais reçue, je veux un remboursement."},
        headers=auth_header(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["commentId"] == "c-1"
    analysis = body["analysis"]
    for field in (
        "sentiment",
        "intent",
        "priority",
        "confidence",
        "sentimentConfidence",
        "intentConfidence",
        "lowConfidence",
        "urgent",
        "sensitive",
        "language",
        "recommendedAction",
        "explanation",
        "modelVersion",
        "datasetVersion",
        "analysedAt",
        "signals",
        "topTerms",
    ):
        assert field in analysis, field

    assert analysis["sentiment"] in ("positive", "neutral", "negative")
    assert analysis["intent"] in ("question", "info_request", "complaint", "claim", "other")
    assert analysis["priority"] in ("low", "medium", "high")
    assert 0.0 <= analysis["confidence"] <= 1.0


def test_analysis_is_deterministic(client, service_jwt_settings):
    payload = {"text": "Bonjour, quel est le délai de livraison ?"}

    first = client.post(ANALYZE, json=payload, headers=auth_header()).json()
    second = client.post(ANALYZE, json=payload, headers=auth_header()).json()

    assert first["analysis"]["sentiment"] == second["analysis"]["sentiment"]
    assert first["analysis"]["confidence"] == second["analysis"]["confidence"]


def test_urgent_comment_is_escalated_to_high_priority(client, service_jwt_settings):
    response = client.post(
        ANALYZE,
        json={"text": "Sans remboursement d'ici lundi je saisis la justice."},
        headers=auth_header(),
    )

    analysis = response.json()["analysis"]
    assert analysis["urgent"] is True
    assert analysis["priority"] == "high"
    assert analysis["signals"]


def test_explanation_quotes_terms_that_actually_drove_the_prediction(client, service_jwt_settings):
    response = client.post(
        ANALYZE,
        json={"text": "Je veux un remboursement pour ma commande jamais livrée."},
        headers=auth_header(),
    )

    analysis = response.json()["analysis"]
    assert analysis["topTerms"]
    for term in analysis["topTerms"]:
        assert term in analysis["explanation"]


def test_non_french_comment_is_flagged_as_low_confidence(client, service_jwt_settings):
    """Le dataset est uniquement francophone : le modèle n'a aucune compétence
    en anglais et doit le dire, pas produire un verdict arbitraire."""
    response = client.post(
        ANALYZE,
        json={"text": "Hello, I would like to know when my order will be shipped please."},
        headers=auth_header(),
    )

    analysis = response.json()["analysis"]
    assert analysis["language"] == "other"
    assert analysis["lowConfidence"] is True
    assert "français" in analysis["explanation"]


def test_empty_text_is_rejected(client, service_jwt_settings):
    response = client.post(ANALYZE, json={"text": "   "}, headers=auth_header())

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_failed"


def test_missing_text_is_a_validation_error(client, service_jwt_settings):
    response = client.post(ANALYZE, json={"commentId": "c-1"}, headers=auth_header())

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_failed"


def test_authentication_is_required(client, service_jwt_settings):
    response = client.post(ANALYZE, json={"text": "Bonjour"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_a_token_minted_for_graph_api_is_rejected(client, service_jwt_settings):
    """Audience distincte : un jeton qui ouvre l'accès à Meta ne doit pas
    ouvrir l'accès à l'analyse."""
    response = client.post(
        ANALYZE, json={"text": "Bonjour"}, headers=auth_header(audience="social-service")
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_a_user_token_is_rejected(client, service_jwt_settings):
    response = client.post(
        ANALYZE, json={"text": "Bonjour"}, headers=auth_header(token_type="access")
    )

    assert response.status_code == 401


def test_an_expired_token_is_rejected(client, service_jwt_settings):
    response = client.post(
        ANALYZE, json={"text": "Bonjour"}, headers=auth_header(expires_in=-10)
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "token_expired"


def test_a_token_signed_with_another_secret_is_rejected(client, service_jwt_settings):
    response = client.post(
        ANALYZE, json={"text": "Bonjour"}, headers=auth_header(secret="un-autre-secret-de-32-octets-ok")
    )

    assert response.status_code == 401


def test_missing_scope_is_forbidden(client, service_jwt_settings):
    response = client.post(ANALYZE, json={"text": "Bonjour"}, headers=auth_header(scope=["social:read"]))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_service_without_jwt_secret_is_unavailable(client, monkeypatch):
    monkeypatch.setattr(settings, "service_jwt_secret", None)

    response = client.post(ANALYZE, json={"text": "Bonjour"}, headers=auth_header())

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"


def test_a_placeholder_secret_is_treated_as_unconfigured(client, monkeypatch):
    monkeypatch.setattr(settings, "service_jwt_secret", "change-me-please")

    response = client.post(ANALYZE, json={"text": "Bonjour"}, headers=auth_header())

    assert response.status_code == 503


def test_models_info_exposes_version_and_metrics(client, service_jwt_settings):
    response = client.get("/internal/v1/models/info", headers=auth_header())

    assert response.status_code == 200
    body = response.json()
    assert body["datasetVersion"] == "v1"
    assert body["randomSeed"] == 42
    assert set(body["tasks"]) == {"sentiment", "intent"}
    assert body["tasks"]["sentiment"]["confidenceThreshold"] > 0


def test_models_info_requires_authentication(client, service_jwt_settings):
    assert TestClient(app).get("/internal/v1/models/info").status_code == 401


def test_analysis_is_unavailable_when_models_are_missing(monkeypatch, tmp_path, service_jwt_settings):
    from modules.nlp import pipeline

    monkeypatch.setattr(settings, "artifacts_dir", tmp_path / "vide")
    monkeypatch.setattr(pipeline, "_loaded", None)

    response = TestClient(app).post(
        ANALYZE,
        json={"text": "Bonjour"},
        headers={"Authorization": f"Bearer {make_service_token()}"},
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"

from fastapi.testclient import TestClient

from core.config import settings
from main import app
from modules.analytics import best_times_explainer
from tests.conftest import SERVICE_JWT_SECRET, auth_header

EXPLAIN = "/internal/v1/analytics/best-times/explain"


def facts(**overrides):
    body = {
        "network": "instagram",
        "period": "30d",
        "analyzedCount": 24,
        "best": {
            "weekday": 1,
            "weekdayLabel": "Mardi",
            "slotId": "18-21",
            "slotStartHour": 18,
            "slotEndHour": 21,
            "slotLabel": "18h00–21h00",
            "score": 0.87,
            "confidence": "high",
            "sampleSize": 12,
            "metrics": {"avgEngagementRate": 0.078, "avgReach": 4200.0, "avgInteractions": 320.0},
            "deltaVsAveragePercent": 21.0,
        },
        "alternatives": [
            {
                "weekday": 3,
                "weekdayLabel": "Jeudi",
                "slotId": "17-18",
                "slotStartHour": 17,
                "slotEndHour": 18,
                "slotLabel": "15h00–18h00",
                "score": 0.6,
                "confidence": "medium",
                "sampleSize": 9,
                "metrics": {"avgEngagementRate": 0.069, "avgReach": 3800.0, "avgInteractions": 280.0},
                "deltaVsAveragePercent": -5.0,
            }
        ],
    }
    body.update(overrides)
    return body


def scope() -> dict[str, str]:
    return auth_header(scope=["ai:generate"])


def test_local_template_only_uses_numbers_present_in_the_facts():
    text, generator, warnings = best_times_explainer.generate(facts=facts())

    assert generator == "local-template-1.0.0"
    assert warnings == []
    assert "12" in text  # sampleSize
    assert "21" in text  # deltaVsAveragePercent
    assert best_times_explainer._validate_numbers(text, facts())


def test_local_template_mentions_low_confidence_samples():
    low_confidence = facts()
    low_confidence["best"]["confidence"] = "low"

    text, _, _ = best_times_explainer.generate(facts=low_confidence)

    assert "limité" in text


def test_validate_numbers_accepts_the_zero_in_hour_notation():
    # "18h00" contient un "00" qui ne provient d'aucun fait — toléré (voir
    # commentaire de _allowed_numbers), sinon toute mention d'heure ronde
    # ferait échouer la validation.
    assert best_times_explainer._validate_numbers("Créneau conseillé : 18h00–21h00.", facts())


def test_validate_numbers_rejects_a_number_absent_from_the_facts():
    assert not best_times_explainer._validate_numbers("Votre engagement a bondi de 57 %.", facts())


def test_route_returns_a_local_explanation_when_no_llm_is_configured(monkeypatch):
    monkeypatch.setattr(settings, "service_jwt_secret", SERVICE_JWT_SECRET)
    monkeypatch.setattr(settings, "ai_generation_mode", "local")
    test_client = TestClient(app)

    response = test_client.post(EXPLAIN, json=facts(), headers=scope())

    assert response.status_code == 200
    body = response.json()
    assert body["generator"] == "local-template-1.0.0"
    assert body["text"]


def test_route_requires_the_ai_generate_scope(monkeypatch):
    monkeypatch.setattr(settings, "service_jwt_secret", SERVICE_JWT_SECRET)
    test_client = TestClient(app)

    response = test_client.post(EXPLAIN, json=facts(), headers=auth_header(scope=["ai:analyze"]))

    assert response.status_code == 403


def test_route_rejects_a_missing_token(monkeypatch):
    monkeypatch.setattr(settings, "service_jwt_secret", SERVICE_JWT_SECRET)
    test_client = TestClient(app)

    response = test_client.post(EXPLAIN, json=facts())

    assert response.status_code == 401


def test_route_rejects_a_network_other_than_facebook_or_instagram(monkeypatch):
    monkeypatch.setattr(settings, "service_jwt_secret", SERVICE_JWT_SECRET)
    test_client = TestClient(app)

    response = test_client.post(EXPLAIN, json=facts(network="twitter"), headers=scope())

    assert response.status_code == 422

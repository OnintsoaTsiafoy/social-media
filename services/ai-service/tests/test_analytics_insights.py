import copy
import json

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from main import app
from modules.analytics import insight_explainer as explainer
from modules.analytics.insight_schemas import AnalyticsExplainRequest, InsightPlan
from tests.conftest import SERVICE_JWT_SECRET, auth_header

PATH = "/internal/v1/analytics/explain"


def payload():
    return {"period": "7d", "network": "all", "periodStart": "2026-09-08T12:00:00Z",
            "periodEnd": "2026-09-15T12:00:00Z", "warnings": [],
            "metrics": {"variation.engagement": {"label": "Variation de l'engagement", "value": 22.4,
                        "unit": "percent", "availability": "available"}},
            "facts": [{"id": "engagement_increase", "type": "engagement_increase",
                       "metric": "variation.engagement", "value": 22.4, "unit": "percent",
                       "polarity": "positive", "message": "L’engagement augmente de 22,4 %.",
                       "recommendation": "Examiner les formats les plus performants."}]}


@pytest.fixture(autouse=True)
def local_settings(monkeypatch):
    monkeypatch.setattr(settings, "service_jwt_secret", SERVICE_JWT_SECRET)
    monkeypatch.setattr(settings, "ai_generation_mode", "local")


@pytest.mark.parametrize("period", ["7d", "30d", "90d"])
@pytest.mark.parametrize("network", ["all", "facebook", "instagram"])
def test_filters_and_local_fallback(period, network):
    body = payload()
    body.update(period=period, network=network)
    response = TestClient(app).post(PATH, json=body, headers={**auth_header(scope=["ai:generate"]), "x-request-id": "analytics-test-id"})
    assert response.status_code == 200
    assert response.headers["x-request-id"] == "analytics-test-id"
    data = response.json()
    assert data["aiStatus"] == "fallback"
    assert data["explanation"]["summary"] == body["facts"][0]["message"]
    assert data["explanation"]["referencedMetrics"] == ["variation.engagement"]


def test_authentication_and_scope():
    client = TestClient(app)
    assert client.post(PATH, json=payload()).status_code == 401
    assert client.post(PATH, json=payload(), headers=auth_header(scope=["ai:analyze"])).status_code == 403


@pytest.mark.parametrize("corruption", ["missing", "unavailable", "partial", "wrong_number", "extra", "too_long", "invalid_dates", "text_number"])
def test_strict_input(corruption):
    body = payload()
    if corruption == "missing":
        body["facts"][0]["metric"] = "revenue"
    elif corruption in {"unavailable", "partial"}:
        body["metrics"]["variation.engagement"]["availability"] = corruption
    elif corruption == "wrong_number":
        body["facts"][0]["value"] = 99
    elif corruption == "extra":
        body["socialToken"] = "must-not-be-accepted"
    elif corruption == "too_long":
        body["facts"][0]["message"] = "x" * 351
    elif corruption == "text_number":
        body["facts"][0]["message"] = "L’engagement augmente de 99 %."
    else:
        body["periodEnd"] = body["periodStart"]
    response = TestClient(app).post(PATH, json=body, headers=auth_header(scope=["ai:generate"]))
    assert response.status_code == 422


def test_no_data_remains_explicit():
    body = payload()
    body["facts"] = []
    body["metrics"] = {}
    result = explainer.generate(AnalyticsExplainRequest.model_validate(body), "no-data")
    assert result.explanation.summary == explainer.EMPTY_SUMMARY
    assert result.explanation.recommendations == []


def test_valid_llm_selection(monkeypatch):
    body = AnalyticsExplainRequest.model_validate(payload())
    monkeypatch.setattr(settings, "ai_generation_mode", "llm")
    monkeypatch.setattr(settings, "anthropic_api_key", "test-only")
    monkeypatch.setattr(explainer, "llm_plan", lambda _: explainer.local_plan(body))
    result = explainer.generate(body, "valid-model")
    assert result.aiStatus == "available"
    assert result.explanation.summary == body.facts[0].message


@pytest.mark.parametrize("failure", ["timeout", "unknown_metric", "wrong_polarity", "free_text", "too_many", "empty_summary"])
def test_unverifiable_model_responses_fall_back(monkeypatch, failure):
    body = AnalyticsExplainRequest.model_validate(payload())
    monkeypatch.setattr(settings, "ai_generation_mode", "llm")
    monkeypatch.setattr(settings, "anthropic_api_key", "test-only")

    def bad_plan(_):
        if failure == "timeout":
            raise TimeoutError("provider down")
        plan = explainer.local_plan(body).model_dump()
        if failure == "unknown_metric":
            plan["summary"] = ["revenue_999"]
        elif failure == "wrong_polarity":
            plan["attentionPoints"] = plan["summary"]
        elif failure == "free_text":
            plan["summary"] = ["L’engagement a augmenté de 999 %."]
        elif failure == "too_many":
            plan["recommendations"] = ["a", "b", "c", "d"]
        elif failure == "empty_summary":
            plan["summary"] = []
        return InsightPlan.model_validate(plan)

    monkeypatch.setattr(explainer, "llm_plan", bad_plan)
    result = explainer.generate(body, "bad-model")
    assert result.aiStatus == "fallback"
    assert result.explanation.summary == payload()["facts"][0]["message"]
    assert "999" not in json.dumps(result.explanation.model_dump())


def test_metric_units_and_duplicate_facts_are_validated():
    body = payload()
    body["facts"][0]["unit"] = "count"
    with pytest.raises(ValueError):
        AnalyticsExplainRequest.model_validate(body)
    body = payload()
    body["facts"].append(copy.deepcopy(body["facts"][0]))
    with pytest.raises(ValueError):
        AnalyticsExplainRequest.model_validate(body)

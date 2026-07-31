from fastapi.testclient import TestClient

from core.config import settings
from main import app


client = TestClient(app)


def test_health_is_available_without_meta_configuration(monkeypatch):
    monkeypatch.setattr(settings, "facebook_app_id", None)
    monkeypatch.setattr(settings, "facebook_page_id", None)
    monkeypatch.setattr(settings, "facebook_page_access_token", None)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "graph-api"}


def test_ready_reports_missing_meta_configuration(monkeypatch):
    monkeypatch.setattr(settings, "facebook_app_id", None)
    monkeypatch.setattr(settings, "facebook_page_id", None)
    monkeypatch.setattr(settings, "facebook_page_access_token", None)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json()["reason"] == "meta_configuration_missing"


def test_facebook_route_is_rejected_without_meta_configuration(monkeypatch):
    monkeypatch.setattr(settings, "facebook_app_id", None)
    monkeypatch.setattr(settings, "facebook_page_id", None)
    monkeypatch.setattr(settings, "facebook_page_access_token", None)

    response = client.get("/facebook/posts")

    assert response.status_code == 503
    assert "Configuration Meta absente" in response.json()["detail"]


def test_ready_is_available_when_meta_configuration_is_complete(monkeypatch):
    monkeypatch.setattr(settings, "facebook_app_id", "app-id")
    monkeypatch.setattr(settings, "facebook_page_id", "page-id")
    monkeypatch.setattr(settings, "facebook_page_access_token", "page-token")

    response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "service": "graph-api"}

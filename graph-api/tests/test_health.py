from fastapi.testclient import TestClient

from core.config import settings
from main import app
from tests.conftest import SERVICE_JWT_SECRET, make_service_jwt


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
    # La route exige un JWT de service : sans lui, on obtiendrait 401 et ce
    # test ne dirait plus rien de la configuration Meta.
    monkeypatch.setattr(settings, "service_jwt_secret", SERVICE_JWT_SECRET)

    response = client.get(
        "/facebook/posts", headers={"Authorization": f"Bearer {make_service_jwt()}"}
    )

    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "provider_unavailable"
    assert "Configuration Meta absente" in body["error"]["message"]


def test_ready_is_available_when_fully_configured(monkeypatch):
    monkeypatch.setattr(settings, "facebook_app_id", "app-id")
    monkeypatch.setattr(settings, "facebook_page_id", "page-id")
    monkeypatch.setattr(settings, "facebook_page_access_token", "page-token")
    monkeypatch.setattr(settings, "database_url", "postgresql://test:test@localhost/test")
    monkeypatch.setattr(
        settings, "token_encryption_key_1", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
    )

    response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "service": "graph-api"}


def test_ready_reports_missing_database_configuration(monkeypatch):
    monkeypatch.setattr(settings, "facebook_app_id", "app-id")
    monkeypatch.setattr(settings, "facebook_page_id", "page-id")
    monkeypatch.setattr(settings, "facebook_page_access_token", "page-token")
    monkeypatch.setattr(settings, "database_url", None)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json()["reason"] == "database_configuration_missing"


def test_ready_reports_missing_encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "facebook_app_id", "app-id")
    monkeypatch.setattr(settings, "facebook_page_id", "page-id")
    monkeypatch.setattr(settings, "facebook_page_access_token", "page-token")
    monkeypatch.setattr(settings, "database_url", "postgresql://test:test@localhost/test")
    monkeypatch.setattr(settings, "token_encryption_key_1", None)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json()["reason"] == "encryption_key_missing"

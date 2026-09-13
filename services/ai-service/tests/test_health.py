from pathlib import Path

from fastapi.testclient import TestClient

from core.config import settings
from main import app
from modules.nlp import pipeline


def test_health_never_depends_on_configuration(monkeypatch):
    monkeypatch.setattr(settings, "ai_model_mode", "")
    monkeypatch.setattr(settings, "artifacts_dir", Path("/inexistant"))

    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ai-service"}


def test_ready_reports_unsupported_mode(monkeypatch):
    monkeypatch.setattr(settings, "ai_model_mode", "stub")

    response = TestClient(app).get("/ready")

    assert response.status_code == 503
    body = response.json()
    assert body["reason"] == "model_mode_unsupported"
    assert body["mode"] == "stub"


def test_ready_reports_missing_artifacts(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_model_mode", "local")
    monkeypatch.setattr(settings, "artifacts_dir", tmp_path / "vide")
    monkeypatch.setattr(pipeline, "_loaded", None)

    response = TestClient(app).get("/ready")

    assert response.status_code == 503
    assert response.json()["reason"] == "model_artifacts_missing"


def test_ready_is_available_once_models_are_trained(client):
    response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "service": "ai-service", "mode": "local"}

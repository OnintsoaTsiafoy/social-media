import time

import jwt
import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.security import SERVICE_JWT_AUDIENCE
from main import app
from modules.nlp import pipeline

SERVICE_JWT_SECRET = "test-service-secret-at-least-32-bytes-long"


@pytest.fixture(scope="session")
def trained_artifacts(tmp_path_factory):
    """Entraîne réellement les modèles, une fois pour toute la session.

    Volontairement pas de modèle factice : la parité entraînement/inférence
    (le `preprocessor=normalise` embarqué dans l'objet sérialisé) est
    précisément ce qu'un faux artefact cesserait de vérifier. La graine étant
    fixée, cet entraînement est déterministe et dure quelques secondes.
    """
    from training.train import train_all

    directory = tmp_path_factory.mktemp("artifacts")
    train_all(output_dir=directory)
    return directory


@pytest.fixture
def configured_settings(monkeypatch, trained_artifacts):
    monkeypatch.setattr(settings, "artifacts_dir", trained_artifacts)
    monkeypatch.setattr(settings, "ai_model_mode", "local")
    # Le cache de modèles est un singleton de module : sans réinitialisation,
    # un test qui pointe ailleurs (artefacts manquants) polluerait les suivants.
    monkeypatch.setattr(pipeline, "_loaded", None)
    return settings


@pytest.fixture
def client(configured_settings):
    return TestClient(app)


@pytest.fixture
def service_jwt_settings(monkeypatch):
    monkeypatch.setattr(settings, "service_jwt_secret", SERVICE_JWT_SECRET)
    return settings


def make_service_token(
    scope: list[str] | None = None,
    audience: str = SERVICE_JWT_AUDIENCE,
    token_type: str = "service",
    expires_in: int = 120,
    secret: str = SERVICE_JWT_SECRET,
) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "scope": scope if scope is not None else ["ai:analyze"],
            "type": token_type,
            "sub": "hootly-api",
            "aud": audience,
            "iat": now,
            "exp": now + expires_in,
        },
        secret,
        algorithm="HS256",
    )


def auth_header(**kwargs) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_service_token(**kwargs)}"}

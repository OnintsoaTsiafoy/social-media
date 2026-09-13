from fastapi import APIRouter
from fastapi.responses import JSONResponse

from core.config import SERVICE_NAME, settings
from modules.nlp.pipeline import models_ready

router = APIRouter()


@router.get("/health")
async def health_check():
    """Sonde de vivacité : ne dépend d'aucune configuration externe."""
    return {"status": "ok", "service": SERVICE_NAME}


@router.get("/ready")
async def readiness_check():
    """Prêt = mode reconnu ET artefacts de modèle chargeables.

    Contrairement au stub du Sprint 01, la présence de `AI_MODEL_MODE` ne
    suffit plus : un service qui annonce « prêt » sans modèle entraîné
    répondrait 503 à chaque analyse, ce que la sonde est justement censée
    éviter. Le chargement est tenté ici, une fois, puis mis en cache — /ready
    sert donc aussi de préchauffage.
    """
    if not settings.model_mode_supported:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": SERVICE_NAME,
                "reason": "model_mode_unsupported",
                "mode": settings.ai_model_mode,
            },
        )

    if not models_ready():
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": SERVICE_NAME,
                "reason": "model_artifacts_missing",
            },
        )

    return {"status": "ready", "service": SERVICE_NAME, "mode": settings.ai_model_mode}

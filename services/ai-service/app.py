import os

from fastapi import FastAPI
from fastapi.responses import JSONResponse


app = FastAPI(
    title="Hootly AI Service",
    version="0.1.0",
    description="Socle Sprint 01. L'analyse NLP est livrée au Sprint 09.",
)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "ai-service"}


@app.get("/ready")
async def readiness_check():
    mode = os.getenv("AI_MODEL_MODE", "").strip()
    if not mode:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": "ai-service",
                "reason": "model_mode_missing",
            },
        )
    return {"status": "ready", "service": "ai-service", "mode": mode}

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from core.config import settings

router = APIRouter()


@router.get("/health")
async def health_check():
    """Liveness probe: it must never depend on third-party credentials."""
    return {"status": "ok", "service": "graph-api"}


@router.get("/ready")
async def readiness_check():
    """Readiness probe exposing whether Meta calls can be served.

    The endpoint deliberately does not call Meta: a transient external outage
    must not be confused with a missing local configuration.
    """
    if not settings.meta_configured:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": "graph-api",
                "reason": "meta_configuration_missing",
            },
        )

    return {"status": "ready", "service": "graph-api"}

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
    """Readiness probe exposing whether Meta calls and /internal/v1 can be served.

    The endpoint deliberately never calls Meta or the database: a transient
    external outage must not be confused with missing local configuration —
    same rule Sprint 05/06 both apply, just to one more dependency now.
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

    if not settings.database_configured:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": "graph-api",
                "reason": "database_configuration_missing",
            },
        )

    if not settings.encryption_configured:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": "graph-api",
                "reason": "encryption_key_missing",
            },
        )

    return {"status": "ready", "service": "graph-api"}

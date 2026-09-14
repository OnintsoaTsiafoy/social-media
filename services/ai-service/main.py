from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from api.routes.analytics_routes import router as analytics_router
from api.routes.assistance_routes import router as assistance_router
from api.routes.health import router as health_router
from api.routes.internal_routes import router as internal_router
from api.routes.knowledge_routes import router as knowledge_router
from core.config import settings
from core.exceptions import default_code_for_status
from core.middleware import RequestIdMiddleware
from core.rate_limit import limiter

app = FastAPI(title=settings.app_name)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(RequestIdMiddleware)

# /internal/v1 est strictement serveur-à-serveur : aucun navigateur ne l'appelle.
if settings.cors_allowed_origins_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins_list,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "x-request-id"],
    )


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Même enveloppe {error:{code,message,requestId}} que graph-api et Express,
    au lieu du {"detail": ...} par défaut de FastAPI."""
    code = getattr(exc, "code", None) or default_code_for_status(exc.status_code)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": exc.detail, "requestId": _request_id(request)}},
        headers=dict(exc.headers) if exc.headers else None,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_failed",
                "message": "Paramètres invalides.",
                "details": jsonable_encoder(exc.errors()),
                "requestId": _request_id(request),
            }
        },
    )


@app.exception_handler(RateLimitExceeded)
async def rate_limit_exception_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={
            "error": {
                "code": "rate_limited",
                "message": "Trop de requêtes.",
                "requestId": _request_id(request),
            }
        },
        headers={"Retry-After": "60"},
    )


app.include_router(health_router)
app.include_router(internal_router)
app.include_router(assistance_router)
app.include_router(knowledge_router)
app.include_router(analytics_router)

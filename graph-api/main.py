from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from api.routes.facebook_routes import router as facebook_router
from api.routes.health import router as health_router
from api.routes.internal_routes import router as internal_router
from api.routes.oauth_routes import router as oauth_router
from api.routes.social_account_routes import router as social_account_router
from api.routes.webhook_routes import router as webhook_router
from core.config import settings
from core.exceptions import default_code_for_status
from core.middleware import RequestIdMiddleware
from core.rate_limit import limiter

app = FastAPI(title=settings.app_name)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(RequestIdMiddleware)

# /internal/v1 is server-to-server and /oauth/*/callback (Sprint 06) is a
# top-level browser navigation — neither is subject to CORS in practice.
# Left closed by default; set CORS_ALLOWED_ORIGINS if a browser-based caller
# (e.g. an admin dashboard) is ever added.
if settings.cors_allowed_origins_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins_list,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "x-request-id"],
    )


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Stable {error:{code,message,requestId}} envelope for every raised
    HTTPException (including GraphAPIError, which is a subclass) instead of
    FastAPI's bare {"detail": ...} default (Sprint 05 Day 4/5)."""
    code = getattr(exc, "code", None) or default_code_for_status(exc.status_code)
    headers = dict(exc.headers) if exc.headers else {}
    retry_after = getattr(exc, "retry_after", None)
    if retry_after:
        headers["Retry-After"] = str(retry_after)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": exc.detail, "requestId": _request_id(request)}},
        headers=headers or None,
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
app.include_router(facebook_router)
app.include_router(internal_router)
app.include_router(oauth_router)
app.include_router(social_account_router)
app.include_router(webhook_router)

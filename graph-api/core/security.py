"""Service JWT verification for /internal/v1 (Sprint 05 Day 5).

Mirrors services/api/src/auth/tokens.js's shape (HS256, shared secret) but for
the server-to-server audience: Express and the worker mint these tokens
(sub="hootly-api" / "hootly-worker"), graph-api only ever verifies them. A
mobile/user JWT must never be accepted here — enforced by requiring
``type == "service"``.
"""
import logging

import jwt
from fastapi import Header

from core.config import settings
from core.exceptions import GraphAPIError

logger = logging.getLogger("graph_api.security")

SERVICE_JWT_AUDIENCE = "social-service"


def require_service_jwt(required_scope: str | None = None):
    """FastAPI dependency factory: validates the bearer token and, if given,
    that ``required_scope`` is present in the token's ``scope`` claim."""

    async def dependency(authorization: str | None = Header(default=None)) -> dict:
        if not settings.service_jwt_configured:
            raise GraphAPIError(
                status_code=503,
                detail="JWT de service non configuré côté graph-api.",
                code="provider_unavailable",
            )

        if not authorization or not authorization.startswith("Bearer "):
            logger.warning("internal_v1_rejected reason=missing_bearer")
            raise GraphAPIError(
                status_code=401,
                detail="En-tête Authorization Bearer requis.",
                code="authentication_required",
            )

        token = authorization.removeprefix("Bearer ").strip()
        try:
            payload = jwt.decode(
                token,
                settings.service_jwt_secret,
                algorithms=["HS256"],
                audience=SERVICE_JWT_AUDIENCE,
            )
        except jwt.ExpiredSignatureError as exc:
            logger.warning("internal_v1_rejected reason=expired")
            raise GraphAPIError(
                status_code=401, detail="JWT de service expiré.", code="token_expired"
            ) from exc
        except jwt.InvalidTokenError as exc:
            logger.warning("internal_v1_rejected reason=invalid_token")
            raise GraphAPIError(
                status_code=401, detail="JWT de service invalide.", code="authentication_required"
            ) from exc

        # Never accept a mobile/user JWT here, even if it happens to be signed
        # with the same secret in a misconfigured environment.
        if payload.get("type") != "service":
            logger.warning("internal_v1_rejected reason=wrong_token_type sub=%s", payload.get("sub"))
            raise GraphAPIError(
                status_code=401,
                detail="Ce jeton n'est pas un JWT de service.",
                code="authentication_required",
            )

        scopes = payload.get("scope") or []
        if required_scope and required_scope not in scopes:
            logger.warning(
                "internal_v1_rejected reason=missing_scope sub=%s required=%s",
                payload.get("sub"),
                required_scope,
            )
            raise GraphAPIError(
                status_code=403,
                detail=f"Le jeton ne porte pas le scope requis : {required_scope}.",
                code="forbidden",
            )

        logger.info(
            "internal_v1_call sub=%s scope=%s", payload.get("sub"), ",".join(scopes)
        )
        return payload

    return dependency

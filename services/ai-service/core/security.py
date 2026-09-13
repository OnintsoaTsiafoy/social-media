"""Vérification du JWT de service pour /internal/v1 (Sprint 09).

Reprend la mécanique de graph-api/core/security.py — mais avec sa **propre
audience**. Une audience partagée ferait qu'un jeton émis pour appeler Meta
ouvrirait aussi l'analyse IA : deux services au périmètre différent doivent
exiger deux jetons différents, même signés par le même secret.
"""
import logging

import jwt
from fastapi import Header

from core.config import settings
from core.exceptions import AIServiceError

logger = logging.getLogger("ai_service.security")

SERVICE_JWT_AUDIENCE = "ai-service"


def require_service_jwt(required_scope: str | None = None):
    async def dependency(authorization: str | None = Header(default=None)) -> dict:
        if not settings.service_jwt_configured:
            raise AIServiceError(
                status_code=503,
                detail="JWT de service non configuré côté ai-service.",
                code="provider_unavailable",
            )

        if not authorization or not authorization.startswith("Bearer "):
            logger.warning("internal_v1_rejected reason=missing_bearer")
            raise AIServiceError(
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
            raise AIServiceError(
                status_code=401, detail="JWT de service expiré.", code="token_expired"
            ) from exc
        except jwt.InvalidTokenError as exc:
            logger.warning("internal_v1_rejected reason=invalid_token")
            raise AIServiceError(
                status_code=401, detail="JWT de service invalide.", code="authentication_required"
            ) from exc

        # Un JWT utilisateur (mobile) ne doit jamais ouvrir une route interne,
        # même si l'environnement partage les deux secrets par erreur.
        if payload.get("type") != "service":
            logger.warning("internal_v1_rejected reason=wrong_token_type sub=%s", payload.get("sub"))
            raise AIServiceError(
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
            raise AIServiceError(
                status_code=403,
                detail=f"Le jeton ne porte pas le scope requis : {required_scope}.",
                code="forbidden",
            )

        logger.info("internal_v1_call sub=%s scope=%s", payload.get("sub"), ",".join(scopes))
        return payload

    return dependency

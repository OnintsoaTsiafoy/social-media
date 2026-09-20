"""OAuth authorization-url issuance (Sprint 06 Day 2, extended Sprint 07 Day 2).

Provider dispatch lives here so the internal route stays a thin wrapper.
"""
import secrets

import psycopg

from core.config import settings
from core.crypto import hash_state
from core.exceptions import GraphAPIError
from db import oauth_states_repository
from modules.instagram import oauth_instagram
from modules.oauth import facebook_oauth
from modules.oauth.schemas import AuthorizationUrlRequest, AuthorizationUrlResponse

_SUPPORTED_PROVIDERS = {"facebook", "instagram"}


def _require_provider_oauth_configured(provider_lower: str) -> None:
    if provider_lower == "instagram":
        if not settings.instagram_oauth_configured:
            raise GraphAPIError(
                status_code=503,
                detail="Application Instagram non configurée pour OAuth (INSTAGRAM_APP_ID/APP_SECRET).",
                code="OAUTH_CONFIGURATION_ERROR",
            )
        return
    if not settings.oauth_configured:
        raise GraphAPIError(
            status_code=503,
            detail="Application Meta non configurée pour OAuth (FACEBOOK_APP_ID/APP_SECRET).",
            code="OAUTH_CONFIGURATION_ERROR",
        )


async def _create_state(provider_lower: str, body: AuthorizationUrlRequest) -> dict:
    raw_state = secrets.token_urlsafe(32)
    try:
        stored = await oauth_states_repository.create_state(
            state_hash=hash_state(raw_state),
            user_id=body.user_id,
            brand_id=body.brand_id,
            provider=provider_lower,
            mobile_redirect_uri=body.mobile_redirect_uri,
            select_pages=body.select_pages,
            initiated_by_user_id=body.initiated_by_user_id,
        )
    except psycopg.errors.ForeignKeyViolation as exc:
        # Express is expected to validate userId/brandId before calling here;
        # this only fires on an upstream bug or a forged internal call —
        # translate it into a clean 422 instead of leaking a raw DB 500.
        raise GraphAPIError(
            status_code=422, detail="userId ou brandId inconnu.", code="validation_failed"
        ) from exc
    return {"raw_state": raw_state, "expires_at": stored["expires_at"]}


async def create_authorization_url(
    provider: str, body: AuthorizationUrlRequest
) -> AuthorizationUrlResponse:
    provider_lower = provider.lower()
    if provider_lower not in _SUPPORTED_PROVIDERS:
        raise GraphAPIError(
            status_code=422,
            detail=f"Provider '{provider}' non supporté pour l'autorisation OAuth.",
            code="PROVIDER_NOT_SUPPORTED",
        )

    # Le choix des pages n'existe que pour Facebook : un compte Instagram lié en
    # connexion directe n'expose qu'un seul compte, il n'y a rien à choisir.
    if body.select_pages and provider_lower != "facebook":
        raise GraphAPIError(
            status_code=422,
            detail="Le choix des pages n'est disponible que pour Facebook.",
            code="validation_failed",
        )

    _require_provider_oauth_configured(provider_lower)
    state = await _create_state(provider_lower, body)

    if provider_lower == "instagram":
        authorization_url = oauth_instagram.build_authorization_url(state["raw_state"])
    else:
        authorization_url = facebook_oauth.build_authorization_url(state["raw_state"])

    return AuthorizationUrlResponse(
        authorization_url=authorization_url,
        state=state["raw_state"],
        expires_at=state["expires_at"].isoformat(),
    )

"""Instagram Login (direct, no Facebook Page) OAuth — Sprint 07.

A completely separate OAuth product from Facebook Login for Business: its
own authorization host, its own token endpoint, its own Graph host for every
subsequent call (graph.instagram.com). Verified against Meta's current
documentation during planning — re-confirm the exact hosts/params before
onboarding real users, since Meta has changed these before (the Basic
Display API this superseded is already shut down).
"""
from urllib.parse import urlencode

import httpx

from core.config import settings
from core.exceptions import GraphAPIError

AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize"
TOKEN_URL = "https://api.instagram.com/oauth/access_token"
GRAPH_HOST = "https://graph.instagram.com/v25.0"

# Same permission names as the Facebook-linked path — Meta renamed both to
# the instagram_business_* family together.
INSTAGRAM_LOGIN_SCOPES = [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_comments",
    "instagram_business_manage_insights",
]


def callback_redirect_uri() -> str:
    return f"{settings.public_base_url}/oauth/instagram/callback"


def build_authorization_url(state: str) -> str:
    params = {
        "client_id": settings.instagram_app_id,
        "redirect_uri": callback_redirect_uri(),
        "scope": ",".join(INSTAGRAM_LOGIN_SCOPES),
        "response_type": "code",
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


async def _post_form(url: str, data: dict) -> dict:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, data=data)
    except httpx.HTTPError as exc:
        raise GraphAPIError(
            status_code=503, detail="Le service Instagram est injoignable.", code="provider_unavailable"
        ) from exc
    return _parse(response)


async def _get(url: str, params: dict) -> dict:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise GraphAPIError(
            status_code=503, detail="Le service Instagram est injoignable.", code="provider_unavailable"
        ) from exc
    return _parse(response)


def _parse(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError as exc:
        raise GraphAPIError(
            status_code=502, detail="Réponse invalide retournée par Instagram.", code="provider_unavailable"
        ) from exc
    if response.status_code >= 400:
        message = data.get("error_message") or data.get("error", {}).get("message") or "Erreur Instagram"
        raise GraphAPIError(status_code=response.status_code, detail=message, code="OAUTH_PERMISSION_DENIED")
    return data


async def exchange_code_for_token(code: str) -> tuple[str, str]:
    """Returns (short_lived_token, ig_user_id) — Instagram's initial exchange
    returns the user id directly alongside the token, unlike Facebook's."""
    data = await _post_form(
        TOKEN_URL,
        {
            "client_id": settings.instagram_app_id,
            "client_secret": settings.instagram_app_secret,
            "grant_type": "authorization_code",
            "redirect_uri": callback_redirect_uri(),
            "code": code,
        },
    )
    return data["access_token"], str(data["user_id"])


async def exchange_for_long_lived_token(short_lived_token: str) -> str:
    """~60 days, unlike Facebook's Page token this does NOT renew itself —
    see `refresh_long_lived_token` below for the repeatable rotation the
    worker's daily cron drives."""
    data = await _get(
        f"{GRAPH_HOST}/access_token",
        {
            "grant_type": "ig_exchange_token",
            "client_secret": settings.instagram_app_secret,
            "access_token": short_lived_token,
        },
    )
    return data["access_token"]


async def refresh_long_lived_token(token: str) -> tuple[str, int]:
    """Rotates an already-long-lived token before its ~60-day expiry.

    Distinct from `exchange_for_long_lived_token` (short-lived -> long-lived,
    used once at initial connect): `ig_refresh_token` is the repeatable
    long-lived -> long-lived rotation, same host/version as the sibling
    `access_token` exchange above (verified during planning against Meta's
    current Instagram API with Instagram Login docs; re-confirm live before
    onboarding real users, same caveat as the rest of this module). Meta
    requires the token be at least 24h old and not yet expired — a rejection
    here means a genuine reauthentication is needed, not a transient error.

    Returns (new_access_token, expires_in_seconds).
    """
    data = await _get(f"{GRAPH_HOST}/refresh_access_token", {"grant_type": "ig_refresh_token", "access_token": token})
    return data["access_token"], int(data["expires_in"])


async def fetch_profile(user_id: str, token: str) -> dict:
    return await _get(
        f"{GRAPH_HOST}/{user_id}",
        {"fields": "id,username,name,account_type,profile_picture_url", "access_token": token},
    )

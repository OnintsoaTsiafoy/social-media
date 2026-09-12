"""Low-level Instagram Graph API HTTP calls (Sprint 07).

Two possible hosts depending on SocialAccount.auth_method: a Page-linked
Instagram professional account (FACEBOOK_PAGE) is called via the same host
as Facebook, using the Page token; a directly-connected account
(INSTAGRAM_LOGIN) is called via graph.instagram.com using its own IG-native
token. Verified against Meta's current documentation during planning, not
assumed — re-confirm before onboarding real accounts of either kind.
"""
import logging

import httpx

from core.config import settings
from core.exceptions import GraphAPIError
from modules.facebook.clients.facebook_client import _redact_url

logger = logging.getLogger("graph_api.instagram_client")

INSTAGRAM_GRAPH_HOST = "https://graph.instagram.com/v25.0"


def base_url(auth_method: str) -> str:
    if auth_method == "INSTAGRAM_LOGIN":
        return INSTAGRAM_GRAPH_HOST
    return settings.graph_api_base_url  # FACEBOOK_PAGE: same Graph host as Facebook


async def _request(
    method: str, auth_method: str, path: str, *, params: dict | None = None, data: dict | None = None
) -> dict:
    url = f"{base_url(auth_method)}/{path}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(method, url, params=params, data=data)
    except httpx.TimeoutException as exc:
        logger.warning("Instagram request timed out: %s %s", method, _redact_url(url))
        raise GraphAPIError(
            status_code=504, detail="Le service Instagram n'a pas répondu à temps.", code="provider_timeout"
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning(
            "Instagram request failed: %s %s (%s)", method, _redact_url(url), exc.__class__.__name__
        )
        raise GraphAPIError(
            status_code=503, detail="Le service Instagram est injoignable.", code="provider_unavailable"
        ) from exc

    try:
        payload = response.json()
    except ValueError as exc:
        raise GraphAPIError(
            status_code=502, detail="Réponse invalide retournée par Instagram.", code="provider_unavailable"
        ) from exc

    if response.status_code >= 400:
        raise GraphAPIError.from_response(
            response.status_code, payload, retry_after=response.headers.get("Retry-After")
        )
    return payload


async def get(auth_method: str, path: str, token: str, params: dict | None = None) -> dict:
    merged = dict(params or {})
    merged["access_token"] = token
    return await _request("GET", auth_method, path, params=merged)


async def post(auth_method: str, path: str, token: str, data: dict | None = None) -> dict:
    payload = dict(data or {})
    payload["access_token"] = token
    return await _request("POST", auth_method, path, data=payload)

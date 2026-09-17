"""Facebook Login for Business OAuth dialog (Sprint 06 Day 2).

Also the path Instagram professional accounts linked to a Page are
discovered through (Sprint 07) — requesting the combined scope now avoids a
second consent screen once that lands.

Meta facts NOT re-verified live for this sprint (flagged, not assumed from
nothing): the scope list below matches what was confirmed via Meta's current
documentation during planning (pages_show_list/pages_read_engagement/
pages_manage_posts for basic Page publishing). `pages_manage_engagement` and
`business_management` are requested ahead of the Sprint 07/08 features that
need them so the user consents once — confirm all of these are
still the exact approved-permission names on the real Meta App before
sending real users through this flow.
"""
from urllib.parse import urlencode

import httpx

from core.config import settings
from core.exceptions import GraphAPIError

OAUTH_DIALOG_BASE_URL = "https://www.facebook.com/v25.0/dialog/oauth"

FACEBOOK_OAUTH_SCOPES = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "pages_manage_engagement",
    "business_management",
]
# Les permissions instagram_business_* n'appartiennent qu'au produit
# « Instagram API with Instagram Login » (voir modules/instagram/oauth_instagram.py) :
# Meta les rejette en « Invalid Scopes » dans la boîte de dialogue Facebook Login.


def callback_redirect_uri() -> str:
    return f"{settings.public_base_url}/oauth/facebook/callback"


def build_authorization_url(state: str) -> str:
    params = {
        "client_id": settings.facebook_app_id,
        "redirect_uri": callback_redirect_uri(),
        "state": state,
        "scope": ",".join(FACEBOOK_OAUTH_SCOPES),
        "response_type": "code",
    }
    return f"{OAUTH_DIALOG_BASE_URL}?{urlencode(params)}"


async def _meta_get(path: str, params: dict) -> dict:
    """Single choke point for the one-off Meta calls the OAuth exchange
    needs — separate from FacebookClient, which is bound to the single
    globally-configured Page token, not the dynamically-obtained user/page
    tokens this flow produces."""
    url = f"{settings.graph_api_base_url}/{path}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, params=params)
    except httpx.TimeoutException as exc:
        raise GraphAPIError(
            status_code=504, detail="Le service Meta n'a pas répondu à temps.", code="provider_timeout"
        ) from exc
    except httpx.HTTPError as exc:
        raise GraphAPIError(
            status_code=503, detail="Le service Meta est injoignable.", code="provider_unavailable"
        ) from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise GraphAPIError(
            status_code=502, detail="Réponse invalide retournée par Graph API.", code="provider_unavailable"
        ) from exc

    if response.status_code != 200:
        raise GraphAPIError.from_response(
            response.status_code, data, retry_after=response.headers.get("Retry-After")
        )
    return data


async def exchange_code_for_user_token(code: str) -> str:
    data = await _meta_get(
        "oauth/access_token",
        {
            "client_id": settings.facebook_app_id,
            "client_secret": settings.facebook_app_secret,
            "redirect_uri": callback_redirect_uri(),
            "code": code,
        },
    )
    return data["access_token"]


async def exchange_for_long_lived_token(short_lived_token: str) -> str:
    """A long-lived USER token (~60 days). The PAGE token later derived from
    it (via me/accounts) does not expire while the granting admin keeps
    access to the Page — verified against Meta's current docs during
    planning, not assumed."""
    data = await _meta_get(
        "oauth/access_token",
        {
            "grant_type": "fb_exchange_token",
            "client_id": settings.facebook_app_id,
            "client_secret": settings.facebook_app_secret,
            "fb_exchange_token": short_lived_token,
        },
    )
    return data["access_token"]


async def fetch_eligible_pages(user_token: str) -> list[dict]:
    data = await _meta_get(
        "me/accounts",
        {"fields": "id,name,access_token,picture{url},tasks", "access_token": user_token},
    )
    return data.get("data", [])


async def fetch_permissions(user_token: str) -> list[dict]:
    data = await _meta_get("me/permissions", {"access_token": user_token})
    return [
        {"permission": item["permission"], "status": item["status"].upper()}
        for item in data.get("data", [])
    ]


async def fetch_linked_instagram_account(page_id: str, page_token: str) -> dict | None:
    data = await _meta_get(
        page_id,
        {
            "fields": "instagram_business_account{id,username,name,profile_picture_url}",
            "access_token": page_token,
        },
    )
    return data.get("instagram_business_account")


async def fetch_page_profile(page_id: str, page_token: str) -> dict:
    """Re-reads a Page's own current name/picture with its own stored token
    (a Page token is allowed to read the Page's own public fields — no user
    token needed, unlike `fetch_eligible_pages`)."""
    return await _meta_get(page_id, {"fields": "name,picture{url}", "access_token": page_token})


async def fetch_instagram_profile(ig_id: str, page_token: str) -> dict:
    """Same idea as `fetch_page_profile`, for an Instagram account linked
    through a Page (FACEBOOK_PAGE auth_method) — reuses the Page's token."""
    return await _meta_get(
        ig_id, {"fields": "username,name,profile_picture_url", "access_token": page_token}
    )

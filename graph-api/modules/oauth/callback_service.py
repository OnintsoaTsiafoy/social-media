"""OAuth callback orchestration: Facebook (Sprint 06 Day 3) and Instagram
Login direct (Sprint 07 Day 2).

Every branch returns a deep-link URL string — the route wraps it in an HTTP
redirect. A raw GraphAPIError only ever escapes when there is no
mobile_redirect_uri to send the user back to at all (state missing/invalid),
which cannot happen from a genuine Meta redirect (Meta always echoes state).
"""
import logging
from datetime import datetime, timedelta, timezone

from core.crypto import hash_state
from core.exceptions import GraphAPIError
from db import (
    oauth_states_repository,
    oauth_tokens_repository,
    social_accounts_repository,
    social_permissions_repository,
)
from modules.instagram import oauth_instagram
from modules.oauth import facebook_oauth
from modules.oauth.redirect import build_redirect

logger = logging.getLogger("graph_api.oauth")

INSTAGRAM_LOGIN_TOKEN_TTL_DAYS = 60


async def _consume_state_or_raise(state: str | None) -> dict:
    if not state:
        raise GraphAPIError(
            status_code=400, detail="State OAuth manquant.", code="OAUTH_STATE_INVALID"
        )

    consumed = await oauth_states_repository.consume_state(hash_state(state))
    if consumed is None:
        raise GraphAPIError(
            status_code=400,
            detail="State OAuth invalide, expiré ou déjà utilisé.",
            code="OAUTH_STATE_INVALID",
        )
    return consumed


async def handle_facebook_callback(*, code: str | None, state: str | None, error: str | None) -> str:
    consumed = await _consume_state_or_raise(state)
    mobile_redirect_uri = consumed["mobile_redirect_uri"]

    if error:
        logger.info("facebook_oauth_denied error=%s", error)
        return build_redirect(mobile_redirect_uri, status="error", reason="permission_denied")

    if not code:
        return build_redirect(mobile_redirect_uri, status="error", reason="provider_error")

    try:
        short_lived_token = await facebook_oauth.exchange_code_for_user_token(code)
        long_lived_token = await facebook_oauth.exchange_for_long_lived_token(short_lived_token)
        pages = await facebook_oauth.fetch_eligible_pages(long_lived_token)
        permissions = await facebook_oauth.fetch_permissions(long_lived_token)
    except GraphAPIError:
        logger.warning("facebook_oauth_exchange_failed")
        return build_redirect(mobile_redirect_uri, status="error", reason="provider_error")

    if not pages:
        return build_redirect(mobile_redirect_uri, status="error", reason="incompatible_account")

    linked_labels: list[str] = []
    for page in pages:
        page_token = page.get("access_token")
        if not page_token:
            continue

        account = await social_accounts_repository.upsert_account(
            brand_id=consumed["brand_id"],
            provider="FACEBOOK",
            external_account_id=page["id"],
            name=page.get("name", ""),
            username=None,
            avatar_url=(page.get("picture") or {}).get("data", {}).get("url"),
            auth_method="FACEBOOK_PAGE",
            connected_by_user_id=consumed["user_id"],
        )
        await oauth_tokens_repository.store_token(
            social_account_id=account["id"],
            access_token=page_token,
            refresh_token=None,
            scope=page.get("tasks", []),
            expires_at=None,
        )
        await social_permissions_repository.upsert_permissions(account["id"], permissions)
        linked_labels.append(account.get("name") or "")

        instagram = await facebook_oauth.fetch_linked_instagram_account(page["id"], page_token)
        if instagram:
            ig_account = await social_accounts_repository.upsert_account(
                brand_id=consumed["brand_id"],
                provider="INSTAGRAM",
                external_account_id=instagram["id"],
                name=instagram.get("name") or instagram.get("username", ""),
                username=instagram.get("username"),
                avatar_url=instagram.get("profile_picture_url"),
                auth_method="FACEBOOK_PAGE",
                connected_by_user_id=consumed["user_id"],
            )
            # Instagram calls made through a Page-linked account reuse the
            # same Page token — Meta does not issue a separate IG-specific
            # token for this path (Facebook Login for Business).
            await oauth_tokens_repository.store_token(
                social_account_id=ig_account["id"],
                access_token=page_token,
                refresh_token=None,
                scope=page.get("tasks", []),
                expires_at=None,
            )
            await social_permissions_repository.upsert_permissions(ig_account["id"], permissions)
            linked_labels.append(ig_account.get("username") or ig_account.get("name") or "")

    return build_redirect(
        mobile_redirect_uri,
        status="success",
        network=consumed["provider"].lower(),
        account=linked_labels[0] if linked_labels else "",
    )


async def handle_instagram_callback(*, code: str | None, state: str | None, error: str | None) -> str:
    """Instagram Login direct (no Facebook Page) — a standalone creator
    connects their own Instagram professional account."""
    consumed = await _consume_state_or_raise(state)
    mobile_redirect_uri = consumed["mobile_redirect_uri"]

    if error:
        logger.info("instagram_oauth_denied error=%s", error)
        return build_redirect(mobile_redirect_uri, status="error", reason="permission_denied")

    if not code:
        return build_redirect(mobile_redirect_uri, status="error", reason="provider_error")

    try:
        short_lived_token, ig_user_id = await oauth_instagram.exchange_code_for_token(code)
        long_lived_token = await oauth_instagram.exchange_for_long_lived_token(short_lived_token)
        profile = await oauth_instagram.fetch_profile(ig_user_id, long_lived_token)
    except GraphAPIError:
        logger.warning("instagram_oauth_exchange_failed")
        return build_redirect(mobile_redirect_uri, status="error", reason="provider_error")

    # Personal accounts can complete Instagram Login but can't use the
    # content-publishing/comments/insights capabilities Hootly needs — named
    # explicitly as a risk to guard against in the sprint spec.
    if profile.get("account_type") not in ("BUSINESS", "MEDIA_CREATOR"):
        return build_redirect(mobile_redirect_uri, status="error", reason="incompatible_account")

    account = await social_accounts_repository.upsert_account(
        brand_id=consumed["brand_id"],
        provider="INSTAGRAM",
        external_account_id=ig_user_id,
        name=profile.get("name") or profile.get("username", ""),
        username=profile.get("username"),
        avatar_url=profile.get("profile_picture_url"),
        auth_method="INSTAGRAM_LOGIN",
        connected_by_user_id=consumed["user_id"],
    )
    await oauth_tokens_repository.store_token(
        social_account_id=account["id"],
        access_token=long_lived_token,
        refresh_token=None,
        scope=oauth_instagram.INSTAGRAM_LOGIN_SCOPES,
        expires_at=datetime.now(timezone.utc) + timedelta(days=INSTAGRAM_LOGIN_TOKEN_TTL_DAYS),
    )

    return build_redirect(
        mobile_redirect_uri,
        status="success",
        network="instagram",
        account=account.get("username") or account.get("name") or "",
    )

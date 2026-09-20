"""Refresh / permissions / revoke for a linked social account (Sprint 06 Day 4,
Instagram Login rotation added Sprint 07).

Facebook Page tokens (Facebook Login for Business) don't expire the way an
OAuth2 refresh_token/access_token pair usually does — Meta issues a
non-expiring Page token once a long-lived user token is exchanged via
me/accounts (verified during planning; not assumed). There is therefore no
token to actively rotate for a FACEBOOK_PAGE account: "refresh" here means
re-validating against Meta and surfacing REAUTH_REQUIRED if it no longer
works, not requesting a new token. INSTAGRAM_LOGIN accounts are the opposite:
the long-lived token genuinely expires (~60 days) and must be rotated before
then via `ig_refresh_token` — real rotation, not just revalidation.
"""
from datetime import datetime, timedelta, timezone

from core.exceptions import GraphAPIError
from db import oauth_tokens_repository, social_accounts_repository, social_permissions_repository
from modules.instagram import oauth_instagram
from modules.oauth import facebook_oauth
from modules.oauth.schemas import PermissionsResponse, ProfileResponse, RefreshTokenResponse, RevokeResponse

# The permissions a FACEBOOK_PAGE account needs for Hootly's own publish
# capability — used only to compute missingRequiredPermissions, not to
# enforce anything here.
REQUIRED_FACEBOOK_PERMISSIONS = {"pages_show_list", "pages_read_engagement", "pages_manage_posts"}

# Codes d'erreur de Meta qui disent que LE JETON est invalide (session fermée,
# expiré, révoqué, mot de passe changé). Toute autre erreur (Meta injoignable,
# limite de débit, paramètre refusé) ne dit rien de sa validité : y répondre par
# « reconnexion requise » ferait reconnecter une page saine.
_INVALID_TOKEN_META_CODES = {102, 190}


def _token_is_invalid(exc: GraphAPIError) -> bool:
    return exc.status_code == 401 or exc.meta_code in _INVALID_TOKEN_META_CODES


async def refresh_token(account: dict) -> RefreshTokenResponse:
    if account["auth_method"] == "INSTAGRAM_LOGIN":
        return await _refresh_instagram_login_token(account)
    return await _refresh_facebook_page_token(account)


async def _refresh_facebook_page_token(account: dict) -> RefreshTokenResponse:
    token = await oauth_tokens_repository.get_decrypted_access_token(account["id"])
    if token is None:
        await social_accounts_repository.update_status(account["id"], "REAUTH_REQUIRED")
        raise GraphAPIError(
            status_code=409,
            detail="Aucun token actif pour ce compte ; reconnexion requise.",
            code="REAUTHENTICATION_REQUIRED",
        )

    # Les permissions ne sont pas relues ici : `me/permissions` n'existe pas pour
    # un jeton de page. Celles de l'utilisateur qui a autorisé la page ont été
    # enregistrées à la liaison (page_linking.py) et y restent.
    try:
        await facebook_oauth.fetch_page_identity(token)
    except GraphAPIError as exc:
        if not _token_is_invalid(exc):
            raise
        await social_accounts_repository.update_status(account["id"], "REAUTH_REQUIRED")
        raise GraphAPIError(
            status_code=409,
            detail="Le token n'est plus valide auprès de Meta ; reconnexion requise.",
            code="REAUTHENTICATION_REQUIRED",
        ) from exc

    await social_accounts_repository.update_status(account["id"], "CONNECTED")

    return RefreshTokenResponse(
        social_account_id=account["id"], status="CONNECTED", expires_at=None, refreshed=True
    )


async def _refresh_instagram_login_token(account: dict) -> RefreshTokenResponse:
    token = await oauth_tokens_repository.get_decrypted_access_token(account["id"])
    if token is None:
        await social_accounts_repository.update_status(account["id"], "REAUTH_REQUIRED")
        raise GraphAPIError(
            status_code=409,
            detail="Aucun token actif pour ce compte ; reconnexion requise.",
            code="REAUTHENTICATION_REQUIRED",
        )

    try:
        new_token, expires_in = await oauth_instagram.refresh_long_lived_token(token)
    except GraphAPIError as exc:
        await social_accounts_repository.update_status(account["id"], "REAUTH_REQUIRED")
        raise GraphAPIError(
            status_code=409,
            detail="Le token n'est plus valide auprès d'Instagram ; reconnexion requise.",
            code="REAUTHENTICATION_REQUIRED",
        ) from exc

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    await oauth_tokens_repository.store_token(
        social_account_id=account["id"],
        access_token=new_token,
        refresh_token=None,
        scope=oauth_instagram.INSTAGRAM_LOGIN_SCOPES,
        expires_at=expires_at,
    )
    await social_accounts_repository.update_status(account["id"], "CONNECTED")

    return RefreshTokenResponse(
        social_account_id=account["id"], status="CONNECTED", expires_at=expires_at.isoformat(), refreshed=True
    )


async def get_profile(account: dict) -> ProfileResponse:
    """Re-fetches the account's own name/username/avatar from Meta and
    persists them — `refresh_token` only revalidates the token/permissions,
    it never touches these display fields, so a renamed Page/IG account
    would otherwise stay stale in Hootly forever between OAuth reconnects."""
    token = await oauth_tokens_repository.get_decrypted_access_token(account["id"])
    if token is None:
        await social_accounts_repository.update_status(account["id"], "REAUTH_REQUIRED")
        raise GraphAPIError(
            status_code=409,
            detail="Aucun token actif pour ce compte ; reconnexion requise.",
            code="REAUTHENTICATION_REQUIRED",
        )

    try:
        if account["auth_method"] == "INSTAGRAM_LOGIN":
            data = await oauth_instagram.fetch_profile(account["external_account_id"], token)
            name = data.get("name") or data.get("username", "")
            username = data.get("username")
            avatar_url = data.get("profile_picture_url")
        elif account["provider"] == "INSTAGRAM":
            data = await facebook_oauth.fetch_instagram_profile(account["external_account_id"], token)
            name = data.get("name") or data.get("username", "")
            username = data.get("username")
            avatar_url = data.get("profile_picture_url")
        else:
            data = await facebook_oauth.fetch_page_profile(account["external_account_id"], token)
            name = data.get("name", "")
            username = None
            avatar_url = (data.get("picture") or {}).get("data", {}).get("url")
    except GraphAPIError as exc:
        if not _token_is_invalid(exc):
            raise
        await social_accounts_repository.update_status(account["id"], "REAUTH_REQUIRED")
        raise GraphAPIError(
            status_code=409,
            detail="Le token n'est plus valide auprès de Meta ; reconnexion requise.",
            code="REAUTHENTICATION_REQUIRED",
        ) from exc

    await social_accounts_repository.update_profile(account["id"], name=name, username=username, avatar_url=avatar_url)

    return ProfileResponse(social_account_id=account["id"], name=name, username=username, avatar_url=avatar_url)


async def get_permissions(account: dict) -> PermissionsResponse:
    stored = await social_permissions_repository.list_permissions(account["id"])
    granted = {item["permission"] for item in stored if item["status"] == "GRANTED"}
    required = REQUIRED_FACEBOOK_PERMISSIONS if account["provider"] == "FACEBOOK" else set()
    return PermissionsResponse(
        permissions=sorted(granted),
        missing_required_permissions=sorted(required - granted),
    )


async def revoke(account: dict) -> RevokeResponse:
    """Local-only: marks the account disconnected and the token revoked in
    Hootly's own data. Does NOT also call Meta to revoke the underlying
    grant — Facebook Login's permission model is per-user, not per-Page, so
    there is no verified way to revoke access to just this one Page without
    affecting the account's other linked Pages (flagged as a Meta fact to
    confirm, not assumed either way). A user who wants to fully revoke
    Hootly's access needs to remove it from their own Facebook settings.
    """
    await oauth_tokens_repository.mark_revoked(account["id"])
    await social_accounts_repository.update_status(account["id"], "DISCONNECTED")
    return RevokeResponse(status="DISCONNECTED")

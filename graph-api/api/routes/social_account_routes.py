from fastapi import APIRouter, Depends

from core.exceptions import GraphAPIError
from core.security import require_service_jwt
from db import social_accounts_repository
from modules.oauth import account_service
from modules.oauth.schemas import PermissionsResponse, RefreshTokenResponse, RevokeResponse

router = APIRouter(prefix="/internal/v1/social-accounts", tags=["Social Accounts"])


async def _require_account(social_account_id: str) -> dict:
    account = await social_accounts_repository.get_by_id(social_account_id)
    if account is None:
        raise GraphAPIError(status_code=404, detail="Compte social introuvable.", code="not_found")
    return account


@router.post("/{social_account_id}/refresh-token", response_model=RefreshTokenResponse)
async def refresh_token(
    social_account_id: str,
    _auth: dict = Depends(require_service_jwt("social:write")),
):
    account = await _require_account(social_account_id)
    return await account_service.refresh_token(account)


@router.get("/{social_account_id}/permissions", response_model=PermissionsResponse)
async def get_permissions(
    social_account_id: str,
    _auth: dict = Depends(require_service_jwt("social:read")),
):
    account = await _require_account(social_account_id)
    return await account_service.get_permissions(account)


@router.post("/{social_account_id}/revoke", response_model=RevokeResponse)
async def revoke(
    social_account_id: str,
    _auth: dict = Depends(require_service_jwt("social:write")),
):
    account = await _require_account(social_account_id)
    return await account_service.revoke(account)

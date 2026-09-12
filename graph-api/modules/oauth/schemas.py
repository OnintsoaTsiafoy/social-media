from pydantic import BaseModel, Field


class AuthorizationUrlRequest(BaseModel):
    user_id: str = Field(alias="userId")
    brand_id: str = Field(alias="brandId")
    mobile_redirect_uri: str = Field(alias="mobileRedirectUri")

    model_config = {"populate_by_name": True}


class AuthorizationUrlResponse(BaseModel):
    authorization_url: str = Field(alias="authorizationUrl")
    state: str
    expires_at: str = Field(alias="expiresAt")

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class OAuthCallbackResult(BaseModel):
    redirect: str


class RefreshTokenResponse(BaseModel):
    social_account_id: str = Field(alias="socialAccountId")
    status: str
    expires_at: str | None = Field(default=None, alias="expiresAt")
    refreshed: bool

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class PermissionsResponse(BaseModel):
    permissions: list[str]
    missing_required_permissions: list[str] = Field(alias="missingRequiredPermissions")

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class RevokeResponse(BaseModel):
    status: str


class ProfileResponse(BaseModel):
    social_account_id: str = Field(alias="socialAccountId")
    name: str
    username: str | None = None
    avatar_url: str | None = Field(default=None, alias="avatarUrl")

    model_config = {"populate_by_name": True, "validate_by_alias": True}

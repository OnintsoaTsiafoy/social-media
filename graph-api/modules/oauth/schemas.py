from pydantic import BaseModel, Field


class AuthorizationUrlRequest(BaseModel):
    user_id: str = Field(alias="userId")
    brand_id: str = Field(alias="brandId")
    mobile_redirect_uri: str = Field(alias="mobileRedirectUri")
    # Liaison pilotée par un administrateur de la plateforme (console web) :
    # aucune page n'est liée d'office, l'administrateur les choisit ensuite.
    select_pages: bool = Field(default=False, alias="selectPages")
    initiated_by_user_id: str | None = Field(default=None, alias="initiatedByUserId")

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


class SelectionInstagram(BaseModel):
    external_id: str = Field(alias="externalId")
    username: str | None = None
    name: str | None = None

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class SelectionPage(BaseModel):
    """Une page proposée. Jamais de jeton ici : il reste chiffré dans graph-api."""

    external_id: str = Field(alias="externalId")
    name: str
    picture_url: str | None = Field(default=None, alias="pictureUrl")
    instagram: SelectionInstagram | None = None

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class PageSelectionResponse(BaseModel):
    id: str
    user_id: str = Field(alias="userId")
    brand_id: str = Field(alias="brandId")
    initiated_by_user_id: str | None = Field(default=None, alias="initiatedByUserId")
    expires_at: str = Field(alias="expiresAt")
    pages: list[SelectionPage]

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class PageSelectionLinkRequest(BaseModel):
    page_ids: list[str] = Field(alias="pageIds", min_length=1, max_length=50)

    model_config = {"populate_by_name": True}


class LinkedAccount(BaseModel):
    id: str
    provider: str
    external_account_id: str = Field(alias="externalAccountId")
    name: str
    username: str | None = None

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class PageSelectionLinkResponse(BaseModel):
    accounts: list[LinkedAccount]

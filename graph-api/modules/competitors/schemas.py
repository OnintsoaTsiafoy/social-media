"""Formes de fil de /internal/v1/competitors/* (camelCase sur le fil,
snake_case en Python via des alias, comme modules/facebook/schemas/internal.py).

Particularité de ces trois routes : elles répondent 200 même quand Meta refuse.
Un concurrent illisible ou une permission manquante ne sont pas des pannes de
transport — ce sont les faits que l'appelant doit précisément persister
(`status`, `lastErrorCode`). Seules les erreurs d'infrastructure (compte social
introuvable, aucun token actif, configuration Meta absente) restent des erreurs
HTTP, comme partout ailleurs dans ce service.
"""
from pydantic import BaseModel, Field


class CompetitorProfileRequest(BaseModel):
    # Compte social de la marque au nom duquel on interroge Meta. Obligatoire :
    # Business Discovery part toujours du compte Instagram de la marque, et une
    # Page concurrente se lit avec un token de Page réel — jamais avec le
    # token global hérité du Sprint 05.
    social_account_id: str = Field(alias="socialAccountId")
    platform: str
    # Nom d'utilisateur, identifiant numérique ou nom de vanité de la Page.
    handle: str

    model_config = {"populate_by_name": True}


class CompetitorProfileResponse(BaseModel):
    status: str
    external_id: str | None = Field(default=None, alias="externalId")
    username: str | None = None
    name: str | None = None
    profile_url: str | None = Field(default=None, alias="profileUrl")
    avatar_url: str | None = Field(default=None, alias="avatarUrl")
    # « Compte professionnel », « Page », ou None quand Meta ne le dit pas.
    account_type: str | None = Field(default=None, alias="accountType")
    followers_count: int | None = Field(default=None, alias="followersCount")
    posts_count: int | None = Field(default=None, alias="postsCount")
    # Champs demandés que Meta n'a pas rendus, nommés un par un : c'est ce qui
    # permet à l'écran d'écrire « Non disponible » sur la bonne ligne plutôt
    # que de masquer tout le bloc.
    unavailable_fields: list[str] = Field(default_factory=list, alias="unavailableFields")
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class CompetitorPostItem(BaseModel):
    external_post_id: str = Field(alias="externalPostId")
    message: str | None = None
    media_type: str | None = Field(default=None, alias="mediaType")
    permalink: str | None = None
    published_at: str | None = Field(default=None, alias="publishedAt")
    reactions_count: int | None = Field(default=None, alias="reactionsCount")
    comments_count: int | None = Field(default=None, alias="commentsCount")
    shares_count: int | None = Field(default=None, alias="sharesCount")

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class CompetitorPostsRequest(CompetitorProfileRequest):
    limit: int = 25
    cursor: str | None = None
    # Nombre maximal de pages parcourues en un appel. Borne le coût Graph API
    # d'une exécution, comme `comments_sync_max_pages_per_post` le fait pour
    # les commentaires.
    max_pages: int = Field(default=4, alias="maxPages")

    model_config = {"populate_by_name": True}


class CompetitorPostsResponse(BaseModel):
    status: str
    posts: list[CompetitorPostItem] = Field(default_factory=list)
    next_cursor: str | None = Field(default=None, alias="nextCursor")
    has_more: bool = Field(default=False, alias="hasMore")
    unavailable_fields: list[str] = Field(default_factory=list, alias="unavailableFields")
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class AccountAudienceRequest(BaseModel):
    social_account_id: str = Field(alias="socialAccountId")

    model_config = {"populate_by_name": True}


class AccountAudienceResponse(BaseModel):
    """Audience du compte de la marque elle-même — pas un concurrent.

    Relevée par la même passe pour que le taux d'engagement des deux côtés de
    la comparaison soit calculé de la même façon (section 8 du TODO :
    « Ne pas comparer deux métriques calculées différemment »).
    """
    status: str
    followers_count: int | None = Field(default=None, alias="followersCount")
    posts_count: int | None = Field(default=None, alias="postsCount")
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")

    model_config = {"populate_by_name": True, "validate_by_alias": True}

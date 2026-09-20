"""Wire shapes for /internal/v1, matching contracts/openapi/social-internal.yaml
and sprint_listing/APIS/03_FASTAPI_RESEAUX_SOCIAUX.md exactly (camelCase on the
wire, snake_case in Python via Field aliases)."""
from pydantic import BaseModel, Field


class PublishTarget(BaseModel):
    publication_target_id: str = Field(alias="publicationTargetId")
    social_account_id: str | None = Field(default=None, alias="socialAccountId")
    provider: str
    content: str = ""
    media_urls: list[str] = Field(default_factory=list, alias="mediaUrls")

    model_config = {"populate_by_name": True}


class PublishRequest(BaseModel):
    publication_id: str = Field(alias="publicationId")
    targets: list[PublishTarget]

    model_config = {"populate_by_name": True}


class PublishTargetResult(BaseModel):
    provider: str
    status: str
    external_publication_id: str | None = Field(default=None, alias="externalPublicationId")
    error_code: str | None = Field(default=None, alias="errorCode")

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class PublishResponse(BaseModel):
    publication_id: str = Field(alias="publicationId")
    results: list[PublishTargetResult]

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class CommentSyncItem(BaseModel):
    external_comment_id: str = Field(alias="externalCommentId")
    external_publication_id: str = Field(alias="externalPublicationId")
    author_external_id: str | None = Field(default=None, alias="authorExternalId")
    author_name: str | None = Field(default=None, alias="authorName")
    content: str | None = None
    created_at: str | None = Field(default=None, alias="createdAt")
    updated_at: str | None = Field(default=None, alias="updatedAt")
    is_deleted: bool = Field(default=False, alias="isDeleted")

    model_config = {"populate_by_name": True, "validate_by_alias": True}


# Sprint 08 Day 3: dropped `since`/`cursor`/`nextCursor`/`hasMore` from the
# shape sprint_listing/APIS/03_FASTAPI_RESEAUX_SOCIAUX.md originally sketched
# — checked directly against Meta's current reference docs during planning:
# neither the Facebook nor the Instagram comments edge supports filtering by
# timestamp at all, so `since` could never do anything. With no real caller
# yet (nothing in Sprints 05-07 ever invoked this route), internal_service.py
# now walks every page of every requested post internally and persists as it
# goes, so client-facing cursoring has nothing left to represent either.
class CommentsSyncRequest(BaseModel):
    social_account_id: str | None = Field(default=None, alias="socialAccountId")
    provider: str
    publication_external_ids: list[str] = Field(
        default_factory=list, alias="publicationExternalIds"
    )
    limit: int = 100

    model_config = {"populate_by_name": True}


class CommentsSyncResponse(BaseModel):
    comments: list[CommentSyncItem]

    model_config = {"populate_by_name": True, "validate_by_alias": True}


# Sprint 08 Day 5: takes Hootly's own comment id, not a provider/external-id
# pair — nothing before this sprint had a `social_comments` row to resolve
# through, so the original shape (mirroring publish/sync's socialAccountId+
# provider) never had anything to key off of. graph-api now derives the
# social account, provider, and external comment id from the comment row
# itself (the single source of truth it already owns), so the caller no
# longer needs to know or repeat any of that. `user_id` is who to attribute
# the reply and the resulting status change to — same reasoning as
# AuthorizationUrlRequest.user_id: the caller is a service JWT, not a user
# JWT, so the acting user has to be named explicitly in the body.
class CommentsReplyRequest(BaseModel):
    comment_id: str = Field(alias="commentId")
    user_id: str = Field(alias="userId")
    text: str

    model_config = {"populate_by_name": True}


class CommentsReplyResponse(BaseModel):
    status: str
    external_reply_id: str | None = Field(default=None, alias="externalReplyId")
    sent_at: str | None = Field(default=None, alias="sentAt")

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class PostSyncItem(BaseModel):
    """Un post du fil d'un compte, tel que lu chez Meta.

    `reactions`/`comments` valent None quand Meta n'a rien renvoyé (permission
    absente) : jamais un 0 inventé. `shares` fait exception — Meta omet le champ
    quand il n'y a aucun partage, l'absence EST alors la valeur (même règle que
    post_analytics_service).
    """

    external_publication_id: str = Field(alias="externalPublicationId")
    content: str = ""
    permalink_url: str | None = Field(default=None, alias="permalinkUrl")
    published_at: str | None = Field(default=None, alias="publishedAt")
    reactions: int | None = None
    comments: int | None = None
    shares: int | None = None

    model_config = {"populate_by_name": True, "validate_by_alias": True}


# Import des publications d'une Page. `socialAccountId` est obligatoire (pas de
# repli sur la Page globale de l'.env comme pour les commentaires) : un post
# importé doit être rattaché à une marque, donc à un compte réel. Pas de
# `since`/`full` côté appelant : initiale ou incrémentale est déduit de
# `social_accounts.last_posts_sync_at`, dont graph-api est seul écrivain — une
# seule source de vérité, impossible à désynchroniser d'un job.
class PostsSyncRequest(BaseModel):
    social_account_id: str = Field(alias="socialAccountId")
    provider: str
    cursor: str | None = None

    model_config = {"populate_by_name": True}


class PostsSyncResponse(BaseModel):
    mode: str
    created: int
    updated: int
    unchanged: int
    # Posts ignorés parce que inexploitables (pas de date de création) — jamais
    # une erreur de base de données, qui fait échouer l'appel.
    skipped: int
    # Curseur de reprise tant que `done` est faux ; le dernier appel (done=True)
    # est celui qui note la synchronisation comme achevée.
    next_cursor: str | None = Field(default=None, alias="nextCursor")
    done: bool

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class MetricsSyncRequest(BaseModel):
    social_account_id: str | None = Field(default=None, alias="socialAccountId")
    provider: str
    publication_external_ids: list[str] = Field(
        default_factory=list, alias="publicationExternalIds"
    )
    date_from: str | None = Field(default=None, alias="from")
    date_to: str | None = Field(default=None, alias="to")

    model_config = {"populate_by_name": True}


class MetricItem(BaseModel):
    external_publication_id: str = Field(alias="externalPublicationId")
    collected_at: str = Field(alias="collectedAt")
    reactions: int | None = None
    comments: int | None = None
    shares: int | None = None
    reach: int | None = None
    impressions: int | None = None

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class MetricsSyncResponse(BaseModel):
    metrics: list[MetricItem]

    model_config = {"populate_by_name": True, "validate_by_alias": True}

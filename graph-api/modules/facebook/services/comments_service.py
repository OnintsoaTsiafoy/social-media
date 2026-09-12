from modules.facebook.clients.facebook_client import FacebookClient, facebook_client
from modules.facebook.schemas.comments import (
    CommentResponse,
    ReplyCreate,
    ReplyCreateResponse,
    ReplyResponse,
)
from modules.facebook.schemas.pagination import PaginatedList
from modules.facebook.services.pagination_helpers import meta_pagination_params, paging_from_meta


async def get_post_comments(
    post_id: str,
    limit: int = 25,
    after: str | None = None,
    before: str | None = None,
    client: FacebookClient = facebook_client,
) -> PaginatedList[CommentResponse]:
    """Récupère les commentaires d'une publication Facebook.

    ``client`` defaults to the legacy global singleton (/facebook/*); Sprint 07
    passes a per-account client (real token) from /internal/v1 instead.
    """
    comment_fields = (
        "id,message,from{id,name,picture.width(120).height(120)},"
        "created_time,like_count,comment_count,reactions.limit(0).summary(total_count),"
        "comments.limit(25){id,message,from{id,name,picture.width(120).height(120)},"
        "created_time,like_count,comment_count,reactions.limit(0).summary(total_count)}"
    )

    params = {"fields": comment_fields, **meta_pagination_params(limit, after, before)}
    data = await client.get(f"{post_id}/comments", params=params)
    comments = [CommentResponse(**comment) for comment in data.get("data", [])]
    return PaginatedList[CommentResponse](data=comments, paging=paging_from_meta(data.get("paging")))


async def get_comment_replies(
    comment_id: str,
    limit: int = 25,
    after: str | None = None,
    before: str | None = None,
    client: FacebookClient = facebook_client,
) -> PaginatedList[ReplyResponse]:
    """Récupère les réponses à un commentaire Facebook."""
    params = {
        "fields": "id,message,from{id,name,picture.width(120).height(120)},created_time",
        **meta_pagination_params(limit, after, before),
    }
    data = await client.get(f"{comment_id}/comments", params=params)
    replies = [ReplyResponse(**reply) for reply in data.get("data", [])]
    return PaginatedList[ReplyResponse](data=replies, paging=paging_from_meta(data.get("paging")))


async def reply_to_comment(
    comment_id: str, body: ReplyCreate, client: FacebookClient = facebook_client
) -> ReplyCreateResponse:
    """Répond à un commentaire Facebook."""
    data = await client.post_form(
        f"{comment_id}/comments",
        data={"message": body.message},
    )
    return ReplyCreateResponse(**data)

from modules.facebook.clients.facebook_client import facebook_client
from modules.facebook.schemas.comments import (
    CommentResponse,
    ReplyCreate,
    ReplyCreateResponse,
    ReplyResponse,
)


async def get_post_comments(post_id: str) -> list[CommentResponse]:
    """Récupère les commentaires d'une publication Facebook."""
    comment_fields = (
        "id,message,from{id,name,picture.width(120).height(120)},"
        "created_time,like_count,comment_count,reactions.limit(0).summary(total_count),"
        "comments.limit(25){id,message,from{id,name,picture.width(120).height(120)},"
        "created_time,like_count,comment_count,reactions.limit(0).summary(total_count)}"
    )

    data = await facebook_client.get(
        f"{post_id}/comments",
        params={"fields": comment_fields, "limit": 50},
    )
    return [CommentResponse(**comment) for comment in data.get("data", [])]


async def get_comment_replies(comment_id: str) -> list[ReplyResponse]:
    """Récupère les réponses à un commentaire Facebook."""
    data = await facebook_client.get(
        f"{comment_id}/comments",
        params={
            "fields": "id,message,from{id,name,picture.width(120).height(120)},created_time"
        },
    )
    return [ReplyResponse(**reply) for reply in data.get("data", [])]


async def reply_to_comment(comment_id: str, body: ReplyCreate) -> ReplyCreateResponse:
    """Répond à un commentaire Facebook."""
    data = await facebook_client.post_form(
        f"{comment_id}/comments",
        data={"message": body.message},
    )
    return ReplyCreateResponse(**data)

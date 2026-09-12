from fastapi import APIRouter, Body, File, Form, UploadFile

from modules.facebook.schemas.comments import (
    CommentResponse,
    ReplyCreate,
    ReplyCreateResponse,
    ReplyResponse,
)
from modules.facebook.schemas.posts import (
    CommunityManagersStatsResponse,
    PostCreateResponse,
    PostUpdate,
    PostResponse,
    PostStatsResponse,
    ScheduledPostCreate,
    ScheduledPostResponse,
    ScheduledPostUpdate,
)
from modules.facebook.schemas.pagination import PaginatedList
from modules.facebook.schemas.post_analytics import PostAnalyticsResponse
from modules.facebook.schemas.post_insights import PostInsightsResponse
from modules.facebook.schemas.stories import StoryCreateResponse, StoryResponse
from modules.facebook.services.comments_service import (
    get_comment_replies,
    get_post_comments,
    reply_to_comment,
)
from modules.facebook.services.posts_service import (
    create_post,
    create_scheduled_post,
    delete_post,
    delete_scheduled_post,
    get_community_managers_stats,
    get_page_posts,
    get_post_stats,
    list_scheduled_posts,
    update_post,
    update_scheduled_post,
)
from modules.facebook.services.post_analytics_service import get_post_analytics
from modules.facebook.services.post_insights_service import get_post_insights
from modules.facebook.services.stories_service import create_story, delete_story, list_stories

router = APIRouter(prefix="/facebook", tags=["Facebook"])


@router.get("/posts", response_model=PaginatedList[PostResponse])
async def list_posts(
    since: str | None = None,
    until: str | None = None,
    limit: int = 25,
    after: str | None = None,
    before: str | None = None,
):
    """Récupère les publications de la page Facebook.

    Query parameters:
    - since: Date de début (format ISO: "2024-01-01")
    - until: Date de fin (format ISO: "2024-12-31")
    - limit, after, before: pagination par curseur
    """
    return await get_page_posts(since=since, until=until, limit=limit, after=after, before=before)


@router.post("/posts", response_model=PostCreateResponse, status_code=201)
async def publish_post(
    message: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
):
    """
    Publie un post sur la page Facebook.
    - Texte seul          → message uniquement (form-data)
    - 1 image             → file image + message optionnel
    - N images            → plusieurs files image + message optionnel
    - 1 vidéo             → file vidéo + message optionnel
    """
    return await create_post(message=message, files=files)


@router.put("/posts/{post_id}")
async def edit_post(post_id: str, body: PostUpdate = Body(...)):
    """Modifie le message d'une publication Facebook existante."""
    return await update_post(post_id=post_id, message=body.message)


@router.delete("/posts/{post_id}")
async def remove_post(post_id: str):
    """Supprime une publication Facebook."""
    return await delete_post(post_id)


@router.post("/scheduled-posts", response_model=PostCreateResponse, status_code=201)
async def schedule_post(
    message: str | None = Form(None),
    scheduled_publish_time: str = Form(...),
    timezone_offset_minutes: int | None = Form(None),
    files: list[UploadFile] = File(default=[]),
):
    """Programme une publication Facebook pour une date future.
    
    Supports :
    - Texte seul
    - 1 image + message optionnel
    - N images + message optionnel
    - 1 vidéo + message optionnel
    """
    return await create_scheduled_post(
        message=message,
        scheduled_publish_time=scheduled_publish_time,
        timezone_offset_minutes=timezone_offset_minutes,
        files=files,
    )


@router.get("/scheduled-posts", response_model=PaginatedList[ScheduledPostResponse])
async def get_scheduled_posts(limit: int = 25, after: str | None = None, before: str | None = None):
    """Liste les publications Facebook programmees."""
    return await list_scheduled_posts(limit=limit, after=after, before=before)


@router.put("/scheduled-posts/{post_id}", response_model=PostCreateResponse)
async def edit_scheduled_post(
    post_id: str,
    message: str | None = Form(None),
    scheduled_publish_time: str | None = Form(None),
    timezone_offset_minutes: int | None = Form(None),
    files: list[UploadFile] = File(default=[]),
):
    """Modifie le contenu ou la date d'une publication programmee.
    
    Peut aussi uploader des médias pour remplacer l'attachement.
    """
    return await update_scheduled_post(
        post_id,
        message=message,
        scheduled_publish_time=scheduled_publish_time,
        timezone_offset_minutes=timezone_offset_minutes,
        files=files,
    )


@router.delete("/scheduled-posts/{post_id}")
async def remove_scheduled_post(post_id: str):
    """Annule (supprime) une publication programmee."""
    return await delete_scheduled_post(post_id)


@router.get("/posts/{post_id}/comments", response_model=PaginatedList[CommentResponse])
async def list_post_comments(
    post_id: str, limit: int = 25, after: str | None = None, before: str | None = None
):
    """Récupère les commentaires d'une publication Facebook."""
    return await get_post_comments(post_id, limit=limit, after=after, before=before)


@router.get("/comments/{comment_id}/replies", response_model=PaginatedList[ReplyResponse])
async def list_comment_replies(
    comment_id: str, limit: int = 25, after: str | None = None, before: str | None = None
):
    """Récupère les réponses à un commentaire Facebook."""
    return await get_comment_replies(comment_id, limit=limit, after=after, before=before)


@router.post("/comments/{comment_id}/reply", response_model=ReplyCreateResponse, status_code=201)
async def create_comment_reply(
    comment_id: str,
    body: ReplyCreate = Body(...),
):
    """Répond à un commentaire Facebook."""
    return await reply_to_comment(comment_id, body)


@router.get("/posts/{post_id}/stats", response_model=PostStatsResponse)
async def post_stats(post_id: str):
    """Récupère les statistiques d'une publication Facebook (réactions, commentaires, partages)."""
    return await get_post_stats(post_id)


@router.get("/community-managers/stats", response_model=CommunityManagersStatsResponse)
async def community_managers_stats(since: str | None = None, until: str | None = None):
    """Récupère les statistiques d'activité agrégées par auteur de publication."""
    return await get_community_managers_stats(since=since, until=until)


@router.get("/posts/{post_id}/analytics", response_model=PostAnalyticsResponse)
async def post_analytics(post_id: str):
    """Récupère une vue analytique complète d'une publication Facebook."""
    return await get_post_analytics(post_id)


@router.get("/posts/{post_id}/insights", response_model=PostInsightsResponse)
async def post_insights(post_id: str):
    """Récupère stats + analytiques complètes d'une publication Facebook."""
    return await get_post_insights(post_id)


@router.post("/stories", response_model=StoryCreateResponse, status_code=201)
async def publish_story(
    file: UploadFile = File(...),
    message: str | None = Form(None),
):
    """Publie une story Facebook (image ou vidéo)."""
    return await create_story(file=file, message=message)


@router.get("/stories", response_model=PaginatedList[StoryResponse])
async def get_stories(limit: int = 25, after: str | None = None, before: str | None = None):
    """Liste les stories de la page."""
    return await list_stories(limit=limit, after=after, before=before)


@router.delete("/stories/{story_id}")
async def remove_story(story_id: str):
    """Supprime une story."""
    return await delete_story(story_id)

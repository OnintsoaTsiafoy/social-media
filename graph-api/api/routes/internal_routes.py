import uuid

from fastapi import APIRouter, Depends, Header, HTTPException

from core.security import require_service_jwt
from modules.facebook.schemas.internal import (
    CommentsReplyRequest,
    CommentsReplyResponse,
    CommentsSyncRequest,
    CommentsSyncResponse,
    MetricsSyncRequest,
    MetricsSyncResponse,
    PostsSyncRequest,
    PostsSyncResponse,
    PublishRequest,
    PublishResponse,
)
from modules.competitors import service as competitor_service
from modules.competitors.schemas import (
    AccountAudienceRequest,
    AccountAudienceResponse,
    CompetitorPostsRequest,
    CompetitorPostsResponse,
    CompetitorProfileRequest,
    CompetitorProfileResponse,
)
from modules.facebook.services import internal_service
from modules.facebook.services.idempotency import get_cached_response, store_response
from modules.oauth import selection_service
from modules.oauth import service as oauth_service
from modules.oauth.schemas import (
    AuthorizationUrlRequest,
    AuthorizationUrlResponse,
    PageSelectionLinkRequest,
    PageSelectionLinkResponse,
    PageSelectionResponse,
)

router = APIRouter(prefix="/internal/v1", tags=["Internal"])


@router.post("/oauth/{provider}/authorization-url", response_model=AuthorizationUrlResponse)
async def oauth_authorization_url(
    provider: str,
    body: AuthorizationUrlRequest,
    _auth: dict = Depends(require_service_jwt("social:write")),
):
    return await oauth_service.create_authorization_url(provider, body)


@router.get("/oauth/selections/{selection_id}", response_model=PageSelectionResponse)
async def oauth_selection(
    selection_id: uuid.UUID,
    _auth: dict = Depends(require_service_jwt("social:read")),
):
    """Pages que le compte Facebook autorisé peut gérer, sans jeton."""
    return await selection_service.get_selection(str(selection_id))


@router.post("/oauth/selections/{selection_id}/link", response_model=PageSelectionLinkResponse)
async def oauth_selection_link(
    selection_id: uuid.UUID,
    body: PageSelectionLinkRequest,
    _auth: dict = Depends(require_service_jwt("social:write")),
):
    """Lie les pages choisies à la marque de la sélection (usage unique)."""
    return await selection_service.link_selection(str(selection_id), body.page_ids)


def _require_idempotency_key(
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> str:
    if not idempotency_key or not idempotency_key.strip():
        raise HTTPException(status_code=400, detail="En-tête Idempotency-Key requis.")
    return idempotency_key


@router.post("/publications/publish", response_model=PublishResponse)
async def publish(
    body: PublishRequest,
    idempotency_key: str = Depends(_require_idempotency_key),
    _auth: dict = Depends(require_service_jwt("social:write")),
):
    payload = body.model_dump(by_alias=True)
    cached = await get_cached_response("publications/publish", idempotency_key, payload)
    if cached is not None:
        return cached
    response = await internal_service.publish(body)
    response_payload = response.model_dump(by_alias=True)
    await store_response("publications/publish", idempotency_key, payload, response_payload)
    return response


@router.post("/comments/sync", response_model=CommentsSyncResponse)
async def comments_sync(
    body: CommentsSyncRequest,
    _auth: dict = Depends(require_service_jwt("social:read")),
):
    return await internal_service.sync_comments(body)


@router.post("/posts/sync", response_model=PostsSyncResponse)
async def posts_sync(
    body: PostsSyncRequest,
    _auth: dict = Depends(require_service_jwt("social:read")),
):
    """Import des publications d'une Page (initial, puis incrémental) : lit le fil
    chez Meta et écrit en base, `posts_sync_pages_per_call` pages par appel — voir
    `internal_service.sync_posts`. Scope `social:read` comme /comments/sync et
    /metrics/sync : rien n'est écrit chez Meta."""
    return await internal_service.sync_posts(body)


@router.post("/comments/reply", response_model=CommentsReplyResponse)
async def comments_reply(
    body: CommentsReplyRequest,
    idempotency_key: str = Depends(_require_idempotency_key),
    _auth: dict = Depends(require_service_jwt("social:write")),
):
    payload = body.model_dump(by_alias=True)
    cached = await get_cached_response("comments/reply", idempotency_key, payload)
    if cached is not None:
        return cached
    response = await internal_service.reply_comment(body)
    response_payload = response.model_dump(by_alias=True)
    await store_response("comments/reply", idempotency_key, payload, response_payload)
    return response


@router.post("/metrics/sync", response_model=MetricsSyncResponse)
async def metrics_sync(
    body: MetricsSyncRequest,
    _auth: dict = Depends(require_service_jwt("social:read")),
):
    return await internal_service.sync_metrics(body)


# --- Analyse concurrentielle -------------------------------------------------
# Lecture seule et scope `social:read` : ces routes n'écrivent jamais chez Meta
# ni en base. Elles répondent 200 même quand Meta refuse — le refus est dans
# `status` (voir modules/competitors/service.py).


@router.post("/competitors/profile", response_model=CompetitorProfileResponse)
async def competitor_profile(
    body: CompetitorProfileRequest,
    _auth: dict = Depends(require_service_jwt("social:read")),
):
    """Résout et lit les informations publiques accessibles d'un concurrent."""
    return await competitor_service.profile(body)


@router.post("/competitors/posts", response_model=CompetitorPostsResponse)
async def competitor_posts(
    body: CompetitorPostsRequest,
    _auth: dict = Depends(require_service_jwt("social:read")),
):
    """Publications publiques accessibles, paginées par curseur."""
    return await competitor_service.posts(body)


@router.post("/accounts/audience", response_model=AccountAudienceResponse)
async def account_audience(
    body: AccountAudienceRequest,
    _auth: dict = Depends(require_service_jwt("social:read")),
):
    """Audience du compte de la marque lui-même, relevée pour que la
    comparaison avec un concurrent porte sur des taux calculés identiquement."""
    return await competitor_service.account_audience(body)

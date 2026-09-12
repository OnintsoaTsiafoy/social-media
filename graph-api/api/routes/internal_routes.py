from fastapi import APIRouter, Depends, Header, HTTPException

from core.security import require_service_jwt
from modules.facebook.schemas.internal import (
    CommentsReplyRequest,
    CommentsReplyResponse,
    CommentsSyncRequest,
    CommentsSyncResponse,
    MetricsSyncRequest,
    MetricsSyncResponse,
    PublishRequest,
    PublishResponse,
)
from modules.facebook.services import internal_service
from modules.facebook.services.idempotency import get_cached_response, store_response
from modules.oauth import service as oauth_service
from modules.oauth.schemas import AuthorizationUrlRequest, AuthorizationUrlResponse

router = APIRouter(prefix="/internal/v1", tags=["Internal"])


@router.post("/oauth/{provider}/authorization-url", response_model=AuthorizationUrlResponse)
async def oauth_authorization_url(
    provider: str,
    body: AuthorizationUrlRequest,
    _auth: dict = Depends(require_service_jwt("social:write")),
):
    return await oauth_service.create_authorization_url(provider, body)


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

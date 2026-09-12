"""Business logic behind /internal/v1 (Sprint 05 Day 5, extended Sprint 07).

Deliberately thin: every operation resolves the target's real social account
+ decrypted token, then delegates to the matching SocialProvider (Facebook or
Instagram) instead of calling httpx directly (CLAUDE.md's rule for this
codebase). A request with no ``socialAccountId`` falls back to the Sprint 05
behavior (the single globally-configured Facebook Page) — kept only for
backward compatibility; every real caller since Sprint 06 passes a resolved
account.
"""
from datetime import datetime, timezone

from core.exceptions import GraphAPIError
from db import oauth_tokens_repository, social_accounts_repository
from modules.facebook.clients.facebook_client import facebook_client
from modules.facebook.provider import FacebookProvider
from modules.facebook.schemas.internal import (
    CommentsReplyRequest,
    CommentsReplyResponse,
    CommentSyncItem,
    CommentsSyncRequest,
    CommentsSyncResponse,
    MetricItem,
    MetricsSyncRequest,
    MetricsSyncResponse,
    PublishRequest,
    PublishResponse,
    PublishTarget,
    PublishTargetResult,
)
from modules.social.provider import get_provider

_LEGACY_PROVIDERS = {"facebook"}


def _require_legacy_provider(provider: str) -> None:
    if provider.lower() not in _LEGACY_PROVIDERS:
        raise GraphAPIError(
            status_code=422,
            detail=f"Provider '{provider}' non supporté sans socialAccountId.",
            code="unprocessable",
        )


async def _resolve_account_and_token(social_account_id: str | None) -> tuple[dict | None, str | None]:
    """(None, None) means "use the Sprint 05 legacy global Facebook client" —
    only reachable when the caller omits socialAccountId entirely."""
    if social_account_id is None:
        return None, None

    account = await social_accounts_repository.get_by_id(social_account_id)
    if account is None:
        raise GraphAPIError(status_code=404, detail="Compte social introuvable.", code="not_found")

    token = await oauth_tokens_repository.get_decrypted_access_token(social_account_id)
    if token is None:
        raise GraphAPIError(
            status_code=409,
            detail="Aucun token actif pour ce compte ; reconnexion requise.",
            code="TOKEN_EXPIRED",
        )
    return account, token


def _require_matching_provider(account: dict, requested_provider: str) -> None:
    if account["provider"].lower() != requested_provider.lower():
        raise GraphAPIError(
            status_code=422,
            detail="Le provider indiqué ne correspond pas au compte résolu.",
            code="unprocessable",
        )


async def _publish_legacy_global(target: PublishTarget) -> str:
    """Sprint 05 fallback: Facebook only, the single .env-configured Page."""
    _require_legacy_provider(target.provider)
    return await FacebookProvider().publish(
        account={"external_account_id": facebook_client.page_id},
        token=facebook_client.access_token,
        content=target.content,
        media_urls=target.media_urls,
    )


async def publish(body: PublishRequest) -> PublishResponse:
    results: list[PublishTargetResult] = []
    for target in body.targets:
        try:
            account, token = await _resolve_account_and_token(target.social_account_id)
            if account is None:
                external_id = await _publish_legacy_global(target)
            else:
                _require_matching_provider(account, target.provider)
                external_id = await get_provider(account["provider"]).publish(
                    account=account, token=token, content=target.content, media_urls=target.media_urls
                )
            results.append(
                PublishTargetResult(
                    provider=target.provider,
                    status="SUCCESS",
                    external_publication_id=external_id,
                    error_code=None,
                )
            )
        except GraphAPIError as exc:
            results.append(
                PublishTargetResult(
                    provider=target.provider,
                    status="FAILED",
                    external_publication_id=None,
                    error_code=exc.code,
                )
            )
    return PublishResponse(publication_id=body.publication_id, results=results)


async def sync_comments(body: CommentsSyncRequest) -> CommentsSyncResponse:
    account, token = await _resolve_account_and_token(body.social_account_id)
    if account is not None:
        _require_matching_provider(account, body.provider)
        provider = get_provider(account["provider"])
    else:
        _require_legacy_provider(body.provider)
        provider = FacebookProvider()
        account = {"external_account_id": facebook_client.page_id}
        token = facebook_client.access_token

    external_ids = body.publication_external_ids or []
    single_target = len(external_ids) == 1
    comments: list[CommentSyncItem] = []
    has_more = False
    next_cursor: str | None = None

    for external_publication_id in external_ids:
        items, cursor, more = await provider.get_comments(
            account=account,
            token=token,
            external_publication_id=external_publication_id,
            limit=body.limit,
            cursor=body.cursor if single_target else None,
        )
        comments.extend(items)
        has_more = has_more or more
        # A single shared cursor can't meaningfully represent N independent
        # posts' pagination state; real multi-post cursoring is Sprint 08 scope.
        if single_target:
            next_cursor = cursor

    return CommentsSyncResponse(comments=comments, next_cursor=next_cursor, has_more=has_more)


async def reply_comment(body: CommentsReplyRequest) -> CommentsReplyResponse:
    account, token = await _resolve_account_and_token(body.social_account_id)
    if account is not None:
        _require_matching_provider(account, body.provider)
        provider = get_provider(account["provider"])
    else:
        _require_legacy_provider(body.provider)
        provider = FacebookProvider()
        account = {"external_account_id": facebook_client.page_id}
        token = facebook_client.access_token

    external_reply_id = await provider.reply_to_comment(
        account=account, token=token, external_comment_id=body.external_comment_id, text=body.text
    )
    return CommentsReplyResponse(
        status="SUCCESS",
        external_reply_id=external_reply_id,
        sent_at=datetime.now(timezone.utc).isoformat(),
    )


async def sync_metrics(body: MetricsSyncRequest) -> MetricsSyncResponse:
    account, token = await _resolve_account_and_token(body.social_account_id)
    if account is not None:
        _require_matching_provider(account, body.provider)
        provider = get_provider(account["provider"])
    else:
        _require_legacy_provider(body.provider)
        provider = FacebookProvider()
        account = {"external_account_id": facebook_client.page_id}
        token = facebook_client.access_token

    metrics: list[MetricItem] = []
    for external_publication_id in body.publication_external_ids:
        insights = await provider.get_insights(
            account=account, token=token, external_publication_id=external_publication_id
        )
        metrics.append(
            MetricItem(
                external_publication_id=external_publication_id,
                collected_at=datetime.now(timezone.utc).isoformat(),
                reactions=insights["reactions"],
                comments=insights["comments"],
                shares=insights["shares"],
                reach=insights["reach"],
                impressions=insights["impressions"],
            )
        )
    return MetricsSyncResponse(metrics=metrics)

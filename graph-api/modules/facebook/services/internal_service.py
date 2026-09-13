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

from core.config import settings
from core.exceptions import GraphAPIError
from db import (
    oauth_tokens_repository,
    publication_targets_repository,
    sent_responses_repository,
    social_accounts_repository,
    social_comments_repository,
    social_metrics_repository,
)
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


def _parse_meta_timestamp(value: str | None):
    """CommentSyncItem carries Meta's timestamps as plain strings (the
    existing wire contract), but the repository needs real datetimes for a
    timestamptz column. Never lets a surprising format break the whole sync —
    same "one bad item doesn't fail the batch" reasoning as the webhook path."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


async def _persist_comment(social_account_id: str, item: CommentSyncItem) -> None:
    await social_comments_repository.upsert_comment(
        social_account_id=social_account_id,
        external_comment_id=item.external_comment_id,
        external_publication_id=item.external_publication_id,
        author_external_id=item.author_external_id,
        author_name=item.author_name,
        content=item.content,
        meta_created_at=_parse_meta_timestamp(item.created_at),
        meta_updated_at=_parse_meta_timestamp(item.updated_at),
    )


async def sync_comments(body: CommentsSyncRequest) -> CommentsSyncResponse:
    """Walks every page of every requested post internally (Sprint 08 Day 3)
    instead of exposing cursoring to the caller — see schemas/internal.py's
    comment on CommentsSyncRequest for why. Persists as it goes and detects
    deletions by diffing against what's already known locally; a real
    resolved account also gets its `last_comments_sync_at` bumped in the same
    call. The Sprint 05 legacy path (no socialAccountId) stays read-only/
    transient, matching its original behavior — there's no social_accounts
    row to persist against or bump."""
    account, token = await _resolve_account_and_token(body.social_account_id)
    if account is not None:
        _require_matching_provider(account, body.provider)
        provider = get_provider(account["provider"])
    else:
        _require_legacy_provider(body.provider)
        provider = FacebookProvider()
        account = {"external_account_id": facebook_client.page_id}
        token = facebook_client.access_token

    all_comments: list[CommentSyncItem] = []

    for external_publication_id in body.publication_external_ids or []:
        cursor: str | None = None
        seen_external_ids: set[str] = set()
        for _ in range(settings.comments_sync_max_pages_per_post):
            items, cursor, has_more = await provider.get_comments(
                account=account, token=token, external_publication_id=external_publication_id,
                limit=body.limit, cursor=cursor,
            )
            all_comments.extend(items)
            if account.get("id"):
                for item in items:
                    seen_external_ids.add(item.external_comment_id)
                    await _persist_comment(account["id"], item)
            if not has_more or not cursor:
                break

        if account.get("id"):
            known = await social_comments_repository.list_known_external_ids(account["id"], external_publication_id)
            for missing_id in known - seen_external_ids:
                await social_comments_repository.mark_deleted(account["id"], missing_id)

    if account.get("id"):
        await social_accounts_repository.mark_comments_synced(account["id"])

    return CommentsSyncResponse(comments=all_comments)


async def reply_comment(body: CommentsReplyRequest) -> CommentsReplyResponse:
    """Two independent guards against a double reply, per the Sprint 08 plan:
    this claim (a DB row reserved before Meta is ever called) is the real
    exactly-once guarantee; the Idempotency-Key cache one layer up in
    internal_routes.py only replays the same HTTP response to a legitimate
    Express-side retry — it writes *after* success, so on its own it would
    leave a real double-send window if the process died between Meta
    accepting the reply and the cache being written."""
    comment = await social_comments_repository.get_by_id(body.comment_id)
    if comment is None:
        raise GraphAPIError(status_code=404, detail="Commentaire introuvable.", code="not_found")
    if comment["is_deleted_on_platform"]:
        raise GraphAPIError(
            status_code=409, detail="Ce commentaire a été supprimé sur la plateforme.", code="conflict"
        )

    account = await social_accounts_repository.get_by_id(comment["social_account_id"])
    token = await oauth_tokens_repository.get_decrypted_access_token(account["id"])
    if token is None:
        raise GraphAPIError(
            status_code=409,
            detail="Aucun token actif pour ce compte ; reconnexion requise.",
            code="TOKEN_EXPIRED",
        )

    claimed = await sent_responses_repository.claim(
        comment_id=comment["id"], social_account_id=account["id"], content=body.text, sent_by_user_id=body.user_id
    )
    if claimed is None:
        raise GraphAPIError(
            status_code=409, detail="Une réponse a déjà été envoyée pour ce commentaire.", code="conflict"
        )

    try:
        external_reply_id = await get_provider(account["provider"]).reply_to_comment(
            account=account, token=token, external_comment_id=comment["external_comment_id"], text=body.text
        )
    except GraphAPIError as exc:
        await sent_responses_repository.mark_failed(str(claimed["id"]), exc.code, exc.detail)
        raise

    await sent_responses_repository.mark_succeeded(str(claimed["id"]), external_reply_id)
    await social_comments_repository.set_status(
        comment["id"], "PROCESSED", changed_by_user_id=body.user_id, note=None
    )

    return CommentsReplyResponse(
        status="SUCCESS",
        external_reply_id=external_reply_id,
        sent_at=datetime.now(timezone.utc).isoformat(),
    )


_EMPTY_INSIGHTS = {"reactions": None, "comments": None, "shares": None, "reach": None, "impressions": None}


async def sync_metrics(body: MetricsSyncRequest) -> MetricsSyncResponse:
    """Sprint 12 : complète l'endpoint (jusqu'ici lecture seule) pour qu'il
    persiste ce qu'il relève, comme sync_comments le fait déjà pour les
    commentaires — c'est le sens de « corriger graph-api au lieu de dupliquer
    ses services » : le worker ne fait que choisir les candidats et appeler
    cette route, il n'écrit jamais lui-même dans social_metrics.

    Un post qui échoue (supprimé, permission retirée, erreur transitoire) ne
    doit pas faire échouer les autres posts du même lot : FacebookProvider
    laisse `get_post_analytics` propager une GraphAPIError inattendue
    (post_analytics_service.py, appel non protégé sur le post lui-même,
    distinct de son propre `/insights` déjà dégradé en None), donc c'est ici,
    et seulement ici, qu'on l'attrape."""
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
        try:
            insights = await provider.get_insights(
                account=account, token=token, external_publication_id=external_publication_id
            )
        except GraphAPIError:
            insights = _EMPTY_INSIGHTS

        collected_at = datetime.now(timezone.utc)
        metrics.append(
            MetricItem(
                external_publication_id=external_publication_id,
                collected_at=collected_at.isoformat(),
                reactions=insights["reactions"],
                comments=insights["comments"],
                shares=insights["shares"],
                reach=insights["reach"],
                impressions=insights["impressions"],
            )
        )

        if account.get("id"):
            target_id = await publication_targets_repository.find_id_by_external_publication(
                account["id"], external_publication_id
            )
            # Identifiant Meta inconnu localement (post jamais publié par
            # Hootly, ou target orpheline) : on renvoie quand même le relevé à
            # l'appelant, mais rien à rattacher en base.
            if target_id:
                await social_metrics_repository.insert_snapshot(
                    publication_target_id=target_id, collected_at=collected_at, **insights
                )

    if account.get("id"):
        await social_accounts_repository.mark_metrics_synced(account["id"])

    return MetricsSyncResponse(metrics=metrics)

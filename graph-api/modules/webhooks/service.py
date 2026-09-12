"""Webhook processing orchestration (Sprint 08 Day 2).

Simpler than originally planned: Meta includes the full comment content and
author inline in both the Facebook `feed`/comment payload and the Instagram
`comments` payload (verified live during planning) — there is never a need
to call Meta back for "the rest of" a comment. The whole pipeline (dedup
claim, account resolution, comment upsert) is a handful of fast local
Postgres operations, so it runs synchronously in the request instead of a
FastAPI `BackgroundTask` — avoiding that mechanism's real gotcha (exceptions
raised in a background task bypass every exception handler registered in
main.py, since Starlette runs them after the response is already sent).

The dedup claim (webhook_events) still happens first and is what actually
matters for "a duplicate delivery doesn't create two comments": Meta can and
does redeliver the same event on a slow/non-200 response.
"""
import hashlib
import json
import logging

from db import social_accounts_repository, social_comments_repository, webhook_events_repository
from modules.webhooks.parser import iter_entries, parse_comment_event

logger = logging.getLogger("graph_api.webhooks")


def _hash_change(object_field: str, entry_id: str, change: dict) -> str:
    # Hashed per individual change, not per whole POST: Meta can batch
    # several comments in one delivery, and a whole-payload hash would
    # wrongly conflate distinct events into a single dedup key.
    canonical = json.dumps({"object": object_field, "entry_id": entry_id, "change": change}, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def process_payload(object_field: str, payload: dict) -> dict:
    """Returns a small summary for logging/tests: counts of processed,
    duplicate, unresolved (no connected account), and failed changes. Never
    raises — a single malformed change must not fail the whole delivery,
    since Meta would otherwise retry a batch that partially succeeded."""
    provider = "INSTAGRAM" if object_field == "instagram" else "FACEBOOK"
    summary = {"processed": 0, "duplicate": 0, "unresolved": 0, "skipped": 0, "failed": 0}

    for entry_id, change in iter_entries(payload):
        event = parse_comment_event(object_field, entry_id, change)
        if event is None:
            summary["skipped"] += 1
            continue

        payload_hash = _hash_change(object_field, entry_id, change)
        claimed = None
        try:
            claimed = await webhook_events_repository.claim_event(
                provider=provider, payload_hash=payload_hash, raw_payload=change
            )
            if claimed is None:
                summary["duplicate"] += 1
                continue

            account = await social_accounts_repository.get_by_external_id(provider, event.external_account_id)
            if account is None:
                # A lingering subscription for a disconnected/never-connected
                # account — nothing to attach the comment to.
                summary["unresolved"] += 1
                await webhook_events_repository.mark_processed(str(claimed["id"]))
                continue

            if event.is_removed:
                await social_comments_repository.mark_deleted(str(account["id"]), event.external_comment_id)
            else:
                await social_comments_repository.upsert_comment(
                    social_account_id=str(account["id"]),
                    external_comment_id=event.external_comment_id,
                    external_publication_id=event.external_publication_id,
                    author_external_id=event.author_external_id,
                    author_name=event.author_name,
                    content=event.content,
                    meta_created_at=event.meta_created_at,
                    meta_updated_at=None,
                )
            await webhook_events_repository.mark_processed(str(claimed["id"]))
            summary["processed"] += 1
        except Exception as exc:  # noqa: BLE001 - must never let one bad change fail the batch
            logger.exception("webhook_change_processing_failed", extra={"entry_id": entry_id})
            summary["failed"] += 1
            if claimed is not None:
                await webhook_events_repository.mark_failed(str(claimed["id"]), str(exc))

    return summary

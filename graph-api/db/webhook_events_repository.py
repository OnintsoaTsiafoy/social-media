"""webhook_events (Sprint 08 Day 2) — raw delivery log, written only by
graph-api. Dedup key is `(provider, payload_hash)`, hashed per individual
`change` (not per whole POST — Meta can batch several comments in one
delivery, and hashing the entire payload would wrongly conflate them into one
dedup key). The insert happens synchronously in the webhook request, before
any BackgroundTask — two near-simultaneous redeliveries of the same event
must not both pass a "have I seen this?" check before either records it.
"""
from psycopg.types.json import Jsonb

from db.pool import get_pool


async def claim_event(*, provider: str, payload_hash: str, raw_payload) -> dict | None:
    """Returns the new row if this is the first delivery of this event, or
    None if it's a duplicate (already recorded) — callers must skip
    background processing entirely on None, that's the dedup guarantee."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO webhook_events (provider, payload_hash, raw_payload)
                VALUES (%s, %s, %s)
                ON CONFLICT (provider, payload_hash) DO NOTHING
                RETURNING id
                """,
                (provider, payload_hash, Jsonb(raw_payload)),
            )
            return await cur.fetchone()


async def mark_processed(event_id: str) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE webhook_events SET status = 'PROCESSED', processed_at = now() WHERE id = %s",
                (event_id,),
            )


async def mark_failed(event_id: str, error_message: str) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE webhook_events SET status = 'FAILED', processed_at = now(), error_message = %s WHERE id = %s",
                (error_message, event_id),
            )

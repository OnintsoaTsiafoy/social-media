"""sent_responses (Sprint 08 Day 5) — one row per comment, ever. `claim()`
must be called and must return a row BEFORE calling Meta: this is the real
exactly-once guard (a unique constraint on `comment_id`, reserved ahead of
the provider call), independent of and in addition to the
service_idempotency_keys HTTP-response-replay cache, which only writes
*after* a successful call and would leave a real double-send window on its
own (a crash between Meta accepting the reply and the cache being written).
Same idiom as PublicationDeliveryAttempt / delivery.js's CLAIM_TARGET.
"""
from db.pool import get_pool


async def claim(*, comment_id: str, social_account_id: str, content: str, sent_by_user_id: str) -> dict | None:
    """A plain `ON CONFLICT DO NOTHING` would make a FAILED attempt permanent
    — the unique row would already exist, so no later retry could ever claim
    it again, even though "the reply didn't go through, try again" is exactly
    what FAILED is supposed to allow. The conflict update only actually
    applies (per its WHERE) when the existing row is FAILED — a currently
    in-flight (STARTED) or already-SUCCEEDED row still blocks a second claim,
    which is the real exactly-once guarantee this function exists for."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO sent_responses (comment_id, social_account_id, content, sent_by_user_id)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (comment_id) DO UPDATE SET
                    content = EXCLUDED.content,
                    sent_by_user_id = EXCLUDED.sent_by_user_id,
                    status = 'STARTED',
                    started_at = now(),
                    finished_at = NULL,
                    error_code = NULL,
                    error_message = NULL,
                    external_reply_id = NULL
                WHERE sent_responses.status = 'FAILED'
                RETURNING id
                """,
                (comment_id, social_account_id, content, sent_by_user_id),
            )
            return await cur.fetchone()


async def mark_succeeded(response_id: str, external_reply_id: str | None) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE sent_responses SET status = 'SUCCEEDED', external_reply_id = %s, finished_at = now()
                WHERE id = %s
                """,
                (external_reply_id, response_id),
            )


async def mark_failed(response_id: str, error_code: str, error_message: str) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE sent_responses SET status = 'FAILED', error_code = %s, error_message = %s, finished_at = now()
                WHERE id = %s
                """,
                (error_code, error_message, response_id),
            )


async def get_by_comment_id(comment_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT * FROM sent_responses WHERE comment_id = %s", (comment_id,))
            return await cur.fetchone()

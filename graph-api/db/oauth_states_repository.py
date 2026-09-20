"""oauth_states: one-time-use, short-lived OAuth CSRF state (Sprint 06 Day 1)."""
from datetime import datetime, timedelta, timezone

from db.pool import get_pool

STATE_TTL_SECONDS = 600  # 10 minutes — short-lived per sprint spec


async def create_state(
    *,
    state_hash: str,
    user_id: str,
    brand_id: str,
    provider: str,
    mobile_redirect_uri: str,
    select_pages: bool = False,
    initiated_by_user_id: str | None = None,
) -> dict:
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=STATE_TTL_SECONDS)
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO oauth_states
                    (state_hash, user_id, brand_id, provider, mobile_redirect_uri,
                     select_pages, initiated_by_user_id, expires_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, expires_at
                """,
                (
                    state_hash,
                    user_id,
                    brand_id,
                    provider.upper(),
                    mobile_redirect_uri,
                    select_pages,
                    initiated_by_user_id,
                    expires_at,
                ),
            )
            return await cur.fetchone()


async def consume_state(state_hash: str) -> dict | None:
    """Claims the state via a conditional UPDATE so it can only ever be used
    once, even under a racing double callback — same idiom as the worker's
    CLAIM_TARGET (`UPDATE ... WHERE ... RETURNING`)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE oauth_states
                   SET consumed_at = now()
                 WHERE state_hash = %s AND consumed_at IS NULL AND expires_at > now()
                RETURNING id, user_id, brand_id, provider, mobile_redirect_uri,
                          select_pages, initiated_by_user_id
                """,
                (state_hash,),
            )
            return await cur.fetchone()

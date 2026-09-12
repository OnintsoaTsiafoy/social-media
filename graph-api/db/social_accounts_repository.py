"""social_accounts (Sprint 06 Day 1)."""
from db.pool import get_pool


async def upsert_account(
    *,
    brand_id: str,
    provider: str,
    external_account_id: str,
    name: str,
    username: str | None,
    avatar_url: str | None,
    auth_method: str,
    connected_by_user_id: str,
) -> dict:
    """A given (provider, externalAccountId) belongs to exactly one brand —
    re-connecting the same Page/account re-links it (and re-activates it)
    rather than creating a duplicate row."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO social_accounts
                    (brand_id, provider, external_account_id, name, username, avatar_url,
                     status, auth_method, connected_by_user_id, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, 'CONNECTED', %s, %s, now())
                ON CONFLICT (provider, external_account_id) DO UPDATE SET
                    brand_id = EXCLUDED.brand_id,
                    name = EXCLUDED.name,
                    username = EXCLUDED.username,
                    avatar_url = EXCLUDED.avatar_url,
                    status = 'CONNECTED',
                    auth_method = EXCLUDED.auth_method,
                    connected_by_user_id = EXCLUDED.connected_by_user_id,
                    updated_at = now()
                RETURNING id, brand_id, provider, external_account_id, name, username, status, auth_method
                """,
                (
                    brand_id,
                    provider.upper(),
                    external_account_id,
                    name,
                    username,
                    avatar_url,
                    auth_method,
                    connected_by_user_id,
                ),
            )
            return await cur.fetchone()


async def get_by_id(account_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT * FROM social_accounts WHERE id = %s", (account_id,))
            return await cur.fetchone()


async def get_by_external_id(provider: str, external_account_id: str) -> dict | None:
    """Resolves a Meta-side page/IG user id (as seen in a webhook payload or
    a sync response) to our own social_accounts row — a webhook for an
    account nobody connected (a lingering test subscription, a disconnected
    Page) legitimately resolves to None."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT * FROM social_accounts WHERE provider = %s AND external_account_id = %s",
                (provider.upper(), external_account_id),
            )
            return await cur.fetchone()


async def update_status(account_id: str, status: str) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE social_accounts SET status = %s, updated_at = now() WHERE id = %s",
                (status, account_id),
            )


async def mark_comments_synced(account_id: str) -> None:
    """Sprint 08 Day 3 — the only writer of last_comments_sync_at (a column
    that has existed since Sprint 06 but was never written until now): graph-
    api owns this write in the same call that persists the synced comments,
    so there's no separate round-trip that could skip it if the worker
    crashes in between."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE social_accounts SET last_comments_sync_at = now() WHERE id = %s",
                (account_id,),
            )


async def update_profile(account_id: str, *, name: str, username: str | None, avatar_url: str | None) -> None:
    """Keeps the displayed name/username/avatar current between OAuth
    reconnects — `upsert_account` only refreshes these at initial connect."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE social_accounts SET name = %s, username = %s, avatar_url = %s, updated_at = now() "
                "WHERE id = %s",
                (name, username, avatar_url, account_id),
            )

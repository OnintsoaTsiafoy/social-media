"""graph-api's own Postgres connection (Sprint 06 Day 1).

Raw SQL, no ORM — mirrors services/worker's use of `pg` against the same
Prisma-migrated database. Prisma (services/api/prisma/schema.prisma) stays
the sole owner of the DDL/migrations for the tables this module reads and
writes (social_accounts, oauth_tokens, social_permissions, oauth_states,
service_idempotency_keys).
"""
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from core.config import settings
from core.exceptions import GraphAPIError

_pool: AsyncConnectionPool | None = None


def _require_database_configured() -> None:
    if not settings.database_configured:
        raise GraphAPIError(
            status_code=503,
            detail="Base de données non configurée pour graph-api.",
            code="provider_unavailable",
        )


async def get_pool() -> AsyncConnectionPool:
    global _pool
    _require_database_configured()
    if _pool is None:
        _pool = AsyncConnectionPool(
            conninfo=settings.database_url,
            min_size=1,
            max_size=5,
            open=False,
            kwargs={"row_factory": dict_row, "autocommit": True},
        )
        await _pool.open()
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def ping() -> bool:
    """Used by /ready — a cheap round trip, not a full health check."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT 1")
            await cur.fetchone()
    return True

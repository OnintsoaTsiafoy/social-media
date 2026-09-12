"""service_idempotency_keys (Sprint 06 Day 1) — replaces the in-memory,
process-local stopgap used in Sprint 05 now that graph-api has a database.
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone

from psycopg.types.json import Jsonb

from db.pool import get_pool

_TTL_SECONDS = 24 * 3600


def _hash_request(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def get_cached_response(endpoint: str, key: str, request_payload: dict) -> tuple[dict | None, bool]:
    """Returns (cached_response, conflict). conflict=True means this key was
    already used for a different request body on this endpoint."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT request_hash, response_body FROM service_idempotency_keys "
                "WHERE endpoint = %s AND key = %s AND expires_at > now()",
                (endpoint, key),
            )
            row = await cur.fetchone()
    if row is None:
        return None, False
    if row["request_hash"] != _hash_request(request_payload):
        return None, True
    return row["response_body"], False


async def store_response(endpoint: str, key: str, request_payload: dict, response_body: dict) -> None:
    pool = await get_pool()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_TTL_SECONDS)
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO service_idempotency_keys
                    (endpoint, key, request_hash, response_status, response_body, expires_at)
                VALUES (%s, %s, %s, 200, %s, %s)
                ON CONFLICT (endpoint, key) DO NOTHING
                """,
                (endpoint, key, _hash_request(request_payload), Jsonb(response_body), expires_at),
            )

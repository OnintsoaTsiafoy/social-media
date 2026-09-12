"""oauth_tokens (Sprint 06 Day 1).

Never UPDATE in place: every issuance/refresh inserts a new numbered version
and marks the previous ACTIVE row SUPERSEDED, in one transaction — same
"append-only, versioned" pattern as services/api's BrandAiSetting, minus the
client-supplied expectedVersion half (refreshes here are system-initiated,
not a user submitting a form, so a rare concurrent double-refresh is
resolved by retrying once rather than surfacing a 409 to anyone).
"""
import psycopg
from psycopg.types.json import Jsonb

from core.crypto import decrypt_token, encrypt_token
from db.pool import get_pool

_MAX_RACE_RETRIES = 3


async def store_token(
    *,
    social_account_id: str,
    access_token: str,
    refresh_token: str | None,
    scope: list[str],
    expires_at,
) -> dict:
    encrypted_access, key_version = encrypt_token(access_token)
    encrypted_refresh = encrypt_token(refresh_token)[0] if refresh_token else None

    pool = await get_pool()
    for attempt in range(1, _MAX_RACE_RETRIES + 1):
        try:
            async with pool.connection() as conn:
                async with conn.transaction():
                    async with conn.cursor() as cur:
                        await cur.execute(
                            "UPDATE oauth_tokens SET status = 'SUPERSEDED' "
                            "WHERE social_account_id = %s AND status = 'ACTIVE'",
                            (social_account_id,),
                        )
                        await cur.execute(
                            """
                            INSERT INTO oauth_tokens
                                (social_account_id, version, status, encrypted_access_token,
                                 encrypted_refresh_token, encryption_key_version, scope, expires_at)
                            VALUES (
                                %(social_account_id)s,
                                COALESCE(
                                    (SELECT MAX(version) FROM oauth_tokens WHERE social_account_id = %(social_account_id)s),
                                    0
                                ) + 1,
                                'ACTIVE', %(access)s, %(refresh)s, %(key_version)s, %(scope)s, %(expires_at)s
                            )
                            RETURNING id, version, expires_at
                            """,
                            {
                                "social_account_id": social_account_id,
                                "access": encrypted_access,
                                "refresh": encrypted_refresh,
                                "key_version": key_version,
                                "scope": Jsonb(scope),
                                "expires_at": expires_at,
                            },
                        )
                        return await cur.fetchone()
        except psycopg.errors.UniqueViolation:
            if attempt == _MAX_RACE_RETRIES:
                raise
            continue


async def get_active_token(social_account_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT * FROM oauth_tokens WHERE social_account_id = %s AND status = 'ACTIVE' "
                "ORDER BY version DESC LIMIT 1",
                (social_account_id,),
            )
            return await cur.fetchone()


async def get_decrypted_access_token(social_account_id: str) -> str | None:
    row = await get_active_token(social_account_id)
    if row is None:
        return None
    return decrypt_token(bytes(row["encrypted_access_token"]), row["encryption_key_version"])


async def mark_revoked(social_account_id: str) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE oauth_tokens SET status = 'REVOKED' "
                "WHERE social_account_id = %s AND status = 'ACTIVE'",
                (social_account_id,),
            )

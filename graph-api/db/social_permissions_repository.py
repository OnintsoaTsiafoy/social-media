"""social_permissions (Sprint 06 Day 1)."""
from db.pool import get_pool


async def upsert_permissions(social_account_id: str, permissions: list[dict]) -> None:
    """permissions: [{"permission": str, "status": "GRANTED"|"DECLINED"}, ...]"""
    if not permissions:
        return
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                for item in permissions:
                    await cur.execute(
                        """
                        INSERT INTO social_permissions (social_account_id, permission, status, checked_at)
                        VALUES (%s, %s, %s, now())
                        ON CONFLICT (social_account_id, permission) DO UPDATE SET
                            status = EXCLUDED.status, checked_at = now()
                        """,
                        (social_account_id, item["permission"], item["status"]),
                    )


async def list_permissions(social_account_id: str) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT permission, status FROM social_permissions "
                "WHERE social_account_id = %s ORDER BY permission",
                (social_account_id,),
            )
            return await cur.fetchall()

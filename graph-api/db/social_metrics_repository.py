"""social_metrics (Sprint 12) — historique append-only des relevés Meta.

graph-api est l'unique écrivain (même répartition que social_comments) :
Prisma possède le DDL (services/api/prisma/schema.prisma::SocialMetric),
graph-api possède les écritures issues de Meta. Aucune mise à jour ni
déduplication : une ligne par tentative de synchronisation, y compris quand
toutes les métriques sont `null` (l'échec/l'absence de permission est un fait
distinct de la tentative elle-même).
"""
from db.pool import get_pool


async def insert_snapshot(
    *,
    publication_target_id: str,
    collected_at,
    reactions: int | None,
    comments: int | None,
    shares: int | None,
    reach: int | None,
    impressions: int | None,
) -> dict:
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO social_metrics
                    (publication_target_id, collected_at, reactions, comments, shares, reach, impressions)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (publication_target_id, collected_at, reactions, comments, shares, reach, impressions),
            )
            return await cur.fetchone()

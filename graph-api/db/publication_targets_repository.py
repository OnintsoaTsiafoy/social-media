"""Lecture seule de publication_targets, table possédée par Prisma (Sprint 12).

graph-api n'a jamais eu besoin de cette table avant ce sprint : sync_metrics
reçoit un external_publication_id (identifiant Meta) et doit le résoudre en
publication_target_id pour écrire dans social_metrics, dont c'est la clé
étrangère. Aucune écriture ici — publication_targets reste possédée par
Express/le worker.
"""
from db.pool import get_pool


async def find_id_by_external_publication(social_account_id: str, external_publication_id: str) -> str | None:
    """Plusieurs lignes peuvent en théorie partager le couple (compte,
    identifiant externe) si une publication a été retentée sur un nouveau
    target après échec ; la plus récemment envoyée est la bonne cible pour
    un relevé de métriques."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT id FROM publication_targets
                WHERE social_account_id = %s AND external_publication_id = %s
                ORDER BY sent_at DESC NULLS LAST
                LIMIT 1
                """,
                (social_account_id, external_publication_id),
            )
            row = await cur.fetchone()
            return row["id"] if row else None

"""publications / publication_targets — écritures de l'import des publications d'une Page.

Jusqu'ici graph-api ne LISAIT que publication_targets (publication_targets_repository,
pour résoudre une cible avant d'écrire une métrique). L'import écrit ici : un post
présent sur la Page mais absent de Hootly devient une publication PUBLISHED d'origine
IMPORTED avec sa cible SENT — c'est ce qui lui donne, sans autre code, ses
commentaires, ses métriques et sa place dans les analytics.

Prisma reste seul propriétaire du DDL (schema.prisma) ; graph-api écrit les lignes
issues de Meta, comme pour social_comments et social_metrics.

Une transaction par post : un post qui échoue n'annule pas les précédents, et deux
passes simultanées ne peuvent pas créer deux fois le même post — la clé unique
(social_account_id, external_publication_id) les départage, la perdante annule.
"""
from psycopg.types.json import Jsonb

from db.pool import get_pool


class _LostRace(Exception):
    """Une passe concurrente a créé la cible entre notre lecture et notre insertion."""


async def upsert_post(
    *,
    social_account_id: str,
    brand_id: str,
    provider: str,
    created_by_user_id: str,
    external_publication_id: str,
    content: str,
    hashtags: list[str],
    permalink_url: str | None,
    published_at,
) -> dict:
    """Crée ou met à jour le post et renvoie
    ``{"target_id", "outcome": "created" | "updated" | "unchanged"}``.

    Ce qu'une relecture peut modifier, et rien d'autre :
    - le lien (``external_url``) de toute cible — c'est ainsi qu'un post publié par
      Hootly obtient son adresse Facebook, que l'envoi ne renvoie pas ;
    - le texte et les hashtags d'une publication IMPORTED. Jamais ceux d'une
      publication composée dans Hootly : sa version validée (approbation) fait
      foi, une édition faite sur Facebook ne la réécrit pas.

    ``status`` n'est jamais touché : une publication supprimée dans Hootly
    (deleted_at) ne « ressuscite » pas à la relecture suivante.
    """
    pool = await get_pool()
    try:
        async with pool.connection() as conn:
            async with conn.transaction():
                async with conn.cursor() as cur:
                    await cur.execute(
                        """
                        SELECT pt.id AS target_id, pt.external_url, p.id AS publication_id,
                               p.origin, p.content
                          FROM publication_targets pt
                          JOIN publications p ON p.id = pt.publication_id
                         WHERE pt.social_account_id = %s AND pt.external_publication_id = %s
                           FOR UPDATE OF pt, p
                        """,
                        (social_account_id, external_publication_id),
                    )
                    existing = await cur.fetchone()

                    if existing is not None:
                        changed = False
                        if permalink_url and existing["external_url"] != permalink_url:
                            await cur.execute(
                                "UPDATE publication_targets SET external_url = %s, updated_at = now() WHERE id = %s",
                                (permalink_url, existing["target_id"]),
                            )
                            changed = True
                        if existing["origin"] == "IMPORTED" and existing["content"] != content:
                            await cur.execute(
                                "UPDATE publications SET content = %s, hashtags = %s, updated_at = now() WHERE id = %s",
                                (content, Jsonb(hashtags), existing["publication_id"]),
                            )
                            changed = True
                        return {
                            "target_id": existing["target_id"],
                            "outcome": "updated" if changed else "unchanged",
                        }

                    # created_at = date du post sur Facebook : la liste des
                    # publications est triée par created_at, un import tout juste
                    # fait ne doit pas passer devant ce qui a été publié hier.
                    await cur.execute(
                        """
                        INSERT INTO publications
                            (brand_id, created_by_user_id, content, hashtags, status, origin,
                             published_at, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, 'PUBLISHED', 'IMPORTED', %s, %s, now())
                        RETURNING id
                        """,
                        (brand_id, created_by_user_id, content, Jsonb(hashtags), published_at, published_at),
                    )
                    publication = await cur.fetchone()

                    await cur.execute(
                        """
                        INSERT INTO publication_targets
                            (publication_id, social_account_id, provider, status, external_publication_id,
                             external_url, attempt_count, sent_at, created_at, updated_at)
                        VALUES (%s, %s, %s, 'SENT', %s, %s, 0, %s, %s, now())
                        ON CONFLICT (social_account_id, external_publication_id) DO NOTHING
                        RETURNING id
                        """,
                        (
                            publication["id"],
                            social_account_id,
                            provider.upper(),
                            external_publication_id,
                            permalink_url,
                            published_at,
                            published_at,
                        ),
                    )
                    target = await cur.fetchone()
                    if target is None:
                        raise _LostRace
                    return {"target_id": target["id"], "outcome": "created"}
    except _LostRace:
        # La transaction a été annulée (la publication orpheline aussi) : la passe
        # concurrente a déjà écrit ce post.
        return {"target_id": None, "outcome": "unchanged"}

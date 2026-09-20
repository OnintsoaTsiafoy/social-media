"""oauth_page_selections : pages Facebook proposées à l'administrateur après le
retour de Meta, le temps qu'il choisisse lesquelles lier.

La liste contient les JETONS de page : elle est donc chiffrée en bloc avec la
clé AES-GCM des jetons (`core.crypto`), ne quitte jamais graph-api en clair, et
n'est lisible qu'une fois déchiffrée en mémoire. Durée de vie courte, usage
unique (même idiome que `oauth_states` : un UPDATE conditionnel réclame la ligne).
"""
import json
from datetime import datetime, timedelta, timezone

from core.crypto import decrypt_token, encrypt_token
from db.pool import get_pool

SELECTION_TTL_SECONDS = 900  # 15 minutes : le temps de choisir, pas plus


async def create_selection(
    *,
    user_id: str,
    brand_id: str,
    initiated_by_user_id: str | None,
    provider: str,
    payload: dict,
) -> dict:
    encrypted, key_version = encrypt_token(json.dumps(payload))
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=SELECTION_TTL_SECONDS)
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            # Une sélection périmée n'a plus aucune utilité et porte des jetons :
            # on la supprime au passage plutôt que d'attendre un nettoyage séparé.
            await cur.execute(
                "DELETE FROM oauth_page_selections WHERE expires_at < now() - interval '1 hour'"
            )
            await cur.execute(
                """
                INSERT INTO oauth_page_selections
                    (user_id, brand_id, initiated_by_user_id, provider,
                     encrypted_payload, encryption_key_version, expires_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, expires_at
                """,
                (user_id, brand_id, initiated_by_user_id, provider.upper(), encrypted, key_version, expires_at),
            )
            return await cur.fetchone()


async def get_selection(selection_id: str) -> dict | None:
    """La sélection encore valable (ni consommée ni expirée), charge utile déchiffrée."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT id, user_id, brand_id, initiated_by_user_id, provider, expires_at,
                       encrypted_payload, encryption_key_version
                  FROM oauth_page_selections
                 WHERE id = %s AND consumed_at IS NULL AND expires_at > now()
                """,
                (selection_id,),
            )
            row = await cur.fetchone()
    if row is None:
        return None

    payload = json.loads(decrypt_token(bytes(row["encrypted_payload"]), row["encryption_key_version"]))
    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "brand_id": str(row["brand_id"]),
        "initiated_by_user_id": str(row["initiated_by_user_id"]) if row["initiated_by_user_id"] else None,
        "provider": row["provider"],
        "expires_at": row["expires_at"],
        "payload": payload,
    }


async def claim_selection(selection_id: str) -> bool:
    """Réclame la sélection par un UPDATE conditionnel : deux envois simultanés
    ne peuvent pas lier deux fois — un seul obtient `True`."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE oauth_page_selections
                   SET consumed_at = now()
                 WHERE id = %s AND consumed_at IS NULL AND expires_at > now()
                RETURNING id
                """,
                (selection_id,),
            )
            return await cur.fetchone() is not None

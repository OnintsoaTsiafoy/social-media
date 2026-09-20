"""Liaison d'une page Facebook (et de son compte Instagram professionnel) à une
marque. Une seule implémentation, partagée par les deux chemins :

- le retour OAuth du mobile, qui lie toutes les pages du compte autorisé ;
- le choix d'un administrateur sur la console web, qui n'en lie que certaines.

Les jetons de page sont chiffrés par `oauth_tokens_repository` ; rien de ce module
ne les renvoie ni ne les journalise.
"""
from db import (
    oauth_tokens_repository,
    social_accounts_repository,
    social_permissions_repository,
)


def normalize_page(page: dict, instagram: dict | None) -> dict:
    """Forme interne d'une page : celle de `me/accounts` aplatie, avec son
    compte Instagram lié. C'est aussi ce qui est chiffré dans une sélection."""
    return {
        "id": page["id"],
        "name": page.get("name", ""),
        "pictureUrl": (page.get("picture") or {}).get("data", {}).get("url"),
        "accessToken": page.get("access_token"),
        "tasks": page.get("tasks", []),
        "instagram": (
            {
                "id": instagram["id"],
                "username": instagram.get("username"),
                "name": instagram.get("name") or instagram.get("username") or "",
                "pictureUrl": instagram.get("profile_picture_url"),
            }
            if instagram
            else None
        ),
    }


async def link_page(
    *,
    page: dict,
    brand_id: str,
    user_id: str,
    permissions: list[dict],
) -> list[dict]:
    """Lie la page (forme `normalize_page`) et son Instagram lié à `brand_id`,
    au nom de `user_id`. Renvoie les comptes créés ou reliés, la page d'abord."""
    page_token = page.get("accessToken")
    if not page_token:
        return []

    linked: list[dict] = []
    account = await social_accounts_repository.upsert_account(
        brand_id=brand_id,
        provider="FACEBOOK",
        external_account_id=page["id"],
        name=page.get("name", ""),
        username=None,
        avatar_url=page.get("pictureUrl"),
        auth_method="FACEBOOK_PAGE",
        connected_by_user_id=user_id,
    )
    await oauth_tokens_repository.store_token(
        social_account_id=account["id"],
        access_token=page_token,
        refresh_token=None,
        scope=page.get("tasks", []),
        expires_at=None,
    )
    await social_permissions_repository.upsert_permissions(account["id"], permissions)
    linked.append(account)

    instagram = page.get("instagram")
    if instagram:
        ig_account = await social_accounts_repository.upsert_account(
            brand_id=brand_id,
            provider="INSTAGRAM",
            external_account_id=instagram["id"],
            name=instagram.get("name") or instagram.get("username") or "",
            username=instagram.get("username"),
            avatar_url=instagram.get("pictureUrl"),
            auth_method="FACEBOOK_PAGE",
            connected_by_user_id=user_id,
        )
        # Meta n'émet pas de jeton propre à Instagram sur ce chemin (Facebook
        # Login for Business) : le jeton de la page sert aux deux comptes.
        await oauth_tokens_repository.store_token(
            social_account_id=ig_account["id"],
            access_token=page_token,
            refresh_token=None,
            scope=page.get("tasks", []),
            expires_at=None,
        )
        await social_permissions_repository.upsert_permissions(ig_account["id"], permissions)
        linked.append(ig_account)

    return linked

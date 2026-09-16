"""Lecture publique d'un compte Instagram professionnel concurrent.

Un seul accès officiel existe : « Business Discovery ». La requête part
toujours du compte Instagram de la marque et nomme le concurrent dans le champ
demandé :

    GET /{ig-user-id}?fields=business_discovery.username(<concurrent>){...}

Trois conséquences, toutes visibles côté produit :
  - la marque doit avoir un compte Instagram professionnel connecté, sinon
    aucun concurrent Instagram n'est analysable ;
  - le concurrent doit lui-même être un compte professionnel ; un compte
    personnel remonte une erreur Meta traduite en UNAVAILABLE ;
  - aucun identifiant n'est nécessaire côté appelant : le nom d'utilisateur
    est la clé, et c'est Meta qui rend l'identifiant. C'est la « résolution du
    compte » de la section 2 du TODO.
"""
import logging

from modules.competitors.capabilities import (
    INSTAGRAM_POST_FIELDS,
    INSTAGRAM_PROFILE_FIELDS,
    INSTAGRAM_SELF_AUDIENCE_FIELDS,
    UNSUPPORTED_BY_PLATFORM,
)
from modules.competitors.schemas import CompetitorPostItem
from modules.instagram import client as instagram_client

logger = logging.getLogger("graph_api.competitors.instagram")

PLATFORM = "INSTAGRAM"


def _auth_method(account: dict) -> str:
    return account.get("auth_method") or "FACEBOOK_PAGE"


def _discovery_node(payload: dict) -> dict | None:
    node = payload.get("business_discovery")
    return node if isinstance(node, dict) else None


async def fetch_profile(*, account: dict, token: str, handle: str) -> dict:
    fields = f"business_discovery.username({handle}){{{INSTAGRAM_PROFILE_FIELDS}}}"
    payload = await instagram_client.get(
        _auth_method(account), account.get("external_account_id"), token, {"fields": fields}
    )
    node = _discovery_node(payload)
    if node is None:
        # Meta répond 200 sans `business_discovery` quand le compte visé n'est
        # pas exploitable autrement qu'en erreur : traité comme illisible, pas
        # comme un profil vide.
        return {
            "externalId": None,
            "unavailable": True,
            "unavailableFields": [],
        }

    username = node.get("username") or handle
    unavailable = [
        name
        for name, source in {
            "name": "name",
            "avatarUrl": "profile_picture_url",
            "followersCount": "followers_count",
            "postsCount": "media_count",
        }.items()
        if node.get(source) is None
    ]
    unavailable.extend(UNSUPPORTED_BY_PLATFORM["INSTAGRAM"].keys())

    return {
        "externalId": node.get("id"),
        "username": username,
        # Le nom affiché est facultatif sur Instagram ; à défaut on garde le
        # nom d'utilisateur plutôt que d'afficher une ligne vide.
        "name": node.get("name") or username,
        "profileUrl": f"https://www.instagram.com/{username}/",
        "avatarUrl": node.get("profile_picture_url"),
        "accountType": "Compte professionnel",
        "followersCount": node.get("followers_count"),
        "postsCount": node.get("media_count"),
        "unavailableFields": sorted(set(unavailable)),
    }


async def fetch_posts(
    *, account: dict, token: str, handle: str, limit: int, cursor: str | None
) -> tuple[list[CompetitorPostItem], str | None, bool, list[str]]:
    # La pagination d'un edge imbriqué se déclare dans l'expression de champ
    # elle-même (`media.after(...)`), pas en paramètre de requête : c'est la
    # seule forme acceptée par Business Discovery.
    media_edge = f"media.limit({limit})"
    if cursor:
        media_edge += f".after({cursor})"
    fields = f"business_discovery.username({handle}){{{media_edge}{{{INSTAGRAM_POST_FIELDS}}}}}"

    payload = await instagram_client.get(
        _auth_method(account), account.get("external_account_id"), token, {"fields": fields}
    )
    node = _discovery_node(payload)
    if node is None:
        return [], None, False, []

    media = node.get("media") if isinstance(node.get("media"), dict) else {}
    data = media.get("data") or []

    posts = [
        CompetitorPostItem(
            externalPostId=item.get("id"),
            message=item.get("caption"),
            mediaType=item.get("media_type"),
            permalink=item.get("permalink"),
            publishedAt=item.get("timestamp"),
            # `like_count` disparaît quand le concurrent masque ses mentions
            # J'aime : None, jamais 0.
            reactionsCount=item.get("like_count") if isinstance(item.get("like_count"), int) else None,
            commentsCount=item.get("comments_count") if isinstance(item.get("comments_count"), int) else None,
            sharesCount=None,
        )
        for item in data
    ]

    paging = media.get("paging") if isinstance(media.get("paging"), dict) else {}
    cursors = paging.get("cursors") if isinstance(paging.get("cursors"), dict) else {}
    next_cursor = cursors.get("after")
    has_more = bool(paging.get("next")) and bool(next_cursor)

    return posts, next_cursor, has_more, sorted(UNSUPPORTED_BY_PLATFORM["INSTAGRAM"].keys())


async def fetch_self_audience(*, account: dict, token: str) -> dict:
    """Compte Instagram de la marque : lecture directe, pas de Business
    Discovery — c'est un compte que l'application administre."""
    payload = await instagram_client.get(
        _auth_method(account),
        account.get("external_account_id"),
        token,
        {"fields": INSTAGRAM_SELF_AUDIENCE_FIELDS},
    )
    return {
        "followersCount": payload.get("followers_count") if isinstance(payload.get("followers_count"), int) else None,
        "postsCount": payload.get("media_count") if isinstance(payload.get("media_count"), int) else None,
    }


__all__ = ["PLATFORM", "fetch_profile", "fetch_posts", "fetch_self_audience"]

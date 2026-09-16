"""Lecture publique d'une Page Facebook concurrente.

Passe par `FacebookClient`, jamais par httpx directement (règle CLAUDE.md pour
ce service). La Page visée n'est pas celle du token : `page_id` reste celle de
la marque — il ne sert qu'à satisfaire le contrôle de configuration du client
— et l'identifiant du concurrent voyage dans le chemin de la requête.

Accès nécessaire : la feature « Page Public Content Access ». Sans elle, Meta
refuse ces mêmes appels avec un code de permission, que
`capabilities.classify_meta_failure` traduit en PERMISSION_REQUIRED (section 12
du TODO : c'est l'App Review qui débloque, pas le code).
"""
import logging

from modules.competitors.capabilities import (
    FACEBOOK_POST_FIELDS,
    FACEBOOK_PROFILE_FIELDS,
    FACEBOOK_SELF_AUDIENCE_FIELDS,
)
from modules.competitors.schemas import CompetitorPostItem

logger = logging.getLogger("graph_api.competitors.facebook")

PLATFORM = "FACEBOOK"


def _client(account: dict, token: str):
    from modules.facebook.clients.facebook_client import FacebookClient

    return FacebookClient(page_id=account.get("external_account_id"), access_token=token)


def _summary_total(payload: dict, key: str) -> int | None:
    """`reactions`/`comments` demandés en `.summary(total_count)` : le total est
    le seul chiffre lu. Absent = None, jamais 0 — une Page dont Meta masque le
    compteur n'a pas « zéro réaction »."""
    node = payload.get(key)
    if not isinstance(node, dict):
        return None
    summary = node.get("summary")
    if not isinstance(summary, dict):
        return None
    total = summary.get("total_count")
    return total if isinstance(total, int) else None


def _shares_count(payload: dict) -> int | None:
    # `shares` est absent du post tant qu'il n'a jamais été partagé : c'est le
    # seul cas de ce fichier où l'absence vaut réellement 0 et non « inconnu »,
    # mais Meta ne permet pas de distinguer ce cas d'un champ refusé — donc
    # None, conformément à la règle « jamais de 0 fabriqué ».
    shares = payload.get("shares")
    if not isinstance(shares, dict):
        return None
    count = shares.get("count")
    return count if isinstance(count, int) else None


def _media_type(payload: dict) -> str | None:
    attachments = payload.get("attachments")
    if not isinstance(attachments, dict):
        return None
    data = attachments.get("data")
    if not isinstance(data, list) or not data:
        return None
    media_type = data[0].get("media_type")
    return media_type if isinstance(media_type, str) else None


def _missing_fields(payload: dict, expected: dict[str, str]) -> list[str]:
    return [name for name, source in expected.items() if payload.get(source) is None]


async def fetch_profile(*, account: dict, token: str, handle: str) -> dict:
    """Informations publiques d'une Page concurrente.

    `handle` accepte aussi bien l'identifiant numérique que le nom de vanité :
    Graph API résout les deux sur le même chemin, ce qui fait de cet appel la
    « résolution d'identifiant » demandée par la section 2 du TODO.
    """
    payload = await _client(account, token).get(handle, {"fields": FACEBOOK_PROFILE_FIELDS})

    picture = payload.get("picture")
    avatar_url = None
    if isinstance(picture, dict) and isinstance(picture.get("data"), dict):
        avatar_url = picture["data"].get("url")

    # `followers_count` et `fan_count` ne sont pas la même chose (abonnés vs
    # mentions J'aime) et Meta n'expose pas toujours les deux. On privilégie
    # les abonnés, plus proche de l'audience réelle, avec les J'aime en repli.
    followers = payload.get("followers_count")
    if not isinstance(followers, int):
        followers = payload.get("fan_count")
    if not isinstance(followers, int):
        followers = None

    unavailable = _missing_fields(payload, {"name": "name", "username": "username", "profileUrl": "link"})
    if followers is None:
        unavailable.append("followersCount")
    if avatar_url is None:
        unavailable.append("avatarUrl")
    # Le nombre total de publications d'une Page n'est pas un champ Graph API :
    # il ne s'obtiendrait qu'en paginant tout le fil, ce qui n'est ni borné ni
    # honnête à afficher comme un total.
    unavailable.append("postsCount")

    return {
        "externalId": payload.get("id"),
        "username": payload.get("username"),
        "name": payload.get("name"),
        "profileUrl": payload.get("link"),
        "avatarUrl": avatar_url,
        "accountType": "Page Facebook",
        "followersCount": followers,
        "postsCount": None,
        "unavailableFields": sorted(set(unavailable)),
    }


async def fetch_posts(
    *, account: dict, token: str, handle: str, limit: int, cursor: str | None
) -> tuple[list[CompetitorPostItem], str | None, bool, list[str]]:
    params = {"fields": FACEBOOK_POST_FIELDS, "limit": limit}
    if cursor:
        params["after"] = cursor

    payload = await _client(account, token).get(f"{handle}/posts", params)
    data = payload.get("data") or []

    posts: list[CompetitorPostItem] = []
    for item in data:
        posts.append(
            CompetitorPostItem(
                externalPostId=item.get("id"),
                message=item.get("message"),
                mediaType=_media_type(item),
                permalink=item.get("permalink_url"),
                publishedAt=item.get("created_time"),
                reactionsCount=_summary_total(item, "reactions"),
                commentsCount=_summary_total(item, "comments"),
                sharesCount=_shares_count(item),
            )
        )

    paging = payload.get("paging") if isinstance(payload.get("paging"), dict) else {}
    cursors = paging.get("cursors") if isinstance(paging.get("cursors"), dict) else {}
    next_cursor = cursors.get("after")
    has_more = bool(paging.get("next")) and bool(next_cursor)

    return posts, next_cursor, has_more, []


async def fetch_self_audience(*, account: dict, token: str) -> dict:
    """Audience de la Page de la marque — pas de PPCA ici, c'est une Page
    administrée par l'application."""
    page_id = account.get("external_account_id")
    payload = await _client(account, token).get(page_id, {"fields": FACEBOOK_SELF_AUDIENCE_FIELDS})
    followers = payload.get("followers_count")
    if not isinstance(followers, int):
        followers = payload.get("fan_count")
    return {
        "followersCount": followers if isinstance(followers, int) else None,
        # Même remarque que dans fetch_profile : Graph API n'expose pas de
        # total de publications pour une Page.
        "postsCount": None,
    }


__all__ = ["PLATFORM", "fetch_profile", "fetch_posts", "fetch_self_audience"]

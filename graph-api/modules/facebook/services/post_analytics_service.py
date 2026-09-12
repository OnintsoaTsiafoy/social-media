from datetime import datetime

from core.exceptions import GraphAPIError
from modules.facebook.clients.facebook_client import FacebookClient, facebook_client
from modules.facebook.schemas.post_analytics import MediaItem, PostAnalyticsResponse


async def get_post_analytics(
    post_id: str, client: FacebookClient = facebook_client
) -> PostAnalyticsResponse:
    """Récupère une vue analytique complète d'une publication Facebook.

    ``client`` defaults to the legacy global singleton (/facebook/*); Sprint 07
    passes a per-account client (real token) from /internal/v1 instead.
    """

    # --- 1. Données du post (date, réactions, commentaires, partages, médias) ---
    post_fields = (
        "message,"
        "created_time,"
        "reactions.summary(true),"
        "comments.summary(true),"
        "shares,"
        "attachments{media_type,media,url,subattachments{media_type,media,url}}"
    )
    post_data = await client.get(post_id, params={"fields": post_fields})

    # --- 2. Insights du post (impressions, reach, clics) ---
    # Les métriques disponibles varient selon la version de l'API et les permissions.
    # Une erreur Meta explicite (permission, rate limit, config, réseau — tout ce
    # que le client traduit en GraphAPIError) rend les métriques indisponibles
    # (None), distinct d'un zéro réellement retourné par Meta (Sprint 05 Day 4).
    # Une exception inattendue, elle, n'est pas masquée et continue de se propager.
    insights_data: dict = {}
    insights_available = True
    try:
        insights_data = await client.get(
            f"{post_id}/insights",
            params={
                "metric": "post_impressions_unique,post_impressions,post_clicks_unique,post_clicks",
                "period": "lifetime",
            },
        )
    except GraphAPIError:
        insights_available = False

    # --- Parsing de la date et heure ---
    # Meta omits created_time for some post types/permission scopes: treat a
    # missing value as "indisponible" (null) instead of crashing (Sprint 05 Day 2).
    created_time = post_data.get("created_time") or ""
    if created_time:
        dt = datetime.fromisoformat(created_time.replace("Z", "+00:00"))
        date_str: str | None = dt.strftime("%Y-%m-%d")
        time_str: str | None = dt.strftime("%H:%M:%S")
    else:
        date_str = None
        time_str = None

    # --- Texte de la publication ---
    message = post_data.get("message")

    # --- Réactions ---
    reactions_total = post_data.get("reactions", {}).get("summary", {}).get("total_count", 0)

    # --- Commentaires ---
    comments_count = post_data.get("comments", {}).get("summary", {}).get("total_count", 0)

    # --- Partages ---
    shares_count = post_data.get("shares", {}).get("count", 0)

    # --- Insights (impressions, reach & clics) ---
    # None = indisponible (l'appel Meta a échoué) ; 0 = Meta a réellement
    # répondu zéro pour cette métrique.
    impressions: int | None = None
    reach: int | None = None
    clicks: int | None = None
    if insights_available:
        impressions = reach = clicks = 0
        for metric in insights_data.get("data", []):
            name = metric.get("name")
            values = metric.get("values", [{}])
            value = values[0].get("value", 0) if values else 0
            if name == "post_impressions":
                impressions = value
            elif name == "post_impressions_unique":
                reach = value
            elif name in ("post_clicks", "post_clicks_unique"):
                clicks = value

    # --- Médias (images / vidéos) ---
    media: list[MediaItem] = []
    attachments = post_data.get("attachments", {}).get("data", [])
    for attachment in attachments:
        media_type_raw = attachment.get("media_type", "")
        media_info = attachment.get("media", {})

        if media_type_raw in ("photo", "video"):
            media_url = media_info.get("image", {}).get("src", "") or attachment.get("url", "")
            media.append(MediaItem(type=media_type_raw, url=media_url))

        # Gestion des sous-attachements (albums, posts multi-médias)
        sub_attachments = attachment.get("subattachments", {}).get("data", [])
        for sub in sub_attachments:
            sub_type = sub.get("media_type", "")
            sub_media = sub.get("media", {})
            if sub_type in ("photo", "video"):
                sub_url = sub_media.get("image", {}).get("src", "") or sub.get("url", "")
                media.append(MediaItem(type=sub_type, url=sub_url))

    return PostAnalyticsResponse(
        post_id=post_id,
        message=message,
        date=date_str,
        time=time_str,
        reactions_total=reactions_total,
        comments=comments_count,
        shares=shares_count,
        impressions=impressions,
        reach=reach,
        clicks=clicks,
        media=media,
    )

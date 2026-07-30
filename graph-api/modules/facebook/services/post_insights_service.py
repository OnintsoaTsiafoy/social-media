import asyncio

from core.exceptions import GraphAPIError
from modules.facebook.schemas.post_insights import PostInsightsResponse
from modules.facebook.services.post_analytics_service import get_post_analytics
from modules.facebook.services.posts_service import get_post_stats


async def get_post_insights(post_id: str) -> PostInsightsResponse:
    """Agrege les statistiques et analytiques d'une publication Facebook."""

    try:
        stats, analytics = await asyncio.gather(
            get_post_stats(post_id),
            get_post_analytics(post_id),
        )
    except GraphAPIError:
        # Propage les erreurs Facebook avec leur status/detail HTTP.
        raise

    return PostInsightsResponse(
        post_id=post_id,
        stats=stats,
        analytics=analytics,
    )

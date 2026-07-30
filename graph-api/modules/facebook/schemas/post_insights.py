from pydantic import BaseModel

from modules.facebook.schemas.post_analytics import PostAnalyticsResponse
from modules.facebook.schemas.posts import PostStatsResponse


class PostInsightsResponse(BaseModel):
    post_id: str
    stats: PostStatsResponse
    analytics: PostAnalyticsResponse

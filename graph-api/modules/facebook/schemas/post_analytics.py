from pydantic import BaseModel


class MediaItem(BaseModel):
    type: str
    url: str


class PostAnalyticsResponse(BaseModel):
    post_id: str
    message: str | None = None
    date: str
    time: str
    reactions_total: int = 0
    comments: int = 0
    shares: int = 0
    impressions: int = 0
    reach: int = 0
    clicks: int = 0
    media: list[MediaItem] = []

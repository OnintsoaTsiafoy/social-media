from pydantic import BaseModel


class MediaItem(BaseModel):
    type: str
    url: str


class PostAnalyticsResponse(BaseModel):
    post_id: str
    message: str | None = None
    date: str | None = None
    time: str | None = None
    reactions_total: int = 0
    comments: int = 0
    shares: int = 0
    impressions: int | None = None
    reach: int | None = None
    clicks: int | None = None
    media: list[MediaItem] = []

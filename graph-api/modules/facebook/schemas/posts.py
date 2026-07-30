from pydantic import BaseModel, Field


class PostAuthor(BaseModel):
    id: str
    name: str | None = None


class ReactionsDetail(BaseModel):
    like: int = 0
    love: int = 0
    wow: int = 0
    haha: int = 0
    sad: int = 0
    angry: int = 0
    total: int = 0


class PostResponse(BaseModel):
    id: str
    message: str | None = None
    created_time: str | None = None
    permalink_url: str | None = None
    full_picture: str | None = None
    from_field: PostAuthor | None = Field(None, alias="from")
    reactions: ReactionsDetail | None = None
    comments_count: int = 0
    shares_count: int = 0

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class PostCreateResponse(BaseModel):
    id: str


class PostUpdate(BaseModel):
    message: str


class ScheduledPostResponse(BaseModel):
    id: str
    message: str | None = None
    created_time: str | None = None
    scheduled_publish_time: int | None = None
    permalink_url: str | None = None
    is_published: bool | None = None


class ScheduledPostCreate(BaseModel):
    message: str
    scheduled_publish_time: str
    timezone_offset_minutes: int | None = None


class ScheduledPostUpdate(BaseModel):
    message: str | None = None
    scheduled_publish_time: str | None = None
    timezone_offset_minutes: int | None = None


# --- Statistiques d'une publication ---


class PostStatsResponse(BaseModel):
    post_id: str
    reactions: ReactionsDetail
    comments: int = 0
    shares: int = 0


class CommunityManagerStat(BaseModel):
    author_id: str
    author_name: str | None = None
    posts_count: int = 0
    reactions_total: int = 0
    comments_total: int = 0
    first_post_time: str | None = None
    last_post_time: str | None = None


class CommunityManagersStatsResponse(BaseModel):
    since: str | None = None
    until: str | None = None
    total_posts: int = 0
    total_reactions: int = 0
    total_comments: int = 0
    items: list[CommunityManagerStat] = Field(default_factory=list)

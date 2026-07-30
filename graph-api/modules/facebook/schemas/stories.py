from pydantic import BaseModel


class StoryCreateResponse(BaseModel):
    id: str | None = None
    success: bool | None = None


class StoryResponse(BaseModel):
    id: str
    created_time: str | None = None
    permalink_url: str | None = None
    status: str | None = None

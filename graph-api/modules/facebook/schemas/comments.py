from __future__ import annotations

from pydantic import BaseModel, Field


class ProfilePictureData(BaseModel):
    url: str | None = None


class ProfilePicture(BaseModel):
    data: ProfilePictureData | None = None


class CommentAuthor(BaseModel):
    id: str
    name: str | None = None
    picture: ProfilePicture | None = None


class GraphSummary(BaseModel):
    total_count: int = 0


class GraphReactions(BaseModel):
    summary: GraphSummary | None = None


class CommentChildren(BaseModel):
    data: list[CommentResponse] = Field(default_factory=list)


class CommentResponse(BaseModel):
    id: str
    message: str | None = None
    from_field: CommentAuthor | None = Field(None, alias="from")
    created_time: str | None = None
    like_count: int | None = None
    comment_count: int | None = None
    reactions: GraphReactions | None = None
    comments: CommentChildren | None = None

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class ReplyResponse(BaseModel):
    id: str
    message: str | None = None
    from_field: CommentAuthor | None = Field(None, alias="from")
    created_time: str | None = None

    model_config = {"populate_by_name": True, "validate_by_alias": True}


class ReplyCreate(BaseModel):
    message: str


class ReplyCreateResponse(BaseModel):
    id: str

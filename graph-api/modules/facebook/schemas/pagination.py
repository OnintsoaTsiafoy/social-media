from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PageCursors(BaseModel):
    before: str | None = None
    after: str | None = None


class Paging(BaseModel):
    cursors: PageCursors | None = None
    has_next_page: bool = False
    has_previous_page: bool = False


class PaginationParams(BaseModel):
    """Query parameters accepted by every paginated list endpoint."""

    limit: int = Field(default=25, ge=1, le=100)
    after: str | None = None
    before: str | None = None


class PaginatedList(BaseModel, Generic[T]):
    data: list[T]
    paging: Paging

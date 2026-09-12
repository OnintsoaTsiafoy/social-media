"""Provider abstraction for /internal/v1 (Sprint 07).

Assuming Facebook and Instagram have the same capabilities is exactly the
risk sprint_listing/SPRINT_07 calls out — this Protocol is intentionally
narrow (only what /internal/v1's 4 routes actually need), and each provider
raises its own stable errors rather than pretending to support something
Meta doesn't offer for that network (e.g. carousels, video-by-URL).
"""
from typing import Protocol

from core.exceptions import GraphAPIError
from modules.facebook.schemas.internal import CommentSyncItem


class SocialProvider(Protocol):
    name: str

    async def publish(self, *, account: dict, token: str, content: str, media_urls: list[str]) -> str:
        """Returns the externalPublicationId."""
        ...

    async def get_comments(
        self, *, account: dict, token: str, external_publication_id: str, limit: int, cursor: str | None
    ) -> tuple[list[CommentSyncItem], str | None, bool]:
        """Returns (comments, next_cursor, has_more). No `since`/watermark
        parameter: checked directly against Meta's current reference docs for
        both edges during planning (not assumed) — neither Facebook's nor
        Instagram's comments edge supports filtering by timestamp at all
        ("Comments cannot be filtered by timestamp" is Meta's own wording for
        Instagram), and Facebook's documented default order is chronological
        (oldest first), which would make a "stop once we see an old one"
        optimization backwards even if one edge did support a cursor hint.
        The backfill sync (Day 3) instead does a full, capped re-walk of each
        known post's comment pages every run and relies on `social_comments`'
        own upsert-by-key to make re-seeing an unchanged comment a cheap
        no-op — simpler and correct, not an approximation of something the
        Graph API doesn't actually offer."""
        ...

    async def reply_to_comment(
        self, *, account: dict, token: str, external_comment_id: str, text: str
    ) -> str:
        """Returns the externalReplyId."""
        ...

    async def get_insights(self, *, account: dict, token: str, external_publication_id: str) -> dict:
        """Returns {reactions, comments, shares, reach, impressions}, None per
        key when Meta doesn't provide it — never a false 0."""
        ...


def get_provider(provider_name: str) -> SocialProvider:
    # Local imports: avoids a hard import-time dependency between the two
    # provider modules and this registry.
    from modules.facebook.provider import FacebookProvider
    from modules.instagram.provider import InstagramProvider

    normalized = provider_name.upper()
    if normalized == "FACEBOOK":
        return FacebookProvider()
    if normalized == "INSTAGRAM":
        return InstagramProvider()
    raise GraphAPIError(
        status_code=422, detail=f"Provider '{provider_name}' non supporté.", code="unprocessable"
    )

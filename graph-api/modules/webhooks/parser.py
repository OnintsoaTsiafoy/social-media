"""Normalizes Meta's two distinct webhook payload shapes into one internal
shape the persistence layer doesn't need to know about (Sprint 08 Day 2).

Verified live during planning (Meta's current webhook reference docs for
both products, not assumed):
- Facebook Pages: `object:"page"`, a generic `field:"feed"` shared by posts/
  photos/videos/comments/reactions — comments are one `item` value among
  several (`item:"comment"`, `verb:"add"|"edited"|"remove"`).
- Instagram: `object:"instagram"`, a DEDICATED `field:"comments"` (no
  generic feed field, no `verb` — deletions aren't signaled this way for
  Instagram; the backfill sync is the only path that detects an Instagram
  comment deleted on Meta's side, since nothing here can).

Only comment-related changes are parsed; anything else (a Facebook `feed`
item that is a post/photo/video/reaction, or an unrecognized `object`)
yields None — the caller does not even log a `webhook_events` row for it,
since we're not subscribed to act on it at all.
"""
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class CommentEvent:
    external_account_id: str
    external_comment_id: str
    external_publication_id: str | None
    author_external_id: str | None
    author_name: str | None
    content: str | None
    is_removed: bool
    meta_created_at: datetime | None


def _facebook_comment_event(entry_id: str, value: dict) -> CommentEvent | None:
    if value.get("item") != "comment":
        return None
    verb = value.get("verb")
    from_ = value.get("from") or {}
    created_time = value.get("created_time")
    return CommentEvent(
        external_account_id=entry_id,
        external_comment_id=value.get("comment_id", ""),
        external_publication_id=value.get("post_id"),
        author_external_id=from_.get("id"),
        author_name=from_.get("name"),
        content=value.get("message") if verb != "remove" else None,
        is_removed=verb == "remove",
        meta_created_at=datetime.fromtimestamp(created_time, tz=timezone.utc) if created_time else None,
    )


def _instagram_comment_event(entry_id: str, value: dict) -> CommentEvent | None:
    from_ = value.get("from") or {}
    media = value.get("media") or {}
    return CommentEvent(
        external_account_id=entry_id,
        external_comment_id=value.get("id", ""),
        external_publication_id=media.get("id"),
        author_external_id=from_.get("id"),
        author_name=from_.get("username"),
        content=value.get("text"),
        is_removed=False,
        meta_created_at=None,
    )


def parse_comment_event(object_field: str, entry_id: str, change: dict) -> CommentEvent | None:
    field = change.get("field")
    value = change.get("value") or {}
    if object_field == "page" and field == "feed":
        return _facebook_comment_event(entry_id, value)
    if object_field == "instagram" and field == "comments":
        return _instagram_comment_event(entry_id, value)
    return None


def iter_entries(payload: dict):
    """Yields (entry_id, change) for every change in every entry — a single
    POST can batch several entries and several changes per entry."""
    for entry in payload.get("entry", []):
        entry_id = entry.get("id", "")
        for change in entry.get("changes", []):
            yield entry_id, change

"""InstagramProvider (Sprint 07): container-based publishing, comments, insights.

Instagram's publishing model differs from Facebook's in ways this class
takes seriously instead of assuming parity (per the sprint's own risk list):
a container must be created and polled until FINISHED before it can be
published, a single image only (no carousel/video-by-URL this sprint), and
replies use a dedicated `/replies` edge rather than reusing `/comments`
(Facebook posts a reply to `{comment_id}/comments`; Instagram uses
`{comment_id}/replies` — verified separately, not assumed identical).
"""
import asyncio

from core.config import settings
from core.exceptions import GraphAPIError
from modules.facebook.schemas.internal import CommentSyncItem
from modules.instagram import client as ig_client

_TERMINAL_STATUSES = {"FINISHED", "ERROR", "EXPIRED"}


class InstagramProvider:
    name = "instagram"

    async def publish(self, *, account: dict, token: str, content: str, media_urls: list[str]) -> str:
        auth_method = account["auth_method"]
        ig_user_id = account["external_account_id"]

        if not media_urls:
            raise GraphAPIError(
                status_code=422,
                detail="Une image est requise pour publier sur Instagram.",
                code="invalid_media",
            )
        if len(media_urls) > 1:
            raise GraphAPIError(
                status_code=422,
                detail="Une seule image par publication Instagram à ce sprint (pas de carrousel).",
                code="invalid_media",
            )

        container = await ig_client.post(
            auth_method,
            f"{ig_user_id}/media",
            token,
            data={"image_url": media_urls[0], "caption": content or ""},
        )
        container_id = container["id"]

        status = await self._wait_for_container(auth_method, container_id, token)
        if status != "FINISHED":
            raise GraphAPIError(
                status_code=422,
                detail=f"Le média Instagram n'a pas pu être traité (statut={status}).",
                code="invalid_media",
            )

        published = await ig_client.post(
            auth_method, f"{ig_user_id}/media_publish", token, data={"creation_id": container_id}
        )
        return published["id"]

    async def _wait_for_container(self, auth_method: str, container_id: str, token: str) -> str:
        for _ in range(settings.instagram_container_poll_max_attempts):
            data = await ig_client.get(auth_method, container_id, token, params={"fields": "status_code"})
            status = data.get("status_code")
            if status in _TERMINAL_STATUSES:
                return status
            await asyncio.sleep(settings.instagram_container_poll_interval_seconds)
        raise GraphAPIError(
            status_code=504,
            detail="Délai dépassé en attendant le traitement du média Instagram.",
            code="provider_timeout",
        )

    async def get_comments(
        self, *, account: dict, token: str, external_publication_id: str, limit: int, cursor: str | None
    ) -> tuple[list[CommentSyncItem], str | None, bool]:
        auth_method = account["auth_method"]
        params: dict = {"fields": "id,text,username,timestamp", "limit": limit}
        if cursor:
            params["after"] = cursor

        data = await ig_client.get(auth_method, f"{external_publication_id}/comments", token, params=params)
        items = [
            CommentSyncItem(
                external_comment_id=item["id"],
                external_publication_id=external_publication_id,
                author_external_id=None,  # Instagram exposes only a username here, not a stable id.
                author_name=item.get("username"),
                content=item.get("text"),
                created_at=item.get("timestamp"),
                updated_at=item.get("timestamp"),
                is_deleted=False,
            )
            for item in data.get("data", [])
        ]
        paging = data.get("paging", {})
        next_cursor = paging.get("cursors", {}).get("after")
        return items, next_cursor, "next" in paging

    async def reply_to_comment(
        self, *, account: dict, token: str, external_comment_id: str, text: str
    ) -> str:
        auth_method = account["auth_method"]
        data = await ig_client.post(auth_method, f"{external_comment_id}/replies", token, data={"message": text})
        return data["id"]

    async def get_insights(self, *, account: dict, token: str, external_publication_id: str) -> dict:
        auth_method = account["auth_method"]
        try:
            data = await ig_client.get(
                auth_method,
                f"{external_publication_id}/insights",
                token,
                params={"metric": "reach,impressions,likes,comments,shares"},
            )
        except GraphAPIError:
            return {"reactions": None, "comments": None, "shares": None, "reach": None, "impressions": None}

        values: dict = {}
        for metric in data.get("data", []):
            metric_values = metric.get("values", [{}])
            values[metric.get("name")] = metric_values[0].get("value") if metric_values else None

        return {
            "reactions": values.get("likes"),
            "comments": values.get("comments"),
            "shares": values.get("shares"),
            "reach": values.get("reach"),
            "impressions": values.get("impressions"),
        }

"""FacebookProvider (Sprint 07): the SocialProvider adapter for provider
FACEBOOK, reusing the same hardened services as /facebook/* (Sprint 05) —
just parameterized with a per-account client instead of the global one.
"""
import json

import httpx

from core.exceptions import GraphAPIError
from modules.facebook.clients.facebook_client import FacebookClient
from modules.facebook.schemas.comments import ReplyCreate
from modules.facebook.schemas.internal import CommentSyncItem
from modules.facebook.services import comments_service, post_analytics_service


async def _fetch_image(url: str) -> tuple[bytes, str]:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise GraphAPIError(
            status_code=422,
            detail="Média introuvable ou inaccessible à l'URL fournie.",
            code="invalid_media",
        ) from exc
    content_type = response.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
    return response.content, content_type


class FacebookProvider:
    name = "facebook"

    @staticmethod
    def _client(account: dict, token: str) -> FacebookClient:
        return FacebookClient(page_id=account["external_account_id"], access_token=token)

    async def publish(self, *, account: dict, token: str, content: str, media_urls: list[str]) -> str:
        client = self._client(account, token)
        page_id = account["external_account_id"]

        if not media_urls:
            if not content:
                raise GraphAPIError(
                    status_code=422, detail="Contenu ou média requis.", code="unprocessable"
                )
            data = await client.post_form(f"{page_id}/feed", data={"message": content})
            return data["id"]

        photo_ids: list[str] = []
        for media_url in media_urls:
            image_content, content_type = await _fetch_image(media_url)
            if not content_type.startswith("image/"):
                raise GraphAPIError(
                    status_code=422,
                    detail="Seules les images par URL sont prises en charge à ce sprint.",
                    code="invalid_media",
                )
            photo_id = await client.upload_unpublished_photo(
                content=image_content, filename="media", content_type=content_type
            )
            photo_ids.append(photo_id)

        post_data: dict = {"attached_media": json.dumps([{"media_fbid": pid} for pid in photo_ids])}
        if content:
            post_data["message"] = content
        data = await client.post_form(f"{page_id}/feed", data=post_data)
        return data["id"]

    async def get_comments(
        self, *, account: dict, token: str, external_publication_id: str, limit: int, cursor: str | None
    ) -> tuple[list[CommentSyncItem], str | None, bool]:
        client = self._client(account, token)
        page = await comments_service.get_post_comments(
            external_publication_id, limit=limit, after=cursor, client=client
        )
        items = [
            CommentSyncItem(
                external_comment_id=comment.id,
                external_publication_id=external_publication_id,
                author_external_id=comment.from_field.id if comment.from_field else None,
                author_name=comment.from_field.name if comment.from_field else None,
                content=comment.message,
                created_at=comment.created_time,
                updated_at=comment.created_time,
                is_deleted=False,
            )
            for comment in page.data
        ]
        next_cursor = page.paging.cursors.after if page.paging.cursors else None
        return items, next_cursor, page.paging.has_next_page

    async def reply_to_comment(
        self, *, account: dict, token: str, external_comment_id: str, text: str
    ) -> str:
        client = self._client(account, token)
        result = await comments_service.reply_to_comment(
            external_comment_id, ReplyCreate(message=text), client=client
        )
        return result.id

    async def get_insights(self, *, account: dict, token: str, external_publication_id: str) -> dict:
        client = self._client(account, token)
        analytics = await post_analytics_service.get_post_analytics(external_publication_id, client=client)
        return {
            "reactions": analytics.reactions_total,
            "comments": analytics.comments,
            "shares": analytics.shares,
            "reach": analytics.reach,
            "impressions": analytics.impressions,
        }

from fastapi import HTTPException, UploadFile

from core.exceptions import GraphAPIError
from modules.facebook.clients.facebook_client import facebook_client
from modules.facebook.schemas.pagination import PaginatedList
from modules.facebook.schemas.stories import StoryCreateResponse, StoryResponse
from modules.facebook.services.pagination_helpers import meta_pagination_params, paging_from_meta

_IMAGE_TYPES = {
    "image/jpeg", "image/png", "image/gif",
    "image/tiff", "image/bmp", "image/webp",
}
_VIDEO_TYPES = {
    "video/mp4", "video/quicktime", "video/x-msvideo",
    "video/x-ms-wmv", "video/mpeg", "video/3gpp",
}
_ACCEPTED_TYPES = _IMAGE_TYPES | _VIDEO_TYPES


async def create_story(file: UploadFile, message: str | None = None) -> StoryCreateResponse:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier story vide ou invalide.")

    content_type = (file.content_type or "").strip().lower()
    if content_type not in _ACCEPTED_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Type non supporte pour story. Utilisez image/* ou video/* compatible.",
        )

    filename = file.filename or "story-upload"

    if content_type in _IMAGE_TYPES:
        data = {"published": "true"}
        if message:
            data["caption"] = message
        endpoint = f"{facebook_client.page_id}/photo_stories"
    else:
        data = {"published": "true"}
        if message:
            data["description"] = message
        endpoint = f"{facebook_client.page_id}/video_stories"

    try:
        result = await facebook_client.post_multipart(
            endpoint,
            data=data,
            files={"source": (filename, content, content_type)},
        )
    except GraphAPIError as exc:
        if exc.status_code >= 500:
            raise HTTPException(
                status_code=400,
                detail=(
                    "La publication de story a ete refusee par Facebook pour cette page "
                    "(capabilite/permission stories). Detail Graph API: " + str(exc.detail)
                ),
            ) from exc
        raise

    story_id = result.get("id") or result.get("post_id") or result.get("story_id")
    success = result.get("success")
    if isinstance(success, str):
        success = success.lower() == "true"

    return StoryCreateResponse(id=story_id, success=success if isinstance(success, bool) else None)


async def list_stories(
    limit: int = 25,
    after: str | None = None,
    before: str | None = None,
) -> PaginatedList[StoryResponse]:
    params = {
        "fields": "id,created_time,permalink_url,status",
        **meta_pagination_params(limit, after, before),
    }
    data = await facebook_client.get(f"{facebook_client.page_id}/stories", params=params)

    stories: list[StoryResponse] = []
    for item in data.get("data", []):
        stories.append(
            StoryResponse(
                id=item.get("id", ""),
                created_time=item.get("created_time"),
                permalink_url=item.get("permalink_url"),
                status=item.get("status"),
            )
        )
    return PaginatedList[StoryResponse](data=stories, paging=paging_from_meta(data.get("paging")))


async def delete_story(story_id: str) -> dict:
    return await facebook_client.delete(story_id)

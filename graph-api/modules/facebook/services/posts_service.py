import json
import mimetypes
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, UploadFile

from core.exceptions import GraphAPIError
from modules.facebook.clients.facebook_client import facebook_client
from modules.facebook.schemas.pagination import PaginatedList
from modules.facebook.services.pagination_helpers import (
    meta_pagination_params,
    paging_from_meta,
)
from modules.facebook.schemas.posts import (
    CommunityManagerStat,
    CommunityManagersStatsResponse,
    PostCreateResponse,
    PostAuthor,
    PostResponse,
    PostStatsResponse,
    ReactionsDetail,
    ScheduledPostCreate,
    ScheduledPostResponse,
    ScheduledPostUpdate,
)

# Types de fichiers acceptés par Facebook
_IMAGE_TYPES = {
    "image/jpeg", "image/png", "image/gif",
    "image/tiff", "image/bmp", "image/webp",
}
_VIDEO_TYPES = {
    "video/mp4", "video/quicktime", "video/x-msvideo",
    "video/x-ms-wmv", "video/mpeg", "video/3gpp",
}
_ACCEPTED_TYPES = _IMAGE_TYPES | _VIDEO_TYPES


def _parse_scheduled_publish_time(value: str, timezone_offset_minutes: int | None = None) -> int:
    """Convertit une date planifiée en timestamp Unix (secondes)."""
    if value is None:
        raise HTTPException(status_code=400, detail="scheduled_publish_time est requis.")

    raw = str(value).strip()
    if not raw:
        raise HTTPException(status_code=400, detail="scheduled_publish_time est requis.")

    if raw.isdigit():
        timestamp = int(raw)
    else:
        normalized = raw.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(normalized)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail="Format de date invalide. Utilisez un timestamp Unix ou ISO-8601.",
            ) from exc

        if dt.tzinfo is None:
            if timezone_offset_minutes is not None:
                # JS getTimezoneOffset() = UTC - local_time
                # Donc UTC = date_locale + offset
                dt = (dt + timedelta(minutes=timezone_offset_minutes)).replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone()
        timestamp = int(dt.timestamp())

    min_allowed = int((datetime.now(timezone.utc) + timedelta(minutes=10)).timestamp())
    if timestamp < min_allowed:
        raise HTTPException(
            status_code=400,
            detail="La date planifiee doit etre au moins 10 minutes dans le futur.",
        )

    return timestamp


def _validate_date_param(name: str, value: str | None) -> None:
    """Meta accepts a Unix timestamp or a YYYY-MM-DD date for since/until.

    Anything else is rejected locally instead of being forwarded to Meta
    unvalidated (Sprint 05 Day 2).
    """
    if value is None:
        return
    raw = value.strip()
    if raw.isdigit():
        return
    try:
        datetime.strptime(raw, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Paramètre '{name}' invalide : utilisez un timestamp Unix ou une date YYYY-MM-DD.",
        ) from exc


def _guess_content_type_from_bytes(sample: bytes) -> str | None:
    if not sample:
        return None

    # Images
    if sample.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if sample.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if sample.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if sample.startswith(b"BM"):
        return "image/bmp"
    if sample[:4] in (b"II*\x00", b"MM\x00*"):
        return "image/tiff"
    if len(sample) >= 12 and sample[:4] == b"RIFF" and sample[8:12] == b"WEBP":
        return "image/webp"

    # Videos (containers/signatures)
    if len(sample) >= 12 and sample[4:8] == b"ftyp":
        major = sample[8:12]
        if major in (b"qt  ",):
            return "video/quicktime"
        if major in (b"3gp4", b"3gp5", b"3gp6", b"3g2a", b"3g2b"):
            return "video/3gpp"
        return "video/mp4"
    if sample.startswith(b"RIFF") and len(sample) >= 12 and sample[8:12] == b"AVI ":
        return "video/x-msvideo"
    if sample.startswith(b"\x30\x26\xb2\x75\x8e\x66\xcf\x11"):
        return "video/x-ms-wmv"
    if sample.startswith(b"\x00\x00\x01\xba") or sample.startswith(b"\x00\x00\x01\xb3"):
        return "video/mpeg"

    return None


def _resolve_content_type(file: UploadFile, sample: bytes | None = None) -> str:
    """Normalise le content-type et tente une déduction via l'extension."""
    current = (file.content_type or "").strip().lower()
    if current and current != "application/octet-stream":
        return current

    guessed, _ = mimetypes.guess_type(file.filename or "")
    if guessed:
        return guessed.lower()

    sniffed = _guess_content_type_from_bytes(sample or b"")
    if sniffed:
        return sniffed

    # Certains clients envoient octet-stream sans information exploitable.
    # Dans ce cas, on conserve une valeur supportée au lieu de refuser l'envoi.
    if current == "application/octet-stream":
        return "image/jpeg"

    return current


async def get_page_posts(
    since: str | None = None,
    until: str | None = None,
    limit: int = 25,
    after: str | None = None,
    before: str | None = None,
) -> PaginatedList[PostResponse]:
    """Récupère les publications de la page Facebook, optionnellement filtrées par date.

    Args:
        since: Date de début (format ISO: "2024-01-01")
        until: Date de fin (format ISO: "2024-12-31")
        limit: Nombre maximal de publications par page (1 à 100)
        after: Curseur de pagination (page suivante)
        before: Curseur de pagination (page précédente)
    """
    _validate_date_param("since", since)
    _validate_date_param("until", until)

    reaction_types = ["LIKE", "LOVE", "WOW", "HAHA", "SAD", "ANGRY"]
    reaction_fields = ",".join(
        f"reactions.type({rtype}).limit(0).summary(total_count).as(reactions_{rtype.lower()})"
        for rtype in reaction_types
    )

    fields = (
        "id,message,created_time,permalink_url,full_picture,from{id,name},shares,"
        + reaction_fields
        + ",comments.limit(0).summary(total_count).as(comments_summary)"
    )

    params = {"fields": fields, **meta_pagination_params(limit, after, before)}
    if since:
        params["since"] = since
    if until:
        params["until"] = until

    data = await facebook_client.get(
        f"{facebook_client.page_id}/posts",
        params=params,
    )

    posts: list[PostResponse] = []
    for post in data.get("data", []):
        reactions = {}
        for rtype in reaction_types:
            key = f"reactions_{rtype.lower()}"
            reactions[rtype.lower()] = (
                post.get(key, {}).get("summary", {}).get("total_count", 0)
            )
        reactions["total"] = sum(reactions.values())

        comments_count = (
            post.get("comments_summary", {})
            .get("summary", {})
            .get("total_count", 0)
        )
        shares_count = post.get("shares", {}).get("count", 0)

        posts.append(
            PostResponse(
                id=post.get("id"),
                message=post.get("message"),
                created_time=post.get("created_time"),
                permalink_url=post.get("permalink_url"),
                full_picture=post.get("full_picture"),
                from_field=PostAuthor(**post.get("from", {})) if post.get("from") else None,
                reactions=ReactionsDetail(**reactions),
                comments_count=comments_count,
                shares_count=shares_count,
            )
        )

    return PaginatedList[PostResponse](data=posts, paging=paging_from_meta(data.get("paging")))


async def get_community_managers_stats(
    since: str | None = None,
    until: str | None = None,
) -> CommunityManagersStatsResponse:
    # Aggregate over a single (large) page: this endpoint summarizes activity,
    # it does not expose pagination itself (out of Sprint 05 Day 3's scope).
    posts_page = await get_page_posts(since=since, until=until, limit=100)
    posts = posts_page.data

    stats_by_author: dict[str, CommunityManagerStat] = {}
    total_reactions = 0
    total_comments = 0

    for post in posts:
        author = post.from_field
        if not author:
            continue

        reactions_total = post.reactions.total if post.reactions else 0
        comments_count = post.comments_count or 0
        total_reactions += reactions_total
        total_comments += comments_count

        current = stats_by_author.get(author.id)
        if current is None:
            current = CommunityManagerStat(
                author_id=author.id,
                author_name=author.name,
                posts_count=0,
                reactions_total=0,
                comments_total=0,
                first_post_time=post.created_time,
                last_post_time=post.created_time,
            )
            stats_by_author[author.id] = current

        current.posts_count += 1
        current.reactions_total += reactions_total
        current.comments_total += comments_count

        if post.created_time:
            if current.first_post_time is None or post.created_time < current.first_post_time:
                current.first_post_time = post.created_time
            if current.last_post_time is None or post.created_time > current.last_post_time:
                current.last_post_time = post.created_time

    return CommunityManagersStatsResponse(
        since=since,
        until=until,
        total_posts=len(posts),
        total_reactions=total_reactions,
        total_comments=total_comments,
        items=sorted(
            stats_by_author.values(),
            key=lambda item: (item.posts_count, item.reactions_total, item.comments_total),
            reverse=True,
        ),
    )


async def create_post(
    message: str | None,
    files: list[UploadFile],
) -> PostCreateResponse:
    """Endpoint unifié : post texte, image(s) ou vidéo."""
    effective_files: list[UploadFile] = []
    file_contents: dict[int, bytes] = {}

    # Certains clients envoient un champ fichier vide même sans sélection.
    # On ignore ce placeholder pour conserver le flux "texte seul".
    for f in files:
        content = await f.read()
        await f.seek(0)

        filename = (f.filename or "").strip()
        if not filename and len(content) == 0:
            continue

        effective_files.append(f)
        file_contents[id(f)] = content

    if not effective_files:
        if not message:
            raise HTTPException(status_code=400, detail="Un message ou un fichier est requis.")
        data = await facebook_client.post_form(
            f"{facebook_client.page_id}/feed",
            data={"message": message},
        )
        return PostCreateResponse(**data)

    # Valider tous les types avant de commencer les uploads
    normalized_types: dict[int, str] = {}
    for f in effective_files:
        content = file_contents.get(id(f), b"")

        if not content or len(content) == 0:
            raise HTTPException(
                status_code=400,
                detail=f"Fichier vide ou non transmis: '{f.filename or 'inconnu'}'.",
            )

        ct = _resolve_content_type(f, content[:512])
        normalized_types[id(f)] = ct
        if ct not in _ACCEPTED_TYPES:
            accepted = ", ".join(sorted(_ACCEPTED_TYPES))
            raise HTTPException(
                status_code=400,
                detail=f"Type '{ct}' non supporté. Types acceptés : {accepted}",
            )

    # Multi-fichiers : uniquement des images
    if len(effective_files) > 1:
        for f in effective_files:
            if normalized_types.get(id(f), "") not in _IMAGE_TYPES:
                raise HTTPException(
                    status_code=400,
                    detail="Une publication multi-fichiers ne peut contenir que des images.",
                )
        photo_ids = []
        for f in effective_files:
            content = file_contents.get(id(f), b"")
            file_content_type = normalized_types.get(id(f), "") or "image/jpeg"
            photo_id = await facebook_client.upload_unpublished_photo(
                content=content,
                filename=f.filename or "image",
                content_type=file_content_type,
            )
            photo_ids.append(photo_id)

        post_data: dict = {
            "attached_media": json.dumps([{"media_fbid": pid} for pid in photo_ids])
        }
        if message:
            post_data["message"] = message

        data = await facebook_client.post_form(
            f"{facebook_client.page_id}/feed", data=post_data
        )
        return PostCreateResponse(**data)

    # Fichier unique
    file = effective_files[0]
    ct = normalized_types.get(id(file), "")
    content = file_contents.get(id(file), b"")
    fname = file.filename or "upload"

    if ct in _IMAGE_TYPES:
        form_data = {"message": message} if message else {}
        data = await facebook_client.post_multipart(
            f"{facebook_client.page_id}/photos",
            data=form_data,
            files={"source": (fname, content, ct)},
        )
    else:  # vidéo
        form_data = {"description": message} if message else {}
        data = await facebook_client.post_multipart(
            f"{facebook_client.page_id}/videos",
            data=form_data,
            files={"source": (fname, content, ct)},
        )

    return PostCreateResponse(**data)


async def get_post_stats(post_id: str) -> PostStatsResponse:
    """Récupère les statistiques d'une publication Facebook (réactions, commentaires, partages)."""

    # Champs Graph API : chaque type de réaction séparément + commentaires + partages
    reaction_types = ["LIKE", "LOVE", "WOW", "HAHA", "SAD", "ANGRY"]
    reaction_fields = ",".join(
        f"reactions.type({rtype}).limit(0).summary(total_count).as(reactions_{rtype.lower()})"
        for rtype in reaction_types
    )
    fields = f"{reaction_fields},comments.limit(0).summary(total_count),shares"

    data = await facebook_client.get(post_id, params={"fields": fields})

    # Extraire le count de chaque type de réaction
    reactions = {}
    for rtype in reaction_types:
        key = f"reactions_{rtype.lower()}"
        reactions[rtype.lower()] = (
            data.get(key, {}).get("summary", {}).get("total_count", 0)
        )

    reactions["total"] = sum(reactions.values())

    comments_count = data.get("comments", {}).get("summary", {}).get("total_count", 0)
    shares_count = data.get("shares", {}).get("count", 0)

    return PostStatsResponse(
        post_id=post_id,
        reactions=ReactionsDetail(**reactions),
        comments=comments_count,
        shares=shares_count,
    )


async def update_post(post_id: str, message: str) -> dict:
    cleaned_message = (message or "").strip()
    if not cleaned_message:
        raise HTTPException(status_code=400, detail="Le message ne peut pas etre vide.")
    return await facebook_client.post_form(post_id, data={"message": cleaned_message})


async def delete_post(post_id: str) -> dict:
    normalized = (post_id or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="post_id manquant.")

    # Certains objets renvoient un id compose pageId_objectId ;
    # selon le type de publication, Facebook peut n'accepter que la partie objet.
    candidate_ids: list[str] = [normalized]
    if "_" in normalized:
        suffix = normalized.split("_", 1)[1].strip()
        if suffix and suffix not in candidate_ids:
            candidate_ids.append(suffix)

    last_error: GraphAPIError | None = None
    for candidate in candidate_ids:
        try:
            return await facebook_client.delete(candidate)
        except GraphAPIError as exc:
            last_error = exc

    if last_error is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Suppression refusee par Facebook. Verifiez que le token de page "
                "a la permission pages_manage_posts et que la publication est bien supprimable. "
                f"Detail Graph API: {last_error.detail}"
            ),
        ) from last_error

    raise HTTPException(status_code=500, detail="Echec inattendu lors de la suppression.")


async def create_scheduled_post(
    message: str | None,
    scheduled_publish_time: str,
    timezone_offset_minutes: int | None,
    files: list[UploadFile],
) -> PostCreateResponse:
    """Programme une publication avec support texte + médias (images/vidéos)."""
    scheduled_ts = _parse_scheduled_publish_time(scheduled_publish_time, timezone_offset_minutes)
    
    effective_files: list[UploadFile] = []
    file_contents: dict[int, bytes] = {}

    for f in files:
        content = await f.read()
        await f.seek(0)
        filename = (f.filename or "").strip()
        if not filename and len(content) == 0:
            continue
        effective_files.append(f)
        file_contents[id(f)] = content

    if not effective_files:
        if not message:
            raise HTTPException(status_code=400, detail="Un message ou un fichier est requis.")
        data = await facebook_client.post_form(
            f"{facebook_client.page_id}/feed",
            data={
                "message": message,
                "published": "false",
                "scheduled_publish_time": str(scheduled_ts),
            },
        )
        return PostCreateResponse(**data)

    normalized_types: dict[int, str] = {}
    for f in effective_files:
        content = file_contents.get(id(f), b"")
        if not content or len(content) == 0:
            raise HTTPException(
                status_code=400,
                detail=f"Fichier vide ou non transmis: '{f.filename or 'inconnu'}'.",
            )
        ct = _resolve_content_type(f, content[:512])
        normalized_types[id(f)] = ct
        if ct not in _ACCEPTED_TYPES:
            accepted = ", ".join(sorted(_ACCEPTED_TYPES))
            raise HTTPException(
                status_code=400,
                detail=f"Type '{ct}' non supporté. Types acceptés : {accepted}",
            )

    if len(effective_files) > 1:
        for f in effective_files:
            if normalized_types.get(id(f), "") not in _IMAGE_TYPES:
                raise HTTPException(
                    status_code=400,
                    detail="Une publication multi-fichiers ne peut contenir que des images.",
                )
        photo_ids = []
        for f in effective_files:
            content = file_contents.get(id(f), b"")
            file_content_type = normalized_types.get(id(f), "") or "image/jpeg"
            photo_id = await facebook_client.upload_unpublished_photo(
                content=content,
                filename=f.filename or "image",
                content_type=file_content_type,
            )
            photo_ids.append(photo_id)

        post_data: dict = {
            "attached_media": json.dumps([{"media_fbid": pid} for pid in photo_ids]),
            "published": "false",
            "scheduled_publish_time": str(scheduled_ts),
        }
        if message:
            post_data["message"] = message

        data = await facebook_client.post_form(
            f"{facebook_client.page_id}/feed", data=post_data
        )
        return PostCreateResponse(**data)

    file = effective_files[0]
    ct = normalized_types.get(id(file), "")
    content = file_contents.get(id(file), b"")
    fname = file.filename or "upload"

    if ct in _IMAGE_TYPES:
        form_data = {
            "published": "false",
            "scheduled_publish_time": str(scheduled_ts),
        }
        if message:
            form_data["message"] = message
        data = await facebook_client.post_multipart(
            f"{facebook_client.page_id}/photos",
            data=form_data,
            files={"source": (fname, content, ct)},
        )
    else:
        form_data = {
            "published": "false",
            "scheduled_publish_time": str(scheduled_ts),
        }
        if message:
            form_data["description"] = message
        data = await facebook_client.post_multipart(
            f"{facebook_client.page_id}/videos",
            data=form_data,
            files={"source": (fname, content, ct)},
        )

    return PostCreateResponse(**data)


async def list_scheduled_posts(
    limit: int = 25,
    after: str | None = None,
    before: str | None = None,
) -> PaginatedList[ScheduledPostResponse]:
    fields = "id,message,created_time,scheduled_publish_time,permalink_url,is_published"
    params = {
        "fields": fields,
        "is_published": "false",
        **meta_pagination_params(limit, after, before),
    }
    data = await facebook_client.get(
        f"{facebook_client.page_id}/scheduled_posts",
        params=params,
    )

    posts: list[ScheduledPostResponse] = []
    for post in data.get("data", []):
        scheduled_publish_time = post.get("scheduled_publish_time")
        if scheduled_publish_time is None:
            continue
        posts.append(
            ScheduledPostResponse(
                id=post.get("id", ""),
                message=post.get("message"),
                created_time=post.get("created_time"),
                scheduled_publish_time=scheduled_publish_time,
                permalink_url=post.get("permalink_url"),
                is_published=post.get("is_published"),
            )
        )

    posts.sort(
        key=lambda item: item.scheduled_publish_time if item.scheduled_publish_time else 0
    )
    return PaginatedList[ScheduledPostResponse](
        data=posts, paging=paging_from_meta(data.get("paging"))
    )


async def _process_scheduled_post_media(
    post_id: str, files: list[UploadFile], payload: dict
) -> None:
    """Traite les fichiers pour une publication programmée en édition.
    
    Télécharge les médias non-publiés et attache au post existant.
    """
    if not files:
        return

    uploaded_photo_ids = []
    video_found = False

    for file in files:
        content = await file.read()
        ct = file.content_type or "application/octet-stream"

        if ct not in _ACCEPTED_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Type de fichier '{ct}' non accepté par Facebook.",
            )

        fname = file.filename or "upload"
        is_image = ct in _IMAGE_TYPES
        is_video = ct in _VIDEO_TYPES

        if is_video:
            if video_found or len(uploaded_photo_ids) > 0:
                raise HTTPException(
                    status_code=400,
                    detail="Une vidéo ne peut pas être combinée avec d'autres médias.",
                )
            video_found = True
            data = await facebook_client.post_multipart(
                f"{post_id}/videos",
                data={"published": "false"},
                files={"source": (fname, content, ct)},
            )
            video_id = data.get("id")
            if video_id:
                payload["attached_media"] = json.dumps([{"media_fbid": video_id}])
        elif is_image:
            if video_found:
                raise HTTPException(
                    status_code=400,
                    detail="Une vidéo ne peut pas être combinée avec d'autres médias.",
                )
            data = await facebook_client.post_multipart(
                f"{post_id}/photos",
                data={"published": "false"},
                files={"source": (fname, content, ct)},
            )
            photo_id = data.get("id")
            if photo_id:
                uploaded_photo_ids.append(photo_id)

    if uploaded_photo_ids:
        if len(uploaded_photo_ids) > 1:
            payload["attached_media"] = json.dumps(
                [{"media_fbid": pid} for pid in uploaded_photo_ids]
            )
        else:
            payload["attached_media"] = json.dumps([{"media_fbid": uploaded_photo_ids[0]}])


async def update_scheduled_post(
    post_id: str,
    message: str | None = None,
    scheduled_publish_time: str | None = None,
    timezone_offset_minutes: int | None = None,
    files: list[UploadFile] | None = None,
) -> PostCreateResponse:
    """Met à jour une publication programmée.
    
    Peut modifier le message, la date, ou remplacer les médias attachés.
    """
    if files is None:
        files = []

    payload: dict[str, str] = {"published": "false"}

    if message is not None:
        cleaned_message = message.strip()
        if not cleaned_message:
            raise HTTPException(status_code=400, detail="Le message ne peut pas etre vide.")
        payload["message"] = cleaned_message

    if scheduled_publish_time is not None:
        payload["scheduled_publish_time"] = str(
            _parse_scheduled_publish_time(
                scheduled_publish_time,
                timezone_offset_minutes,
            )
        )

    if len(payload) == 1 and len(files) == 0:
        raise HTTPException(
            status_code=400,
            detail="Aucune modification fournie (message, scheduled_publish_time, ou fichiers).",
        )

    if len(files) > 0:
        await _process_scheduled_post_media(post_id, files, payload)

    data = await facebook_client.post_form(post_id, data=payload)
    return PostCreateResponse(**data)


async def delete_scheduled_post(post_id: str) -> dict:
    return await facebook_client.delete(post_id)

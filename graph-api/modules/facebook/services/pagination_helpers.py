from modules.facebook.schemas.pagination import PageCursors, Paging


def meta_pagination_params(limit: int, after: str | None, before: str | None) -> dict[str, str]:
    """Build the Meta-side limit/after/before query params for a list call."""
    params: dict[str, str] = {"limit": str(limit)}
    if after:
        params["after"] = after
    if before:
        params["before"] = before
    return params


def paging_from_meta(meta_paging: dict | None) -> Paging:
    """Translate Meta's ``paging`` object into the local, stable ``Paging`` shape."""
    meta_paging = meta_paging or {}
    cursors_raw = meta_paging.get("cursors") or {}
    before = cursors_raw.get("before")
    after = cursors_raw.get("after")
    return Paging(
        cursors=PageCursors(before=before, after=after) if (before or after) else None,
        has_next_page="next" in meta_paging,
        has_previous_page="previous" in meta_paging,
    )

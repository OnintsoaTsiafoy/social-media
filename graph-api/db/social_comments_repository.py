"""social_comments / comment_status_history (Sprint 08 Day 1).

graph-api is the sole writer of comment content (always sourced from Meta,
via the webhook or the backfill sync) — Express reads these tables directly
via Prisma (not secret, unlike oauth_tokens) but only ever writes `status`
for local moderation actions (ignore/escalate/manual-processed), appending
its own `comment_status_history` rows the same way this module does.
"""
from db.pool import get_pool


async def upsert_comment(
    *,
    social_account_id: str,
    external_comment_id: str,
    external_publication_id: str | None,
    author_external_id: str | None,
    author_name: str | None,
    content: str | None,
    meta_created_at,
    meta_updated_at,
) -> dict:
    """Never touches `status`: a Meta-side edit to an already-PROCESSED/
    IGNORED comment must not silently revert it to NEW. New rows still get
    the column's own default (NEW)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO social_comments
                    (social_account_id, external_comment_id, external_publication_id,
                     author_external_id, author_name, content, meta_created_at,
                     meta_updated_at, updated_at)
                VALUES (%(social_account_id)s, %(external_comment_id)s, %(external_publication_id)s,
                        %(author_external_id)s, %(author_name)s, %(content)s, %(meta_created_at)s,
                        %(meta_updated_at)s, now())
                ON CONFLICT (social_account_id, external_comment_id) DO UPDATE SET
                    external_publication_id = COALESCE(EXCLUDED.external_publication_id, social_comments.external_publication_id),
                    author_external_id = COALESCE(EXCLUDED.author_external_id, social_comments.author_external_id),
                    author_name = COALESCE(EXCLUDED.author_name, social_comments.author_name),
                    content = COALESCE(EXCLUDED.content, social_comments.content),
                    meta_updated_at = COALESCE(EXCLUDED.meta_updated_at, social_comments.meta_updated_at),
                    updated_at = now()
                RETURNING id, status
                """,
                {
                    "social_account_id": social_account_id,
                    "external_comment_id": external_comment_id,
                    "external_publication_id": external_publication_id,
                    "author_external_id": author_external_id,
                    "author_name": author_name,
                    "content": content,
                    "meta_created_at": meta_created_at,
                    "meta_updated_at": meta_updated_at,
                },
            )
            return await cur.fetchone()


async def mark_deleted(social_account_id: str, external_comment_id: str) -> dict | None:
    """A `verb:"remove"` webhook event for a comment never seen locally has
    nothing to mark — returns None rather than creating a row with no
    author/content just to flag it deleted."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE social_comments SET is_deleted_on_platform = true, updated_at = now()
                WHERE social_account_id = %s AND external_comment_id = %s
                RETURNING id
                """,
                (social_account_id, external_comment_id),
            )
            return await cur.fetchone()


async def list_known_external_ids(social_account_id: str, external_publication_id: str) -> set[str]:
    """Backfill sync delete-detection (Day 3): Meta's comments edge doesn't
    signal a deletion the way the webhook's `verb:"remove"` does — a deleted
    comment simply stops appearing in the paginated results. The caller
    fetches everything Meta currently returns for this post and diffs it
    against this set; anything locally known but missing gets `mark_deleted`."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT external_comment_id FROM social_comments
                WHERE social_account_id = %s AND external_publication_id = %s AND is_deleted_on_platform = false
                """,
                (social_account_id, external_publication_id),
            )
            rows = await cur.fetchall()
            return {row["external_comment_id"] for row in rows}


async def get_by_id(comment_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT * FROM social_comments WHERE id = %s", (comment_id,))
            return await cur.fetchone()


async def set_status(comment_id: str, to_status: str, *, changed_by_user_id: str | None, note: str | None = None) -> None:
    """Updates the comment and appends an append-only history row in one
    transaction — same "one writer, one call" reasoning as the status/history
    pair elsewhere in this codebase."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                # SELECT before UPDATE, not `UPDATE ... RETURNING`, which would
                # return the new value, not the from_status history needs.
                await cur.execute("SELECT status FROM social_comments WHERE id = %s FOR UPDATE", (comment_id,))
                previous = await cur.fetchone()
                from_status = previous["status"] if previous else None

                await cur.execute(
                    "UPDATE social_comments SET status = %s, updated_at = now() WHERE id = %s",
                    (to_status, comment_id),
                )

                await cur.execute(
                    """
                    INSERT INTO comment_status_history
                        (comment_id, from_status, to_status, changed_by_user_id, note)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (comment_id, from_status, to_status, changed_by_user_id, note),
                )

"""Sprint 08 Day 3: sync_comments now persists as it walks pages, detects
deletions, and bumps last_comments_sync_at — none of that existed before
this sprint (the route was pure pass-through, see test_internal_routes.py's
pre-existing tests, which only check the response shape)."""
import httpx

from tests.conftest import META_BASE_URL, make_service_jwt

FACEBOOK_ACCOUNT_ID = "fb-account-1"


def _auth_header(**kwargs) -> dict:
    return {"Authorization": f"Bearer {make_service_jwt(**kwargs)}"}


def _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store):
    fake_social_accounts_store[("FACEBOOK", "page-42")] = {
        "id": FACEBOOK_ACCOUNT_ID,
        "brand_id": "brand-1",
        "provider": "FACEBOOK",
        "external_account_id": "page-42",
        "name": "Studio Vega",
        "auth_method": "FACEBOOK_PAGE",
        "status": "CONNECTED",
        "last_comments_sync_at": None,
    }
    fake_oauth_tokens_store[FACEBOOK_ACCOUNT_ID] = {"access_token": "page-42-token"}


def _sync(client, publication_external_ids=("post-1",), limit=100):
    return client.post(
        "/internal/v1/comments/sync",
        json={
            "socialAccountId": FACEBOOK_ACCOUNT_ID,
            "provider": "facebook",
            "publicationExternalIds": list(publication_external_ids),
            "limit": limit,
        },
        headers=_auth_header(scope=["social:read"]),
    )


def test_synced_comment_is_persisted(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store, fake_social_comments_store
):
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/post-1/comments").mock(
        return_value=httpx.Response(
            200,
            json={"data": [{"id": "c1", "message": "Bonjour", "from": {"id": "u1", "name": "Alice"}, "created_time": "2026-01-01T10:00:00+0000"}]},
        )
    )

    response = _sync(client)

    assert response.status_code == 200
    assert len(fake_social_comments_store) == 1
    stored = next(iter(fake_social_comments_store.values()))
    assert stored["content"] == "Bonjour"
    assert stored["author_name"] == "Alice"


def test_sync_walks_every_page(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store, fake_social_comments_store
):
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)

    def _responder(request):
        after = request.url.params.get("after")
        if after is None:
            return httpx.Response(
                200,
                json={
                    "data": [{"id": "c1", "message": "Page 1", "from": {"id": "u1", "name": "Alice"}, "created_time": "2026-01-01T10:00:00+0000"}],
                    "paging": {"cursors": {"after": "cursor-2"}, "next": "..."},
                },
            )
        return httpx.Response(
            200,
            json={
                "data": [{"id": "c2", "message": "Page 2", "from": {"id": "u2", "name": "Bob"}, "created_time": "2026-01-01T11:00:00+0000"}],
                "paging": {"cursors": {"after": "cursor-2"}},
            },
        )

    respx_mock.get(f"{META_BASE_URL}/post-1/comments").mock(side_effect=_responder)

    response = _sync(client)

    assert response.status_code == 200
    assert len(fake_social_comments_store) == 2
    contents = {row["content"] for row in fake_social_comments_store.values()}
    assert contents == {"Page 1", "Page 2"}


def test_sync_marks_missing_comment_deleted(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store, fake_social_comments_store
):
    """A comment known locally but no longer returned by Meta must be
    detected as deleted — Meta's paginated response never signals a removal
    the way the webhook's verb:"remove" does."""
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    fake_social_comments_store[(FACEBOOK_ACCOUNT_ID, "gone")] = {
        "id": "comment-existing",
        "social_account_id": FACEBOOK_ACCOUNT_ID,
        "external_comment_id": "gone",
        "external_publication_id": "post-1",
        "status": "NEW",
        "is_deleted_on_platform": False,
    }
    respx_mock.get(f"{META_BASE_URL}/post-1/comments").mock(
        return_value=httpx.Response(
            200,
            json={"data": [{"id": "still-here", "message": "Toujours là", "from": {"id": "u1", "name": "Alice"}, "created_time": "2026-01-01T10:00:00+0000"}]},
        )
    )

    response = _sync(client)

    assert response.status_code == 200
    assert fake_social_comments_store[(FACEBOOK_ACCOUNT_ID, "gone")]["is_deleted_on_platform"] is True


def test_sync_bumps_last_comments_sync_at(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store, fake_social_comments_store
):
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/post-1/comments").mock(return_value=httpx.Response(200, json={"data": []}))

    assert fake_social_accounts_store[("FACEBOOK", "page-42")]["last_comments_sync_at"] is None

    response = _sync(client)

    assert response.status_code == 200
    assert fake_social_accounts_store[("FACEBOOK", "page-42")]["last_comments_sync_at"] is not None


def test_legacy_global_sync_without_social_account_id_does_not_persist(
    client, service_jwt_settings, configured_settings, respx_mock, fake_social_comments_store
):
    """Sprint 05 behavior preserved: no socialAccountId means no
    social_accounts row to persist against — stays transient/pass-through."""
    respx_mock.get(f"{META_BASE_URL}/1_1/comments").mock(
        return_value=httpx.Response(
            200,
            json={"data": [{"id": "c1", "message": "Bonjour", "from": {"id": "u1", "name": "Alice"}, "created_time": "2026-01-01T10:00:00+0000"}]},
        )
    )

    response = client.post(
        "/internal/v1/comments/sync",
        json={"socialAccountId": None, "provider": "facebook", "publicationExternalIds": ["1_1"], "limit": 100},
        headers=_auth_header(scope=["social:read"]),
    )

    assert response.status_code == 200
    assert len(response.json()["comments"]) == 1
    assert len(fake_social_comments_store) == 0


def test_sync_stops_at_the_max_page_safety_cap(
    client, service_jwt_settings, monkeypatch, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store, fake_social_comments_store
):
    """A page that always reports has_more=True must not loop forever."""
    from core.config import settings

    monkeypatch.setattr(settings, "comments_sync_max_pages_per_post", 3)
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)

    call_count = {"n": 0}

    def _responder(request):
        call_count["n"] += 1
        return httpx.Response(
            200,
            json={
                "data": [{"id": f"c{call_count['n']}", "message": "x", "from": {"id": "u", "name": "A"}, "created_time": "2026-01-01T10:00:00+0000"}],
                "paging": {"cursors": {"after": f"cursor-{call_count['n']}"}, "next": "..."},
            },
        )

    respx_mock.get(f"{META_BASE_URL}/post-1/comments").mock(side_effect=_responder)

    response = _sync(client)

    assert response.status_code == 200
    assert call_count["n"] == 3
    assert len(fake_social_comments_store) == 3

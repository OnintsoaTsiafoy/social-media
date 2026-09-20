"""Characterization tests for /facebook/posts* and stats/analytics/insights.

These pin the CURRENT behavior of the existing routes, including the known
bugs tracked by Sprint 05 (see sprint_listing/SPRINT_05_...md and
sprint_listing/01_AUDIT_GRAPH_API_EXISTANT.md). Tests marked "BUG:" assert the
*current*, broken behavior on purpose and are expected to flip once the
matching Day-2/Day-4 fix lands.
"""
import httpx
import pytest

from tests.conftest import META_BASE_URL, PAGE_ID


@pytest.fixture
def client(authenticated_client):
    """`/facebook/*` exige un JWT de service depuis qu'elles ont ete fermees ;
    le refus sans jeton est teste dans tests/test_facebook_auth.py."""
    return authenticated_client


def test_list_posts_maps_reactions_comments_shares(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/posts").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "1_1",
                        "message": "Hello",
                        "created_time": "2026-01-01T10:00:00+0000",
                        "permalink_url": "https://facebook.com/1_1",
                        "full_picture": "https://example.com/pic.jpg",
                        "from": {"id": "999", "name": "Alice"},
                        "shares": {"count": 3},
                        "reactions_like": {"summary": {"total_count": 5}},
                        "reactions_love": {"summary": {"total_count": 2}},
                        "reactions_wow": {"summary": {"total_count": 0}},
                        "reactions_haha": {"summary": {"total_count": 0}},
                        "reactions_sad": {"summary": {"total_count": 0}},
                        "reactions_angry": {"summary": {"total_count": 0}},
                        "comments_summary": {"summary": {"total_count": 4}},
                    }
                ]
            },
        )
    )

    response = client.get("/facebook/posts")

    assert response.status_code == 200
    body = response.json()["data"]
    assert len(body) == 1
    assert body[0]["reactions"]["total"] == 7
    assert body[0]["comments_count"] == 4
    assert body[0]["shares_count"] == 3
    assert body[0]["from"]["name"] == "Alice"


def test_list_posts_returns_cursors_and_has_next_page(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/posts").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [{"id": "1_1", "from": {"id": "u1", "name": "Alice"}}],
                "paging": {
                    "cursors": {"before": "cursor-before", "after": "cursor-after"},
                    "next": "https://graph.facebook.com/v25.0/next-page",
                },
            },
        )
    )

    response = client.get("/facebook/posts", params={"limit": 1})

    assert response.status_code == 200
    body = response.json()
    assert body["paging"]["cursors"]["after"] == "cursor-after"
    assert body["paging"]["has_next_page"] is True
    assert body["paging"]["has_previous_page"] is False


def test_list_posts_second_page_via_after_cursor_reaches_the_end(client, respx_mock):
    route = respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/posts").mock(
        return_value=httpx.Response(200, json={"data": [], "paging": {}})
    )

    response = client.get("/facebook/posts", params={"limit": 1, "after": "cursor-after"})

    assert response.status_code == 200
    body = response.json()
    assert body["data"] == []
    assert body["paging"]["has_next_page"] is False
    assert route.calls.last.request.url.params["after"] == "cursor-after"


def test_list_posts_rejects_invalid_since_and_until(client, respx_mock):
    """Fixed Sprint 05 Day 2: since/until are validated locally before any Meta call."""
    route = respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/posts").mock(
        return_value=httpx.Response(200, json={"data": []})
    )

    response = client.get("/facebook/posts", params={"since": "not-a-date", "until": "2026-13-99"})

    assert response.status_code == 400
    assert not route.called


def test_list_posts_accepts_unix_timestamp_or_iso_date(client, respx_mock):
    route = respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/posts").mock(
        return_value=httpx.Response(200, json={"data": []})
    )

    response = client.get("/facebook/posts", params={"since": "2026-01-01", "until": "1780000000"})

    assert response.status_code == 200
    sent_params = route.calls.last.request.url.params
    assert sent_params["since"] == "2026-01-01"
    assert sent_params["until"] == "1780000000"


def test_create_post_text_only(client, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/{PAGE_ID}/feed").mock(
        return_value=httpx.Response(200, json={"id": "1_2"})
    )

    response = client.post("/facebook/posts", data={"message": "Texte seul"})

    assert response.status_code == 201
    assert response.json() == {"id": "1_2"}


def test_create_post_requires_message_or_file(client, respx_mock):
    response = client.post("/facebook/posts", data={})

    assert response.status_code == 400


def test_create_post_single_image(client, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/{PAGE_ID}/photos").mock(
        return_value=httpx.Response(200, json={"id": "1_3", "post_id": "1_3"})
    )

    response = client.post(
        "/facebook/posts",
        data={"message": "Une image"},
        files=[("files", ("photo.jpg", b"fake-bytes", "image/jpeg"))],
    )

    assert response.status_code == 201
    assert response.json() == {"id": "1_3"}


def test_create_post_multi_image(client, respx_mock):
    upload_route = respx_mock.post(f"{META_BASE_URL}/{PAGE_ID}/photos").mock(
        side_effect=[
            httpx.Response(200, json={"id": "photo-1"}),
            httpx.Response(200, json={"id": "photo-2"}),
        ]
    )
    feed_route = respx_mock.post(f"{META_BASE_URL}/{PAGE_ID}/feed").mock(
        return_value=httpx.Response(200, json={"id": "1_4"})
    )

    response = client.post(
        "/facebook/posts",
        data={"message": "Galerie"},
        files=[
            ("files", ("a.jpg", b"fake-a", "image/jpeg")),
            ("files", ("b.jpg", b"fake-b", "image/jpeg")),
        ],
    )

    assert response.status_code == 201
    assert response.json() == {"id": "1_4"}
    assert upload_route.call_count == 2
    assert feed_route.called


def test_create_post_video(client, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/{PAGE_ID}/videos").mock(
        return_value=httpx.Response(200, json={"id": "1_5"})
    )

    response = client.post(
        "/facebook/posts",
        data={"message": "Une vidéo"},
        files=[("files", ("clip.mp4", b"fake-video", "video/mp4"))],
    )

    assert response.status_code == 201
    assert response.json() == {"id": "1_5"}


def test_create_post_rejects_mixed_image_and_video(client, respx_mock):
    response = client.post(
        "/facebook/posts",
        files=[
            ("files", ("a.jpg", b"fake-a", "image/jpeg")),
            ("files", ("b.mp4", b"fake-b", "video/mp4")),
        ],
    )

    assert response.status_code == 400


def test_edit_post_updates_message(client, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/1_1").mock(
        return_value=httpx.Response(200, json={"success": True})
    )

    response = client.put("/facebook/posts/1_1", json={"message": "Nouveau message"})

    assert response.status_code == 200
    assert response.json() == {"success": True}


def test_edit_post_rejects_empty_message(client, respx_mock):
    response = client.put("/facebook/posts/1_1", json={"message": "   "})

    assert response.status_code == 400


def test_delete_post_success(client, respx_mock):
    respx_mock.delete(f"{META_BASE_URL}/1_1").mock(
        return_value=httpx.Response(200, json={"success": True})
    )

    response = client.delete("/facebook/posts/1_1")

    assert response.status_code == 200
    assert response.json() == {"success": True}


def test_delete_post_retries_with_suffix_after_underscore(client, respx_mock):
    respx_mock.delete(f"{META_BASE_URL}/1_999").mock(
        return_value=httpx.Response(
            400, json={"error": {"message": "Unsupported delete", "code": 100}}
        )
    )
    respx_mock.delete(f"{META_BASE_URL}/999").mock(
        return_value=httpx.Response(200, json={"success": True})
    )

    response = client.delete("/facebook/posts/1_999")

    assert response.status_code == 200
    assert response.json() == {"success": True}


def test_delete_post_reports_facebook_error_as_400(client, respx_mock):
    respx_mock.delete(f"{META_BASE_URL}/999888777").mock(
        return_value=httpx.Response(
            403, json={"error": {"message": "Permissions manquantes", "code": 200}}
        )
    )

    response = client.delete("/facebook/posts/999888777")

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "validation_failed"
    assert "Permissions manquantes" in body["error"]["message"]


def test_get_post_stats(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/1_1").mock(
        return_value=httpx.Response(
            200,
            json={
                "reactions_like": {"summary": {"total_count": 10}},
                "reactions_love": {"summary": {"total_count": 1}},
                "reactions_wow": {"summary": {"total_count": 0}},
                "reactions_haha": {"summary": {"total_count": 0}},
                "reactions_sad": {"summary": {"total_count": 0}},
                "reactions_angry": {"summary": {"total_count": 0}},
                "comments": {"summary": {"total_count": 6}},
                "shares": {"count": 2},
            },
        )
    )

    response = client.get("/facebook/posts/1_1/stats")

    assert response.status_code == 200
    body = response.json()
    assert body["reactions"]["total"] == 11
    assert body["comments"] == 6
    assert body["shares"] == 2


def test_community_managers_stats_aggregates_by_author(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/posts").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "1_1",
                        "created_time": "2026-01-01T10:00:00+0000",
                        "from": {"id": "u1", "name": "Alice"},
                        "reactions_like": {"summary": {"total_count": 5}},
                        "reactions_love": {"summary": {"total_count": 0}},
                        "reactions_wow": {"summary": {"total_count": 0}},
                        "reactions_haha": {"summary": {"total_count": 0}},
                        "reactions_sad": {"summary": {"total_count": 0}},
                        "reactions_angry": {"summary": {"total_count": 0}},
                        "comments_summary": {"summary": {"total_count": 1}},
                    },
                    {
                        "id": "1_2",
                        "created_time": "2026-01-02T10:00:00+0000",
                        "from": {"id": "u2", "name": "Bob"},
                        "reactions_like": {"summary": {"total_count": 1}},
                        "reactions_love": {"summary": {"total_count": 0}},
                        "reactions_wow": {"summary": {"total_count": 0}},
                        "reactions_haha": {"summary": {"total_count": 0}},
                        "reactions_sad": {"summary": {"total_count": 0}},
                        "reactions_angry": {"summary": {"total_count": 0}},
                        "comments_summary": {"summary": {"total_count": 0}},
                    },
                ]
            },
        )
    )

    response = client.get("/facebook/community-managers/stats")

    assert response.status_code == 200
    body = response.json()
    assert body["total_posts"] == 2
    assert body["total_reactions"] == 6
    assert body["items"][0]["author_name"] == "Alice"


def test_post_analytics_maps_message_media_and_insights(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/1_1").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": "Un post",
                "created_time": "2026-01-01T10:00:00+0000",
                "reactions": {"summary": {"total_count": 3}},
                "comments": {"summary": {"total_count": 1}},
                "shares": {"count": 0},
                "attachments": {
                    "data": [
                        {"media_type": "photo", "media": {"image": {"src": "https://x/1.jpg"}}}
                    ]
                },
            },
        )
    )
    respx_mock.get(f"{META_BASE_URL}/1_1/insights").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {"name": "post_impressions", "values": [{"value": 100}]},
                    {"name": "post_impressions_unique", "values": [{"value": 80}]},
                    {"name": "post_clicks", "values": [{"value": 5}]},
                ]
            },
        )
    )

    response = client.get("/facebook/posts/1_1/analytics")

    assert response.status_code == 200
    body = response.json()
    assert body["date"] == "2026-01-01"
    assert body["reactions_total"] == 3
    assert body["impressions"] == 100
    assert body["reach"] == 80
    assert body["clicks"] == 5
    assert len(body["media"]) == 1


def test_post_analytics_missing_created_time_is_null_not_a_crash(client, respx_mock):
    """Fixed Sprint 05 Day 2: an absent created_time yields date=None/time=None
    instead of raising ValueError."""
    respx_mock.get(f"{META_BASE_URL}/1_1").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": "Sans date",
                "reactions": {"summary": {"total_count": 0}},
                "comments": {"summary": {"total_count": 0}},
                "shares": {"count": 0},
                "attachments": {"data": []},
            },
        )
    )
    respx_mock.get(f"{META_BASE_URL}/1_1/insights").mock(
        return_value=httpx.Response(200, json={"data": []})
    )

    response = client.get("/facebook/posts/1_1/analytics")

    assert response.status_code == 200
    body = response.json()
    assert body["date"] is None
    assert body["time"] is None


def test_post_analytics_insights_failure_is_null_not_a_false_zero(client, respx_mock):
    """Fixed Sprint 05 Day 4: an insights failure now surfaces as null
    ("indisponible"), distinguishable from a genuine zero metric."""
    respx_mock.get(f"{META_BASE_URL}/1_1").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": "Post",
                "created_time": "2026-01-01T10:00:00+0000",
                "reactions": {"summary": {"total_count": 0}},
                "comments": {"summary": {"total_count": 0}},
                "shares": {"count": 0},
                "attachments": {"data": []},
            },
        )
    )
    respx_mock.get(f"{META_BASE_URL}/1_1/insights").mock(
        return_value=httpx.Response(
            400, json={"error": {"message": "Missing permission", "code": 10}}
        )
    )

    response = client.get("/facebook/posts/1_1/analytics")

    assert response.status_code == 200
    body = response.json()
    assert body["impressions"] is None
    assert body["reach"] is None
    assert body["clicks"] is None


def test_post_analytics_insights_success_with_zero_metric_stays_zero(client, respx_mock):
    """A successful insights call that genuinely reports 0 must stay 0, not null."""
    respx_mock.get(f"{META_BASE_URL}/1_1").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": "Post",
                "created_time": "2026-01-01T10:00:00+0000",
                "reactions": {"summary": {"total_count": 0}},
                "comments": {"summary": {"total_count": 0}},
                "shares": {"count": 0},
                "attachments": {"data": []},
            },
        )
    )
    respx_mock.get(f"{META_BASE_URL}/1_1/insights").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {"name": "post_impressions", "values": [{"value": 0}]},
                ]
            },
        )
    )

    response = client.get("/facebook/posts/1_1/analytics")

    assert response.status_code == 200
    body = response.json()
    assert body["impressions"] == 0
    assert body["reach"] == 0
    assert body["clicks"] == 0


def test_post_analytics_requests_and_maps_subattachments(client, respx_mock):
    """Fixed Sprint 05 Day 2: subattachments are requested, so album/multi-photo
    posts now surface every extra media item."""
    route = respx_mock.get(f"{META_BASE_URL}/1_1").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": "Album",
                "created_time": "2026-01-01T10:00:00+0000",
                "reactions": {"summary": {"total_count": 0}},
                "comments": {"summary": {"total_count": 0}},
                "shares": {"count": 0},
                "attachments": {
                    "data": [
                        {
                            "media_type": "album",
                            "media": {},
                            "subattachments": {
                                "data": [
                                    {
                                        "media_type": "photo",
                                        "media": {"image": {"src": "https://x/1.jpg"}},
                                    },
                                    {
                                        "media_type": "photo",
                                        "media": {"image": {"src": "https://x/2.jpg"}},
                                    },
                                ]
                            },
                        }
                    ]
                },
            },
        )
    )
    respx_mock.get(f"{META_BASE_URL}/1_1/insights").mock(
        return_value=httpx.Response(200, json={"data": []})
    )

    response = client.get("/facebook/posts/1_1/analytics")

    assert response.status_code == 200
    sent_fields = route.calls.last.request.url.params["fields"]
    assert "subattachments" in sent_fields
    body = response.json()
    assert len(body["media"]) == 2
    assert {item["url"] for item in body["media"]} == {"https://x/1.jpg", "https://x/2.jpg"}


def test_post_insights_combines_stats_and_analytics(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/1_1").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": "Post",
                "created_time": "2026-01-01T10:00:00+0000",
                "reactions": {"summary": {"total_count": 2}},
                "reactions_like": {"summary": {"total_count": 2}},
                "reactions_love": {"summary": {"total_count": 0}},
                "reactions_wow": {"summary": {"total_count": 0}},
                "reactions_haha": {"summary": {"total_count": 0}},
                "reactions_sad": {"summary": {"total_count": 0}},
                "reactions_angry": {"summary": {"total_count": 0}},
                "comments": {"summary": {"total_count": 1}},
                "shares": {"count": 0},
                "attachments": {"data": []},
            },
        )
    )
    respx_mock.get(f"{META_BASE_URL}/1_1/insights").mock(
        return_value=httpx.Response(200, json={"data": []})
    )

    response = client.get("/facebook/posts/1_1/insights")

    assert response.status_code == 200
    body = response.json()
    assert body["stats"]["reactions"]["total"] == 2
    assert body["analytics"]["reactions_total"] == 2

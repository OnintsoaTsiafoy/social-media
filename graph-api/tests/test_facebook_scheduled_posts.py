"""Characterization tests for /facebook/scheduled-posts*.

Includes the confirmed critical bug (Sprint 05 Day 2): editing a scheduled
post while attaching media crashes with a TypeError because
``_process_scheduled_post_media`` calls ``facebook_client.post_form(...,
files=...)``, and ``post_form`` has no ``files`` parameter.
"""
import time

import httpx
import pytest

from tests.conftest import META_BASE_URL, PAGE_ID


@pytest.fixture
def client(authenticated_client):
    """`/facebook/*` exige un JWT de service depuis qu'elles ont ete fermees ;
    le refus sans jeton est teste dans tests/test_facebook_auth.py."""
    return authenticated_client


def _future_timestamp(seconds_ahead: int = 3600) -> str:
    return str(int(time.time()) + seconds_ahead)


def test_create_scheduled_post_text_only(client, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/{PAGE_ID}/feed").mock(
        return_value=httpx.Response(200, json={"id": "2_1"})
    )

    response = client.post(
        "/facebook/scheduled-posts",
        data={"message": "Plus tard", "scheduled_publish_time": _future_timestamp()},
    )

    assert response.status_code == 201
    assert response.json() == {"id": "2_1"}


def test_create_scheduled_post_rejects_time_too_close(client, respx_mock):
    response = client.post(
        "/facebook/scheduled-posts",
        data={"message": "Trop tôt", "scheduled_publish_time": _future_timestamp(60)},
    )

    assert response.status_code == 400


def test_create_scheduled_post_with_image(client, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/{PAGE_ID}/photos").mock(
        return_value=httpx.Response(200, json={"id": "2_2"})
    )

    response = client.post(
        "/facebook/scheduled-posts",
        data={"scheduled_publish_time": _future_timestamp()},
        files=[("files", ("photo.jpg", b"fake-bytes", "image/jpeg"))],
    )

    assert response.status_code == 201
    assert response.json() == {"id": "2_2"}


def test_list_scheduled_posts_sorted_by_time(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/scheduled_posts").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {"id": "2_2", "scheduled_publish_time": 2000, "is_published": False},
                    {"id": "2_1", "scheduled_publish_time": 1000, "is_published": False},
                ]
            },
        )
    )

    response = client.get("/facebook/scheduled-posts")

    assert response.status_code == 200
    body = response.json()["data"]
    assert [item["id"] for item in body] == ["2_1", "2_2"]


def test_list_scheduled_posts_paginates_and_reports_has_next_page(client, respx_mock):
    """Fixed Sprint 05 Day 3: a caller can page through scheduled posts explicitly
    via limit/after instead of always fetching a single, silently-truncated page."""
    route = respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/scheduled_posts").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [],
                "paging": {
                    "cursors": {"after": "sched-cursor"},
                    "next": "https://graph.facebook.com/v25.0/next-page-would-be-here",
                },
            },
        )
    )

    response = client.get("/facebook/scheduled-posts", params={"limit": 5})

    assert response.status_code == 200
    assert route.calls.last.request.url.params["limit"] == "5"
    body = response.json()
    assert body["paging"]["has_next_page"] is True
    assert body["paging"]["cursors"]["after"] == "sched-cursor"


def test_update_scheduled_post_message_only(client, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/2_1").mock(
        return_value=httpx.Response(200, json={"id": "2_1", "success": True})
    )

    response = client.put(
        "/facebook/scheduled-posts/2_1",
        data={"message": "Message modifié"},
    )

    assert response.status_code == 200
    assert response.json() == {"id": "2_1"}


def test_update_scheduled_post_date_only(client, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/2_1").mock(
        return_value=httpx.Response(200, json={"id": "2_1", "success": True})
    )

    response = client.put(
        "/facebook/scheduled-posts/2_1",
        data={"scheduled_publish_time": _future_timestamp()},
    )

    assert response.status_code == 200


def test_update_scheduled_post_requires_a_change(client, respx_mock):
    response = client.put("/facebook/scheduled-posts/2_1", data={})

    assert response.status_code == 400


def test_update_scheduled_post_with_image_now_succeeds(client, respx_mock):
    """Fixed Sprint 05 Day 2 (the sprint's headline defect): the media-attach
    helper now calls ``post_multipart`` (which accepts ``files=``) instead of
    ``post_form`` (which does not), so attaching media to a scheduled-post
    edit no longer crashes.
    """
    respx_mock.post(f"{META_BASE_URL}/2_1/photos").mock(
        return_value=httpx.Response(200, json={"id": "photo-99"})
    )
    respx_mock.post(f"{META_BASE_URL}/2_1").mock(
        return_value=httpx.Response(200, json={"id": "2_1"})
    )

    response = client.put(
        "/facebook/scheduled-posts/2_1",
        data={"message": "Avec photo"},
        files=[("files", ("photo.jpg", b"fake-bytes", "image/jpeg"))],
    )

    assert response.status_code == 200
    assert response.json() == {"id": "2_1"}


def test_update_scheduled_post_with_video_now_succeeds(client, respx_mock):
    """Fixed Sprint 05 Day 2: same fix, video branch."""
    respx_mock.post(f"{META_BASE_URL}/2_1/videos").mock(
        return_value=httpx.Response(200, json={"id": "video-99"})
    )
    respx_mock.post(f"{META_BASE_URL}/2_1").mock(
        return_value=httpx.Response(200, json={"id": "2_1"})
    )

    response = client.put(
        "/facebook/scheduled-posts/2_1",
        data={"message": "Avec vidéo"},
        files=[("files", ("clip.mp4", b"fake-bytes", "video/mp4"))],
    )

    assert response.status_code == 200
    assert response.json() == {"id": "2_1"}


def test_delete_scheduled_post(client, respx_mock):
    respx_mock.delete(f"{META_BASE_URL}/2_1").mock(
        return_value=httpx.Response(200, json={"success": True})
    )

    response = client.delete("/facebook/scheduled-posts/2_1")

    assert response.status_code == 200
    assert response.json() == {"success": True}

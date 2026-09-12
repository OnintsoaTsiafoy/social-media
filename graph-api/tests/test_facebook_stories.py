"""Characterization tests for /facebook/stories*."""
import httpx

from tests.conftest import META_BASE_URL, PAGE_ID


def test_create_story_image(client, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/{PAGE_ID}/photo_stories").mock(
        return_value=httpx.Response(200, json={"id": "3_1", "success": True})
    )

    response = client.post(
        "/facebook/stories",
        data={"message": "Story du jour"},
        files={"file": ("story.jpg", b"fake-bytes", "image/jpeg")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["id"] == "3_1"
    assert body["success"] is True


def test_create_story_video(client, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/{PAGE_ID}/video_stories").mock(
        return_value=httpx.Response(200, json={"id": "3_2", "success": True})
    )

    response = client.post(
        "/facebook/stories",
        files={"file": ("story.mp4", b"fake-bytes", "video/mp4")},
    )

    assert response.status_code == 201
    assert response.json()["id"] == "3_2"


def test_create_story_rejects_unsupported_type(client, respx_mock):
    response = client.post(
        "/facebook/stories",
        files={"file": ("doc.pdf", b"fake-bytes", "application/pdf")},
    )

    assert response.status_code == 400


def test_create_story_rejects_empty_file(client, respx_mock):
    response = client.post(
        "/facebook/stories",
        files={"file": ("story.jpg", b"", "image/jpeg")},
    )

    assert response.status_code == 400


def test_create_story_missing_capability_is_reported_as_400(client, respx_mock):
    """The service deliberately re-wraps a Meta 5xx as a 400 with a French hint
    about the Stories capability/permission (stories_service.py)."""
    respx_mock.post(f"{META_BASE_URL}/{PAGE_ID}/photo_stories").mock(
        return_value=httpx.Response(500, json={"error": {"message": "Internal error", "code": 1}})
    )

    response = client.post(
        "/facebook/stories",
        files={"file": ("story.jpg", b"fake-bytes", "image/jpeg")},
    )

    assert response.status_code == 400


def test_list_stories(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/stories").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "3_1",
                        "created_time": "2026-01-01T10:00:00+0000",
                        "permalink_url": "https://facebook.com/stories/3_1",
                        "status": "PUBLISHED",
                    }
                ]
            },
        )
    )

    response = client.get("/facebook/stories")

    assert response.status_code == 200
    assert response.json()["data"][0]["id"] == "3_1"


def test_delete_story(client, respx_mock):
    respx_mock.delete(f"{META_BASE_URL}/3_1").mock(
        return_value=httpx.Response(200, json={"success": True})
    )

    response = client.delete("/facebook/stories/3_1")

    assert response.status_code == 200
    assert response.json() == {"success": True}

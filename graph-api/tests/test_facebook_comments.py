"""Characterization tests for /facebook/posts/{id}/comments, /comments/{id}/replies
and /comments/{id}/reply.
"""
import httpx
import pytest

from tests.conftest import META_BASE_URL


@pytest.fixture
def client(authenticated_client):
    """`/facebook/*` exige un JWT de service depuis qu'elles ont ete fermees ;
    le refus sans jeton est teste dans tests/test_facebook_auth.py."""
    return authenticated_client


def test_list_post_comments_includes_one_level_of_nested_replies(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/1_1/comments").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "c1",
                        "message": "Bel article",
                        "from": {"id": "u1", "name": "Alice"},
                        "created_time": "2026-01-01T10:00:00+0000",
                        "like_count": 2,
                        "comment_count": 1,
                        "comments": {
                            "data": [
                                {
                                    "id": "c1r1",
                                    "message": "Merci !",
                                    "from": {"id": "page", "name": "Ma Page"},
                                    "created_time": "2026-01-01T11:00:00+0000",
                                }
                            ]
                        },
                    }
                ]
            },
        )
    )

    response = client.get("/facebook/posts/1_1/comments")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body[0]["id"] == "c1"
    assert body[0]["comments"]["data"][0]["id"] == "c1r1"


def test_list_post_comments_paginates_with_limit_and_after(client, respx_mock):
    """Fixed Sprint 05 Day 3: limit/after/before are accepted and forwarded to Meta,
    and the response carries cursors."""
    route = respx_mock.get(f"{META_BASE_URL}/1_1/comments").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [],
                "paging": {"cursors": {"after": "cmt-cursor"}, "next": "https://x/next"},
            },
        )
    )

    response = client.get("/facebook/posts/1_1/comments", params={"limit": 10, "after": "prev-cursor"})

    assert response.status_code == 200
    assert route.calls.last.request.url.params["limit"] == "10"
    assert route.calls.last.request.url.params["after"] == "prev-cursor"
    body = response.json()
    assert body["paging"]["cursors"]["after"] == "cmt-cursor"
    assert body["paging"]["has_next_page"] is True


def test_list_comment_replies(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/c1/comments").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "c1r1",
                        "message": "Merci !",
                        "from": {"id": "page", "name": "Ma Page"},
                        "created_time": "2026-01-01T11:00:00+0000",
                    }
                ]
            },
        )
    )

    response = client.get("/facebook/comments/c1/replies")

    assert response.status_code == 200
    assert response.json()["data"][0]["id"] == "c1r1"


def test_reply_to_comment(client, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/c1/comments").mock(
        return_value=httpx.Response(200, json={"id": "c1r2"})
    )

    response = client.post("/facebook/comments/c1/reply", json={"message": "Merci pour votre retour"})

    assert response.status_code == 201
    assert response.json() == {"id": "c1r2"}


def test_reply_to_comment_requires_message(client, respx_mock):
    response = client.post("/facebook/comments/c1/reply", json={})

    assert response.status_code == 422


def test_reply_to_comment_propagates_facebook_error(client, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/c1/comments").mock(
        return_value=httpx.Response(
            400, json={"error": {"message": "Commentaire introuvable", "code": 100}}
        )
    )

    response = client.post("/facebook/comments/c1/reply", json={"message": "Merci"})

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "validation_failed"
    assert "Commentaire introuvable" in body["error"]["message"]

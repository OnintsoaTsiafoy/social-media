"""Sprint 05 Day 5: /internal/v1 is protected by a service JWT (audience
social-service, type=service), separate from any mobile/user token.

These tests all omit socialAccountId (null), which exercises the Sprint 05
legacy fallback path (the single globally-configured Facebook Page) —
per-account resolution via a real social_accounts row is covered separately
in test_internal_routes_per_account.py (Sprint 07).
"""
import httpx

from tests.conftest import META_BASE_URL, make_service_jwt

PUBLISH_BODY = {
    "publicationId": "pub-1",
    "targets": [
        {
            "publicationTargetId": "target-1",
            "socialAccountId": None,
            "provider": "facebook",
            "content": "Bonjour tout le monde",
            "mediaUrls": [],
        }
    ],
}


def _auth_header(**kwargs) -> dict:
    return {"Authorization": f"Bearer {make_service_jwt(**kwargs)}"}


# --- Authentication / authorization -----------------------------------------


def test_publish_without_authorization_header_is_rejected(client, service_jwt_settings, respx_mock):
    response = client.post(
        "/internal/v1/publications/publish",
        json=PUBLISH_BODY,
        headers={"Idempotency-Key": "idem-1"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_publish_with_garbage_token_is_rejected(client, service_jwt_settings, respx_mock):
    response = client.post(
        "/internal/v1/publications/publish",
        json=PUBLISH_BODY,
        headers={"Idempotency-Key": "idem-1", "Authorization": "Bearer not-a-jwt"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_publish_with_expired_token_is_rejected(client, service_jwt_settings, respx_mock):
    response = client.post(
        "/internal/v1/publications/publish",
        json=PUBLISH_BODY,
        headers={"Idempotency-Key": "idem-1", **_auth_header(exp_delta=-10)},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "token_expired"


def test_publish_with_a_user_type_token_is_rejected(client, service_jwt_settings, respx_mock):
    """A mobile/user JWT must never be accepted here, even if correctly signed."""
    response = client.post(
        "/internal/v1/publications/publish",
        json=PUBLISH_BODY,
        headers={"Idempotency-Key": "idem-1", **_auth_header(token_type="access")},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_publish_with_wrong_audience_is_rejected(client, service_jwt_settings, respx_mock):
    response = client.post(
        "/internal/v1/publications/publish",
        json=PUBLISH_BODY,
        headers={"Idempotency-Key": "idem-1", **_auth_header(audience="ai-service")},
    )

    assert response.status_code == 401


def test_publish_without_write_scope_is_forbidden(client, service_jwt_settings, respx_mock):
    response = client.post(
        "/internal/v1/publications/publish",
        json=PUBLISH_BODY,
        headers={"Idempotency-Key": "idem-1", **_auth_header(scope=["social:read"])},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_internal_route_503_when_service_jwt_not_configured(client, respx_mock):
    """service_jwt_settings fixture NOT used: secret is unset, so every call
    must fail closed rather than silently accept anything."""
    response = client.post(
        "/internal/v1/publications/publish",
        json=PUBLISH_BODY,
        headers={"Idempotency-Key": "idem-1", **_auth_header()},
    )

    assert response.status_code == 503


# --- Nominal scenarios --------------------------------------------------------


def test_publish_text_only_nominal(client, service_jwt_settings, respx_mock):
    respx_mock.post(f"{META_BASE_URL}/123456789/feed").mock(
        return_value=httpx.Response(200, json={"id": "1_100"})
    )

    response = client.post(
        "/internal/v1/publications/publish",
        json=PUBLISH_BODY,
        headers={"Idempotency-Key": "idem-1", **_auth_header()},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["publicationId"] == "pub-1"
    assert body["results"][0]["status"] == "SUCCESS"
    assert body["results"][0]["externalPublicationId"] == "1_100"


def test_publish_reports_unsupported_provider_per_target(client, service_jwt_settings, respx_mock):
    body = {
        "publicationId": "pub-2",
        "targets": [
            {
                "publicationTargetId": "t1",
                "socialAccountId": None,
                "provider": "twitter",
                "content": "Hello",
                "mediaUrls": [],
            }
        ],
    }

    response = client.post(
        "/internal/v1/publications/publish",
        json=body,
        headers={"Idempotency-Key": "idem-2", **_auth_header()},
    )

    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["status"] == "FAILED"
    assert result["errorCode"] == "unprocessable"


def test_publish_requires_idempotency_key(client, service_jwt_settings, respx_mock):
    response = client.post(
        "/internal/v1/publications/publish", json=PUBLISH_BODY, headers=_auth_header()
    )

    assert response.status_code == 400


def test_publish_same_idempotency_key_is_not_sent_twice(client, service_jwt_settings, respx_mock):
    """Mandatory double-submission test: a retried request with the same
    Idempotency-Key must not call Meta again."""
    route = respx_mock.post(f"{META_BASE_URL}/123456789/feed").mock(
        return_value=httpx.Response(200, json={"id": "1_200"})
    )
    headers = {"Idempotency-Key": "idem-3", **_auth_header()}

    first = client.post("/internal/v1/publications/publish", json=PUBLISH_BODY, headers=headers)
    second = client.post("/internal/v1/publications/publish", json=PUBLISH_BODY, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert route.call_count == 1


def test_comments_sync_nominal(client, service_jwt_settings, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/1_1/comments").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "c1",
                        "message": "Bonjour",
                        "from": {"id": "u1", "name": "Alice"},
                        "created_time": "2026-01-01T10:00:00+0000",
                    }
                ]
            },
        )
    )

    response = client.post(
        "/internal/v1/comments/sync",
        json={
            "socialAccountId": None,
            "provider": "facebook",
            "publicationExternalIds": ["1_1"],
            "limit": 100,
        },
        headers=_auth_header(scope=["social:read"]),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["comments"][0]["externalCommentId"] == "c1"
    assert body["comments"][0]["authorName"] == "Alice"


# comments/reply has no legacy no-socialAccountId path (unlike publish/sync
# above): Sprint 08 Day 5 rewrote it to key off Hootly's own comment id, which
# only ever exists once a real social_accounts-linked comment has been
# synced — see test_internal_routes_per_account.py's reply tests for the
# real (and only) contract, including the idempotency-key requirement below.


def test_comments_reply_requires_idempotency_key(client, service_jwt_settings, respx_mock):
    response = client.post(
        "/internal/v1/comments/reply",
        json={"commentId": "does-not-matter", "userId": "user-1", "text": "Merci !"},
        headers=_auth_header(),
    )

    assert response.status_code == 400


def test_metrics_sync_nominal_with_null_for_unavailable(client, service_jwt_settings, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/1_1").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": "Post",
                "created_time": "2026-01-01T10:00:00+0000",
                "reactions": {"summary": {"total_count": 5}},
                "comments": {"summary": {"total_count": 2}},
                "shares": {"count": 1},
                "attachments": {"data": []},
            },
        )
    )
    respx_mock.get(f"{META_BASE_URL}/1_1/insights").mock(
        return_value=httpx.Response(400, json={"error": {"message": "no permission", "code": 10}})
    )

    response = client.post(
        "/internal/v1/metrics/sync",
        json={
            "socialAccountId": None,
            "provider": "facebook",
            "publicationExternalIds": ["1_1"],
            "from": "2026-01-01",
            "to": "2026-01-31",
        },
        headers=_auth_header(scope=["social:read"]),
    )

    assert response.status_code == 200
    metric = response.json()["metrics"][0]
    assert metric["reactions"] == 5
    assert metric["impressions"] is None

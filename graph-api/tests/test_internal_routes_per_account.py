"""Sprint 07: /internal/v1 resolves a real social_accounts row + decrypted
token instead of always using the Sprint 05 global Facebook client, and
dispatches to the matching SocialProvider (Facebook or Instagram).
"""
import httpx

from tests.conftest import META_BASE_URL, make_service_jwt

FACEBOOK_ACCOUNT_ID = "fb-account-1"
INSTAGRAM_ACCOUNT_ID = "ig-account-1"


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
    }
    fake_oauth_tokens_store[FACEBOOK_ACCOUNT_ID] = {"access_token": "page-42-token"}


def _seed_instagram_account(fake_social_accounts_store, fake_oauth_tokens_store, auth_method="FACEBOOK_PAGE"):
    fake_social_accounts_store[("INSTAGRAM", "ig-99")] = {
        "id": INSTAGRAM_ACCOUNT_ID,
        "brand_id": "brand-1",
        "provider": "INSTAGRAM",
        "external_account_id": "ig-99",
        "name": "Studio Vega",
        "auth_method": auth_method,
        "status": "CONNECTED",
    }
    fake_oauth_tokens_store[INSTAGRAM_ACCOUNT_ID] = {"access_token": "ig-99-token"}


# --- Resolution edge cases ----------------------------------------------------


def test_publish_unknown_social_account_is_404(client, service_jwt_settings, respx_mock):
    body = {
        "publicationId": "pub-1",
        "targets": [
            {
                "publicationTargetId": "t1",
                "socialAccountId": "does-not-exist",
                "provider": "facebook",
                "content": "Hello",
                "mediaUrls": [],
            }
        ],
    }

    response = client.post(
        "/internal/v1/publications/publish",
        json=body,
        headers={"Idempotency-Key": "idem-404", **_auth_header()},
    )

    assert response.status_code == 200  # per-target failure, not a route-level error
    assert response.json()["results"][0]["errorCode"] == "not_found"


def test_publish_account_without_active_token_is_token_expired(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    del fake_oauth_tokens_store[FACEBOOK_ACCOUNT_ID]

    body = {
        "publicationId": "pub-2",
        "targets": [
            {
                "publicationTargetId": "t1",
                "socialAccountId": FACEBOOK_ACCOUNT_ID,
                "provider": "facebook",
                "content": "Hello",
                "mediaUrls": [],
            }
        ],
    }

    response = client.post(
        "/internal/v1/publications/publish",
        json=body,
        headers={"Idempotency-Key": "idem-expired", **_auth_header()},
    )

    assert response.json()["results"][0]["errorCode"] == "TOKEN_EXPIRED"


def test_publish_provider_mismatch_is_rejected(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)

    body = {
        "publicationId": "pub-3",
        "targets": [
            {
                "publicationTargetId": "t1",
                "socialAccountId": FACEBOOK_ACCOUNT_ID,
                "provider": "instagram",  # account is actually FACEBOOK
                "content": "Hello",
                "mediaUrls": [],
            }
        ],
    }

    response = client.post(
        "/internal/v1/publications/publish",
        json=body,
        headers={"Idempotency-Key": "idem-mismatch", **_auth_header()},
    )

    assert response.json()["results"][0]["errorCode"] == "unprocessable"


# --- Facebook, resolved per-account (not the global client) ------------------


def test_publish_facebook_uses_the_resolved_account_token_not_the_global_one(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    # Page id differs from the global-settings PAGE_ID (123456789) fixture on
    # purpose — proves resolution, not fallback, drives the call.
    route = respx_mock.post(f"{META_BASE_URL}/page-42/feed").mock(
        return_value=httpx.Response(200, json={"id": "42_1"})
    )

    body = {
        "publicationId": "pub-4",
        "targets": [
            {
                "publicationTargetId": "t1",
                "socialAccountId": FACEBOOK_ACCOUNT_ID,
                "provider": "facebook",
                "content": "Hello from the real account",
                "mediaUrls": [],
            }
        ],
    }

    response = client.post(
        "/internal/v1/publications/publish",
        json=body,
        headers={"Idempotency-Key": "idem-real-fb", **_auth_header()},
    )

    assert response.json()["results"][0]["status"] == "SUCCESS"
    assert response.json()["results"][0]["externalPublicationId"] == "42_1"
    assert route.calls.last.request.url.params["access_token"] == "page-42-token"


# --- Instagram: container publish flow ----------------------------------------


def test_publish_instagram_polls_container_then_publishes(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store, monkeypatch
):
    from core.config import settings

    monkeypatch.setattr(settings, "instagram_container_poll_interval_seconds", 0)
    _seed_instagram_account(fake_social_accounts_store, fake_oauth_tokens_store)

    create_route = respx_mock.post(f"{META_BASE_URL}/ig-99/media").mock(
        return_value=httpx.Response(200, json={"id": "container-1"})
    )
    respx_mock.get(f"{META_BASE_URL}/container-1").mock(
        side_effect=[
            httpx.Response(200, json={"status_code": "IN_PROGRESS"}),
            httpx.Response(200, json={"status_code": "FINISHED"}),
        ]
    )
    publish_route = respx_mock.post(f"{META_BASE_URL}/ig-99/media_publish").mock(
        return_value=httpx.Response(200, json={"id": "ig-post-1"})
    )

    body = {
        "publicationId": "pub-5",
        "targets": [
            {
                "publicationTargetId": "t1",
                "socialAccountId": INSTAGRAM_ACCOUNT_ID,
                "provider": "instagram",
                "content": "Une belle photo",
                "mediaUrls": ["https://example.com/photo.jpg"],
            }
        ],
    }

    response = client.post(
        "/internal/v1/publications/publish",
        json=body,
        headers={"Idempotency-Key": "idem-ig", **_auth_header()},
    )

    result = response.json()["results"][0]
    assert result["status"] == "SUCCESS"
    assert result["externalPublicationId"] == "ig-post-1"
    # access_token travels in the POST body here (form data), not the URL.
    assert b"ig-99-token" in create_route.calls.last.request.content
    assert publish_route.called


def test_publish_instagram_requires_exactly_one_image(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_instagram_account(fake_social_accounts_store, fake_oauth_tokens_store)

    body = {
        "publicationId": "pub-6",
        "targets": [
            {
                "publicationTargetId": "t1",
                "socialAccountId": INSTAGRAM_ACCOUNT_ID,
                "provider": "instagram",
                "content": "Sans image",
                "mediaUrls": [],
            }
        ],
    }

    response = client.post(
        "/internal/v1/publications/publish",
        json=body,
        headers={"Idempotency-Key": "idem-ig-noimg", **_auth_header()},
    )

    assert response.json()["results"][0]["errorCode"] == "invalid_media"


def test_publish_instagram_container_error_status_fails_cleanly(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store, monkeypatch
):
    from core.config import settings

    monkeypatch.setattr(settings, "instagram_container_poll_interval_seconds", 0)
    _seed_instagram_account(fake_social_accounts_store, fake_oauth_tokens_store)

    respx_mock.post(f"{META_BASE_URL}/ig-99/media").mock(
        return_value=httpx.Response(200, json={"id": "container-2"})
    )
    respx_mock.get(f"{META_BASE_URL}/container-2").mock(
        return_value=httpx.Response(200, json={"status_code": "ERROR"})
    )

    body = {
        "publicationId": "pub-7",
        "targets": [
            {
                "publicationTargetId": "t1",
                "socialAccountId": INSTAGRAM_ACCOUNT_ID,
                "provider": "instagram",
                "content": "Média invalide",
                "mediaUrls": ["https://example.com/bad.jpg"],
            }
        ],
    }

    response = client.post(
        "/internal/v1/publications/publish",
        json=body,
        headers={"Idempotency-Key": "idem-ig-error", **_auth_header()},
    )

    assert response.json()["results"][0]["status"] == "FAILED"
    assert response.json()["results"][0]["errorCode"] == "invalid_media"


def test_publish_partial_success_across_facebook_and_instagram(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store, monkeypatch
):
    """Acceptance criterion: Facebook/Instagram partial success is handled —
    one target succeeds, the other fails, in the same publish call."""
    from core.config import settings

    monkeypatch.setattr(settings, "instagram_container_poll_interval_seconds", 0)
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    _seed_instagram_account(fake_social_accounts_store, fake_oauth_tokens_store)

    respx_mock.post(f"{META_BASE_URL}/page-42/feed").mock(
        return_value=httpx.Response(200, json={"id": "42_2"})
    )
    respx_mock.post(f"{META_BASE_URL}/ig-99/media").mock(
        return_value=httpx.Response(400, json={"error": {"message": "Invalid image URL", "code": 100}})
    )

    body = {
        "publicationId": "pub-8",
        "targets": [
            {
                "publicationTargetId": "t1",
                "socialAccountId": FACEBOOK_ACCOUNT_ID,
                "provider": "facebook",
                "content": "Texte",
                "mediaUrls": [],
            },
            {
                "publicationTargetId": "t2",
                "socialAccountId": INSTAGRAM_ACCOUNT_ID,
                "provider": "instagram",
                "content": "Texte",
                "mediaUrls": ["https://example.com/bad.jpg"],
            },
        ],
    }

    response = client.post(
        "/internal/v1/publications/publish",
        json=body,
        headers={"Idempotency-Key": "idem-partial", **_auth_header()},
    )

    results = {r["provider"]: r for r in response.json()["results"]}
    assert results["facebook"]["status"] == "SUCCESS"
    assert results["instagram"]["status"] == "FAILED"


# --- Instagram comments (distinct /replies edge) ------------------------------


def test_instagram_comments_sync_maps_username_and_text(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_instagram_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/ig-post-1/comments").mock(
        return_value=httpx.Response(
            200,
            json={"data": [{"id": "igc1", "text": "Superbe !", "username": "fan_account", "timestamp": "2026-01-01T10:00:00+0000"}]},
        )
    )

    response = client.post(
        "/internal/v1/comments/sync",
        json={
            "socialAccountId": INSTAGRAM_ACCOUNT_ID,
            "provider": "instagram",
            "publicationExternalIds": ["ig-post-1"],
            "limit": 50,
        },
        headers=_auth_header(scope=["social:read"]),
    )

    assert response.status_code == 200
    comment = response.json()["comments"][0]
    assert comment["externalCommentId"] == "igc1"
    assert comment["authorName"] == "fan_account"
    assert comment["content"] == "Superbe !"


def _seed_comment(fake_social_comments_store, *, comment_id, social_account_id, external_comment_id, is_deleted=False):
    fake_social_comments_store[(social_account_id, external_comment_id)] = {
        "id": comment_id,
        "social_account_id": social_account_id,
        "external_comment_id": external_comment_id,
        "external_publication_id": "post-1",
        "status": "NEW",
        "is_deleted_on_platform": is_deleted,
    }


def test_instagram_reply_uses_the_replies_edge_not_comments(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store, fake_social_comments_store
):
    """Instagram replies post to {comment_id}/replies, not /comments like Facebook."""
    _seed_instagram_account(fake_social_accounts_store, fake_oauth_tokens_store)
    _seed_comment(
        fake_social_comments_store, comment_id="comment-ig-1", social_account_id=INSTAGRAM_ACCOUNT_ID, external_comment_id="igc1"
    )
    route = respx_mock.post(f"{META_BASE_URL}/igc1/replies").mock(
        return_value=httpx.Response(200, json={"id": "igr1"})
    )

    response = client.post(
        "/internal/v1/comments/reply",
        json={"commentId": "comment-ig-1", "userId": "user-1", "text": "Merci beaucoup !"},
        headers={"Idempotency-Key": "idem-ig-reply", **_auth_header()},
    )

    assert response.status_code == 200
    assert response.json()["externalReplyId"] == "igr1"
    assert route.called


def test_reply_persists_a_sent_response_and_marks_the_comment_processed(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_social_comments_store, fake_sent_responses_store,
):
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    _seed_comment(
        fake_social_comments_store, comment_id="comment-fb-1", social_account_id=FACEBOOK_ACCOUNT_ID, external_comment_id="c1"
    )
    respx_mock.post(f"{META_BASE_URL}/c1/comments").mock(return_value=httpx.Response(200, json={"id": "reply-1"}))

    response = client.post(
        "/internal/v1/comments/reply",
        json={"commentId": "comment-fb-1", "userId": "user-42", "text": "Merci !"},
        headers={"Idempotency-Key": "idem-reply-1", **_auth_header()},
    )

    assert response.status_code == 200
    stored = fake_sent_responses_store["comment-fb-1"]
    assert stored["status"] == "SUCCEEDED"
    assert stored["external_reply_id"] == "reply-1"
    assert stored["sent_by_user_id"] == "user-42"
    assert fake_social_comments_store[(FACEBOOK_ACCOUNT_ID, "c1")]["status"] == "PROCESSED"


def test_reply_to_an_already_replied_comment_is_rejected_without_calling_meta(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_social_comments_store, fake_sent_responses_store,
):
    """The claim (fake_sent_responses_store) is the real exactly-once guard —
    a second attempt must be rejected before ever reaching Meta."""
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    _seed_comment(
        fake_social_comments_store, comment_id="comment-fb-2", social_account_id=FACEBOOK_ACCOUNT_ID, external_comment_id="c2"
    )
    route = respx_mock.post(f"{META_BASE_URL}/c2/comments").mock(return_value=httpx.Response(200, json={"id": "reply-2"}))

    first = client.post(
        "/internal/v1/comments/reply",
        json={"commentId": "comment-fb-2", "userId": "user-1", "text": "Première réponse"},
        headers={"Idempotency-Key": "idem-first", **_auth_header()},
    )
    assert first.status_code == 200
    assert route.call_count == 1

    second = client.post(
        "/internal/v1/comments/reply",
        json={"commentId": "comment-fb-2", "userId": "user-1", "text": "Deuxième réponse"},
        headers={"Idempotency-Key": "idem-second", **_auth_header()},
    )

    assert second.status_code == 409
    assert second.json()["error"]["code"] == "conflict"
    assert route.call_count == 1  # never called again


def test_reply_to_a_deleted_comment_is_rejected(
    client, service_jwt_settings, fake_social_accounts_store, fake_oauth_tokens_store, fake_social_comments_store
):
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    _seed_comment(
        fake_social_comments_store, comment_id="comment-fb-3", social_account_id=FACEBOOK_ACCOUNT_ID,
        external_comment_id="c3", is_deleted=True,
    )

    response = client.post(
        "/internal/v1/comments/reply",
        json={"commentId": "comment-fb-3", "userId": "user-1", "text": "Trop tard"},
        headers={"Idempotency-Key": "idem-deleted", **_auth_header()},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


def test_reply_meta_failure_marks_the_sent_response_failed_not_the_comment_processed(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_social_comments_store, fake_sent_responses_store,
):
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    _seed_comment(
        fake_social_comments_store, comment_id="comment-fb-4", social_account_id=FACEBOOK_ACCOUNT_ID, external_comment_id="c4"
    )
    respx_mock.post(f"{META_BASE_URL}/c4/comments").mock(
        return_value=httpx.Response(403, json={"error": {"message": "Permission manquante", "code": 200}})
    )

    response = client.post(
        "/internal/v1/comments/reply",
        json={"commentId": "comment-fb-4", "userId": "user-1", "text": "Merci !"},
        headers={"Idempotency-Key": "idem-fail", **_auth_header()},
    )

    assert response.status_code == 403
    assert fake_sent_responses_store["comment-fb-4"]["status"] == "FAILED"
    # A failed send must not silently resolve the comment.
    assert fake_social_comments_store[(FACEBOOK_ACCOUNT_ID, "c4")]["status"] == "NEW"


def test_reply_can_be_retried_after_a_failure(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_social_comments_store, fake_sent_responses_store,
):
    """A FAILED attempt (unlike a SUCCEEDED one) must not permanently block
    the comment_id — otherwise a transient Meta error would make a comment
    unreplyable forever. Found by reasoning through the claim's conflict
    semantics before relying on it in manual testing, not by a failing test."""
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    _seed_comment(
        fake_social_comments_store, comment_id="comment-fb-5", social_account_id=FACEBOOK_ACCOUNT_ID, external_comment_id="c5"
    )
    route = respx_mock.post(f"{META_BASE_URL}/c5/comments")
    route.side_effect = [
        httpx.Response(500, json={"error": {"message": "Erreur temporaire"}}),
        httpx.Response(200, json={"id": "reply-5"}),
    ]

    first = client.post(
        "/internal/v1/comments/reply",
        json={"commentId": "comment-fb-5", "userId": "user-1", "text": "Merci !"},
        headers={"Idempotency-Key": "idem-retry-1", **_auth_header()},
    )
    assert first.status_code == 500
    assert fake_sent_responses_store["comment-fb-5"]["status"] == "FAILED"

    second = client.post(
        "/internal/v1/comments/reply",
        json={"commentId": "comment-fb-5", "userId": "user-1", "text": "Merci ! (nouvel essai)"},
        headers={"Idempotency-Key": "idem-retry-2", **_auth_header()},
    )

    assert second.status_code == 200
    assert second.json()["externalReplyId"] == "reply-5"
    assert fake_sent_responses_store["comment-fb-5"]["status"] == "SUCCEEDED"
    assert fake_sent_responses_store["comment-fb-5"]["content"] == "Merci ! (nouvel essai)"


def test_instagram_metrics_sync_null_for_unavailable(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_instagram_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/ig-post-1/insights").mock(
        return_value=httpx.Response(400, json={"error": {"message": "Media too old", "code": 10}})
    )

    response = client.post(
        "/internal/v1/metrics/sync",
        json={
            "socialAccountId": INSTAGRAM_ACCOUNT_ID,
            "provider": "instagram",
            "publicationExternalIds": ["ig-post-1"],
            "from": "2026-01-01",
            "to": "2026-01-31",
        },
        headers=_auth_header(scope=["social:read"]),
    )

    assert response.status_code == 200
    metric = response.json()["metrics"][0]
    assert metric["reactions"] is None
    assert metric["impressions"] is None

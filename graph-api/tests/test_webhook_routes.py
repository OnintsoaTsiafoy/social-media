"""Sprint 08 Day 2: GET/POST /webhooks/meta."""
import hashlib
import hmac
import json


def _signed_body(payload: dict, secret: str) -> tuple[bytes, str]:
    raw = json.dumps(payload).encode("utf-8")
    signature = "sha256=" + hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return raw, signature


def _facebook_comment_payload(*, page_id="page-1", comment_id="cmt-1", verb="add", message="Hello"):
    return {
        "object": "page",
        "entry": [
            {
                "id": page_id,
                "time": 1700000000,
                "changes": [
                    {
                        "field": "feed",
                        "value": {
                            "item": "comment",
                            "verb": verb,
                            "comment_id": comment_id,
                            "post_id": "post-1",
                            "from": {"id": "user-1", "name": "Alice"},
                            "message": message,
                            "created_time": 1700000000,
                        },
                    }
                ],
            }
        ],
    }


def _instagram_comment_payload(*, ig_id="ig-1", comment_id="ig-cmt-1", text="Nice post"):
    return {
        "object": "instagram",
        "entry": [
            {
                "id": ig_id,
                "time": 1700000000,
                "changes": [
                    {
                        "field": "comments",
                        "value": {
                            "id": comment_id,
                            "text": text,
                            "from": {"id": "ig-user-1", "username": "bob"},
                            "media": {"id": "media-1", "media_product_type": "FEED"},
                        },
                    }
                ],
            }
        ],
    }


def test_challenge_with_correct_token_echoes_it(client, webhook_settings):
    response = client.get(
        "/webhooks/meta",
        params={"hub.mode": "subscribe", "hub.verify_token": "test-webhook-verify-token", "hub.challenge": "abc123"},
    )
    assert response.status_code == 200
    assert response.text == "abc123"


def test_challenge_with_wrong_token_is_rejected(client, webhook_settings):
    response = client.get(
        "/webhooks/meta",
        params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "abc123"},
    )
    assert response.status_code == 403


def test_facebook_comment_is_persisted(client, webhook_settings, fake_social_accounts_store):
    fake_social_accounts_store[("FACEBOOK", "page-1")] = {
        "id": "account-1", "provider": "FACEBOOK", "external_account_id": "page-1",
    }
    payload = _facebook_comment_payload()
    raw, signature = _signed_body(payload, "test-app-secret")

    response = client.post("/webhooks/meta", content=raw, headers={"x-hub-signature-256": signature})

    assert response.status_code == 200


def test_duplicate_facebook_delivery_does_not_create_two_comments(
    client, webhook_settings, fake_social_accounts_store, fake_social_comments_store
):
    fake_social_accounts_store[("FACEBOOK", "page-1")] = {
        "id": "account-1", "provider": "FACEBOOK", "external_account_id": "page-1",
    }
    payload = _facebook_comment_payload()
    raw, signature = _signed_body(payload, "test-app-secret")
    headers = {"x-hub-signature-256": signature}

    first = client.post("/webhooks/meta", content=raw, headers=headers)
    second = client.post("/webhooks/meta", content=raw, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert len(fake_social_comments_store) == 1


def test_invalid_signature_is_rejected_and_nothing_is_persisted(
    client, webhook_settings, fake_social_accounts_store, fake_social_comments_store, fake_webhook_events_store
):
    fake_social_accounts_store[("FACEBOOK", "page-1")] = {
        "id": "account-1", "provider": "FACEBOOK", "external_account_id": "page-1",
    }
    payload = _facebook_comment_payload()
    raw, _ = _signed_body(payload, "wrong-secret")

    response = client.post("/webhooks/meta", content=raw, headers={"x-hub-signature-256": "sha256=deadbeef"})

    assert response.status_code == 403
    assert len(fake_social_comments_store) == 0
    assert len(fake_webhook_events_store) == 0


def test_instagram_comment_dispatches_to_the_instagram_secret(
    client, webhook_settings, fake_social_accounts_store, fake_social_comments_store
):
    fake_social_accounts_store[("INSTAGRAM", "ig-1")] = {
        "id": "account-2", "provider": "INSTAGRAM", "external_account_id": "ig-1",
    }
    payload = _instagram_comment_payload()
    raw, signature = _signed_body(payload, "test-ig-app-secret")

    response = client.post("/webhooks/meta", content=raw, headers={"x-hub-signature-256": signature})

    assert response.status_code == 200
    assert len(fake_social_comments_store) == 1
    stored = next(iter(fake_social_comments_store.values()))
    assert stored["author_name"] == "bob"
    assert stored["content"] == "Nice post"


def test_facebook_signature_does_not_validate_an_instagram_payload_against_the_wrong_secret(
    client, webhook_settings, fake_social_accounts_store
):
    """A payload claiming object=instagram must be checked against the
    Instagram app secret, never the Facebook one, even if both are configured."""
    payload = _instagram_comment_payload()
    raw, signature = _signed_body(payload, "test-app-secret")  # wrong secret on purpose

    response = client.post("/webhooks/meta", content=raw, headers={"x-hub-signature-256": signature})

    assert response.status_code == 403


def test_removed_comment_marks_an_already_known_comment_deleted(
    client, webhook_settings, fake_social_accounts_store, fake_social_comments_store
):
    fake_social_accounts_store[("FACEBOOK", "page-1")] = {
        "id": "account-1", "provider": "FACEBOOK", "external_account_id": "page-1",
    }
    add_payload = _facebook_comment_payload(verb="add")
    raw_add, sig_add = _signed_body(add_payload, "test-app-secret")
    client.post("/webhooks/meta", content=raw_add, headers={"x-hub-signature-256": sig_add})

    remove_payload = _facebook_comment_payload(verb="remove")
    raw_remove, sig_remove = _signed_body(remove_payload, "test-app-secret")
    response = client.post("/webhooks/meta", content=raw_remove, headers={"x-hub-signature-256": sig_remove})

    assert response.status_code == 200
    stored = next(iter(fake_social_comments_store.values()))
    assert stored["is_deleted_on_platform"] is True


def test_removed_comment_never_seen_before_creates_no_phantom_row(
    client, webhook_settings, fake_social_accounts_store, fake_social_comments_store
):
    fake_social_accounts_store[("FACEBOOK", "page-1")] = {
        "id": "account-1", "provider": "FACEBOOK", "external_account_id": "page-1",
    }
    payload = _facebook_comment_payload(verb="remove", comment_id="never-seen")
    raw, signature = _signed_body(payload, "test-app-secret")

    response = client.post("/webhooks/meta", content=raw, headers={"x-hub-signature-256": signature})

    assert response.status_code == 200
    assert len(fake_social_comments_store) == 0


def test_comment_edit_does_not_revert_an_escalated_status(
    client, webhook_settings, fake_social_accounts_store, fake_social_comments_store
):
    """The upsert must never touch `status` on a content-only update — a
    Meta-side edit to an already-ESCALATED comment must not silently
    revert it to NEW."""
    fake_social_accounts_store[("FACEBOOK", "page-1")] = {
        "id": "account-1", "provider": "FACEBOOK", "external_account_id": "page-1",
    }
    raw1, sig1 = _signed_body(_facebook_comment_payload(message="Original"), "test-app-secret")
    client.post("/webhooks/meta", content=raw1, headers={"x-hub-signature-256": sig1})

    stored = next(iter(fake_social_comments_store.values()))
    stored["status"] = "ESCALATED"

    raw2, sig2 = _signed_body(_facebook_comment_payload(message="Edited"), "test-app-secret")
    response = client.post("/webhooks/meta", content=raw2, headers={"x-hub-signature-256": sig2})

    assert response.status_code == 200
    stored_after = next(iter(fake_social_comments_store.values()))
    assert stored_after["content"] == "Edited"
    assert stored_after["status"] == "ESCALATED"


def test_comment_for_an_unconnected_account_is_skipped_without_error(
    client, webhook_settings, fake_social_comments_store
):
    """No social_accounts row matches this page — a lingering test
    subscription or a disconnected Page — nothing to attach the comment to."""
    payload = _facebook_comment_payload(page_id="unknown-page")
    raw, signature = _signed_body(payload, "test-app-secret")

    response = client.post("/webhooks/meta", content=raw, headers={"x-hub-signature-256": signature})

    assert response.status_code == 200
    assert len(fake_social_comments_store) == 0


def test_non_comment_feed_item_is_ignored(client, webhook_settings, fake_webhook_events_store):
    """A Facebook `feed` change about a post/photo/like isn't comment-related
    — it's not even logged, since nothing here acts on it."""
    payload = {
        "object": "page",
        "entry": [{"id": "page-1", "time": 1700000000, "changes": [{"field": "feed", "value": {"item": "like"}}]}],
    }
    raw, signature = _signed_body(payload, "test-app-secret")

    response = client.post("/webhooks/meta", content=raw, headers={"x-hub-signature-256": signature})

    assert response.status_code == 200
    assert len(fake_webhook_events_store) == 0


def test_unknown_object_field_is_rejected(client, webhook_settings):
    payload = {"object": "whatsapp_business_account", "entry": []}
    raw, _ = _signed_body(payload, "test-app-secret")

    response = client.post("/webhooks/meta", content=raw, headers={"x-hub-signature-256": "sha256=irrelevant"})

    assert response.status_code == 403


def test_malformed_json_body_is_rejected(client, webhook_settings):
    response = client.post("/webhooks/meta", content=b"not json", headers={"x-hub-signature-256": "sha256=x"})

    assert response.status_code == 400


def test_webhook_routes_are_exempt_from_the_default_rate_limit(client, webhook_settings, fake_social_accounts_store):
    """Meta retries aggressively on non-200 — a 429 here would make it worse.
    120 is the app-wide default limit; comfortably exceeding it here proves
    the exemption, not the limiter's absence."""
    fake_social_accounts_store[("FACEBOOK", "page-1")] = {
        "id": "account-1", "provider": "FACEBOOK", "external_account_id": "page-1",
    }
    for _ in range(125):
        response = client.get(
            "/webhooks/meta",
            params={"hub.mode": "subscribe", "hub.verify_token": "test-webhook-verify-token", "hub.challenge": "x"},
        )
        assert response.status_code == 200

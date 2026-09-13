import time

import jwt
import pytest
from fastapi.testclient import TestClient

from core.config import settings
from db import (
    idempotency_repository,
    oauth_states_repository,
    oauth_tokens_repository,
    publication_targets_repository,
    sent_responses_repository,
    social_accounts_repository,
    social_comments_repository,
    social_metrics_repository,
    social_permissions_repository,
    webhook_events_repository,
)
from modules.facebook.clients.facebook_client import facebook_client
from main import app

META_BASE_URL = "https://graph.facebook.com/v25.0"
PAGE_ID = "123456789"
SERVICE_JWT_SECRET = "test-service-secret-at-least-32-bytes-long"


@pytest.fixture
def configured_settings(monkeypatch):
    """A complete, valid local Meta configuration.

    Business routes 503 before any HTTP call when this isn't set (see
    ``FacebookClient._require_configuration``), so most tests need it.

    ``FacebookClient`` reads ``page_id``/``access_token`` once at
    construction time (it's a module-level singleton built at import), so
    patching ``settings`` alone would not reach the already-built instance;
    both are patched here to keep the fixture usable from any test.
    """
    monkeypatch.setattr(settings, "facebook_app_id", "test-app-id")
    monkeypatch.setattr(settings, "facebook_page_id", PAGE_ID)
    monkeypatch.setattr(settings, "facebook_page_access_token", "test-page-token")
    monkeypatch.setattr(settings, "facebook_app_secret", "test-app-secret")
    monkeypatch.setattr(settings, "instagram_app_id", "test-ig-app-id")
    monkeypatch.setattr(settings, "instagram_app_secret", "test-ig-app-secret")
    monkeypatch.setattr(facebook_client, "page_id", PAGE_ID)
    monkeypatch.setattr(facebook_client, "access_token", "test-page-token")
    return settings


@pytest.fixture
def client(configured_settings):
    # raise_server_exceptions=True (the default) lets tests that document a
    # currently-uncaught bug assert on the exact exception with pytest.raises,
    # instead of a generic 500 response.
    return TestClient(app)


@pytest.fixture
def service_jwt_settings(monkeypatch):
    monkeypatch.setattr(settings, "service_jwt_secret", SERVICE_JWT_SECRET)
    return settings


@pytest.fixture(autouse=True)
def fake_idempotency_store(monkeypatch):
    """graph-api's real Idempotency-Key store needs Postgres (Sprint 06); unit
    tests use an in-memory fake instead, same philosophy as services/worker's
    tests running "against an in-memory DB double" (see CLAUDE.md). Autouse so
    no test can accidentally reach the real db.pool.get_pool()."""
    store: dict[tuple[str, str], tuple[dict, dict]] = {}

    async def fake_get_cached_response(endpoint, key, request_payload):
        entry = store.get((endpoint, key))
        if entry is None:
            return None, False
        stored_payload, stored_response = entry
        if stored_payload != request_payload:
            return None, True
        return stored_response, False

    async def fake_store_response(endpoint, key, request_payload, response_body):
        store[(endpoint, key)] = (request_payload, response_body)

    monkeypatch.setattr(idempotency_repository, "get_cached_response", fake_get_cached_response)
    monkeypatch.setattr(idempotency_repository, "store_response", fake_store_response)
    return store


@pytest.fixture(autouse=True)
def fake_oauth_states_store(monkeypatch):
    """In-memory fake for oauth_states — same rationale as fake_idempotency_store."""
    import uuid as _uuid
    from datetime import datetime, timedelta, timezone

    store: dict[str, dict] = {}

    async def fake_create_state(*, state_hash, user_id, brand_id, provider, mobile_redirect_uri):
        expires_at = datetime.now(timezone.utc) + timedelta(
            seconds=oauth_states_repository.STATE_TTL_SECONDS
        )
        store[state_hash] = {
            "id": str(_uuid.uuid4()),
            "user_id": user_id,
            "brand_id": brand_id,
            "provider": provider.upper(),
            "mobile_redirect_uri": mobile_redirect_uri,
            "consumed_at": None,
            "expires_at": expires_at,
        }
        return {"id": store[state_hash]["id"], "expires_at": expires_at}

    async def fake_consume_state(state_hash):
        row = store.get(state_hash)
        if row is None or row["consumed_at"] is not None:
            return None
        if row["expires_at"] <= datetime.now(timezone.utc):
            return None
        row["consumed_at"] = datetime.now(timezone.utc)
        return {
            "id": row["id"],
            "user_id": row["user_id"],
            "brand_id": row["brand_id"],
            "provider": row["provider"],
            "mobile_redirect_uri": row["mobile_redirect_uri"],
        }

    monkeypatch.setattr(oauth_states_repository, "create_state", fake_create_state)
    monkeypatch.setattr(oauth_states_repository, "consume_state", fake_consume_state)
    return store


@pytest.fixture(autouse=True)
def fake_social_accounts_store(monkeypatch):
    """In-memory fake for social_accounts, keyed like the real
    unique(provider, external_account_id) constraint."""
    store: dict[tuple[str, str], dict] = {}
    counter = {"n": 0}

    async def fake_upsert_account(
        *, brand_id, provider, external_account_id, name, username, avatar_url, auth_method,
        connected_by_user_id,
    ):
        key = (provider.upper(), external_account_id)
        if key not in store:
            counter["n"] += 1
            store[key] = {"id": f"account-{counter['n']}"}
        store[key].update(
            {
                "brand_id": brand_id,
                "provider": provider.upper(),
                "external_account_id": external_account_id,
                "name": name,
                "username": username,
                "avatar_url": avatar_url,
                "status": "CONNECTED",
                "auth_method": auth_method,
                "connected_by_user_id": connected_by_user_id,
            }
        )
        return dict(store[key])

    async def fake_get_by_id(account_id):
        for account in store.values():
            if account["id"] == account_id:
                return dict(account)
        return None

    async def fake_get_by_external_id(provider, external_account_id):
        account = store.get((provider.upper(), external_account_id))
        return dict(account) if account else None

    async def fake_update_status(account_id, status):
        for account in store.values():
            if account["id"] == account_id:
                account["status"] = status

    async def fake_update_profile(account_id, *, name, username, avatar_url):
        for account in store.values():
            if account["id"] == account_id:
                account.update({"name": name, "username": username, "avatar_url": avatar_url})

    async def fake_mark_comments_synced(account_id):
        for account in store.values():
            if account["id"] == account_id:
                account["last_comments_sync_at"] = "2026-01-01T00:00:00+00:00"

    async def fake_mark_metrics_synced(account_id):
        for account in store.values():
            if account["id"] == account_id:
                account["last_metrics_sync_at"] = "2026-01-01T00:00:00+00:00"

    monkeypatch.setattr(social_accounts_repository, "upsert_account", fake_upsert_account)
    monkeypatch.setattr(social_accounts_repository, "get_by_id", fake_get_by_id)
    monkeypatch.setattr(social_accounts_repository, "get_by_external_id", fake_get_by_external_id)
    monkeypatch.setattr(social_accounts_repository, "update_status", fake_update_status)
    monkeypatch.setattr(social_accounts_repository, "update_profile", fake_update_profile)
    monkeypatch.setattr(social_accounts_repository, "mark_comments_synced", fake_mark_comments_synced)
    monkeypatch.setattr(social_accounts_repository, "mark_metrics_synced", fake_mark_metrics_synced)
    return store


@pytest.fixture(autouse=True)
def fake_oauth_tokens_store(monkeypatch):
    """In-memory fake for oauth_tokens — bypasses real encryption/DB so the
    stored value here is deliberately plaintext, for test assertions only."""
    store: dict[str, dict] = {}

    async def fake_store_token(*, social_account_id, access_token, refresh_token, scope, expires_at):
        store[social_account_id] = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "scope": scope,
            "expires_at": expires_at,
        }
        return {"id": "token-1", "version": 1, "expires_at": expires_at}

    async def fake_get_decrypted_access_token(social_account_id):
        entry = store.get(social_account_id)
        return entry["access_token"] if entry else None

    async def fake_mark_revoked(social_account_id):
        store.pop(social_account_id, None)

    monkeypatch.setattr(oauth_tokens_repository, "store_token", fake_store_token)
    monkeypatch.setattr(
        oauth_tokens_repository, "get_decrypted_access_token", fake_get_decrypted_access_token
    )
    monkeypatch.setattr(oauth_tokens_repository, "mark_revoked", fake_mark_revoked)
    return store


@pytest.fixture(autouse=True)
def fake_social_permissions_store(monkeypatch):
    store: dict[str, list] = {}

    async def fake_upsert_permissions(social_account_id, permissions):
        store[social_account_id] = permissions

    async def fake_list_permissions(social_account_id):
        return store.get(social_account_id, [])

    monkeypatch.setattr(social_permissions_repository, "upsert_permissions", fake_upsert_permissions)
    monkeypatch.setattr(social_permissions_repository, "list_permissions", fake_list_permissions)
    return store


@pytest.fixture(autouse=True)
def fake_webhook_events_store(monkeypatch):
    """Keyed like the real unique(provider, payload_hash) constraint."""
    store: dict[tuple[str, str], dict] = {}
    counter = {"n": 0}

    async def fake_claim_event(*, provider, payload_hash, raw_payload):
        key = (provider, payload_hash)
        if key in store:
            return None
        counter["n"] += 1
        store[key] = {"id": f"event-{counter['n']}", "status": "RECEIVED", "raw_payload": raw_payload}
        return {"id": store[key]["id"]}

    async def fake_mark_processed(event_id):
        for event in store.values():
            if event["id"] == event_id:
                event["status"] = "PROCESSED"

    async def fake_mark_failed(event_id, error_message):
        for event in store.values():
            if event["id"] == event_id:
                event["status"] = "FAILED"
                event["error_message"] = error_message

    monkeypatch.setattr(webhook_events_repository, "claim_event", fake_claim_event)
    monkeypatch.setattr(webhook_events_repository, "mark_processed", fake_mark_processed)
    monkeypatch.setattr(webhook_events_repository, "mark_failed", fake_mark_failed)
    return store


@pytest.fixture(autouse=True)
def fake_social_comments_store(monkeypatch):
    """Keyed like the real unique(social_account_id, external_comment_id)."""
    store: dict[tuple[str, str], dict] = {}
    counter = {"n": 0}

    async def fake_upsert_comment(
        *, social_account_id, external_comment_id, external_publication_id, author_external_id,
        author_name, content, meta_created_at, meta_updated_at,
    ):
        key = (social_account_id, external_comment_id)
        if key not in store:
            counter["n"] += 1
            store[key] = {"id": f"comment-{counter['n']}", "status": "NEW", "is_deleted_on_platform": False}
        row = store[key]
        row.update(
            {
                "social_account_id": social_account_id,
                "external_comment_id": external_comment_id,
                # COALESCE semantics: a None from the caller never clears an
                # already-known field, matching the real upsert's SQL.
                "external_publication_id": external_publication_id or row.get("external_publication_id"),
                "author_external_id": author_external_id or row.get("author_external_id"),
                "author_name": author_name or row.get("author_name"),
                "content": content if content is not None else row.get("content"),
            }
        )
        return {"id": row["id"], "status": row["status"]}

    async def fake_mark_deleted(social_account_id, external_comment_id):
        row = store.get((social_account_id, external_comment_id))
        if row is None:
            return None
        row["is_deleted_on_platform"] = True
        return {"id": row["id"]}

    async def fake_get_by_id(comment_id):
        for row in store.values():
            if row["id"] == comment_id:
                return dict(row)
        return None

    async def fake_set_status(comment_id, to_status, *, changed_by_user_id, note=None):
        for row in store.values():
            if row["id"] == comment_id:
                row["status"] = to_status

    async def fake_list_known_external_ids(social_account_id, external_publication_id):
        return {
            row["external_comment_id"]
            for row in store.values()
            if row["social_account_id"] == social_account_id
            and row.get("external_publication_id") == external_publication_id
            and not row["is_deleted_on_platform"]
        }

    monkeypatch.setattr(social_comments_repository, "upsert_comment", fake_upsert_comment)
    monkeypatch.setattr(social_comments_repository, "mark_deleted", fake_mark_deleted)
    monkeypatch.setattr(social_comments_repository, "get_by_id", fake_get_by_id)
    monkeypatch.setattr(social_comments_repository, "set_status", fake_set_status)
    monkeypatch.setattr(social_comments_repository, "list_known_external_ids", fake_list_known_external_ids)
    return store


@pytest.fixture(autouse=True)
def fake_sent_responses_store(monkeypatch):
    """Keyed like the real unique(comment_id) constraint."""
    store: dict[str, dict] = {}

    async def fake_claim(*, comment_id, social_account_id, content, sent_by_user_id):
        existing = store.get(comment_id)
        # Mirrors the real `ON CONFLICT ... WHERE status = 'FAILED'`: a
        # FAILED attempt may be retried, a STARTED/SUCCEEDED one may not.
        if existing is not None and existing["status"] != "FAILED":
            return None
        store[comment_id] = {
            "id": existing["id"] if existing else f"response-{len(store) + 1}",
            "comment_id": comment_id,
            "social_account_id": social_account_id,
            "content": content,
            "sent_by_user_id": sent_by_user_id,
            "status": "STARTED",
            "external_reply_id": None,
        }
        return {"id": store[comment_id]["id"]}

    async def fake_mark_succeeded(response_id, external_reply_id):
        for row in store.values():
            if row["id"] == response_id:
                row["status"] = "SUCCEEDED"
                row["external_reply_id"] = external_reply_id

    async def fake_mark_failed(response_id, error_code, error_message):
        for row in store.values():
            if row["id"] == response_id:
                row["status"] = "FAILED"
                row["error_code"] = error_code
                row["error_message"] = error_message

    async def fake_get_by_comment_id(comment_id):
        row = store.get(comment_id)
        return dict(row) if row else None

    monkeypatch.setattr(sent_responses_repository, "claim", fake_claim)
    monkeypatch.setattr(sent_responses_repository, "mark_succeeded", fake_mark_succeeded)
    monkeypatch.setattr(sent_responses_repository, "mark_failed", fake_mark_failed)
    monkeypatch.setattr(sent_responses_repository, "get_by_comment_id", fake_get_by_comment_id)
    return store


@pytest.fixture(autouse=True)
def fake_publication_targets_store(monkeypatch):
    """In-memory fake for publication_targets (Sprint 12) — graph-api only
    ever reads this table, to resolve the publication_target_id a metrics
    snapshot must be filed under. Tests seed it directly by key; an
    unseeded (social_account_id, external_publication_id) pair resolves to
    None, exactly like a Meta id graph-api has never heard of locally."""
    store: dict[tuple[str, str], str] = {}

    async def fake_find_id_by_external_publication(social_account_id, external_publication_id):
        return store.get((social_account_id, external_publication_id))

    monkeypatch.setattr(
        publication_targets_repository, "find_id_by_external_publication", fake_find_id_by_external_publication
    )
    return store


@pytest.fixture(autouse=True)
def fake_social_metrics_store(monkeypatch):
    """In-memory fake for social_metrics (Sprint 12) — append-only, so this
    is a list of every snapshot insert_snapshot was called with, not a dict
    keyed for upsert."""
    store: list[dict] = []

    async def fake_insert_snapshot(**kwargs):
        row = {"id": f"metric-{len(store) + 1}", **kwargs}
        store.append(row)
        return {"id": row["id"]}

    monkeypatch.setattr(social_metrics_repository, "insert_snapshot", fake_insert_snapshot)
    return store


@pytest.fixture
def webhook_settings(monkeypatch):
    monkeypatch.setattr(settings, "meta_webhook_verify_token", "test-webhook-verify-token")
    monkeypatch.setattr(settings, "facebook_app_secret", "test-app-secret")
    monkeypatch.setattr(settings, "instagram_app_secret", "test-ig-app-secret")
    return settings


@pytest.fixture
def database_settings(monkeypatch):
    """Marks graph-api's DB/encryption as configured (for /ready and any code
    path that only checks *_configured) without touching a real Postgres."""
    monkeypatch.setattr(settings, "database_url", "postgresql://test:test@localhost/test")
    monkeypatch.setattr(settings, "token_encryption_key_1", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
    return settings


def make_service_jwt(
    scope=("social:read", "social:write"),
    sub="hootly-api",
    token_type="service",
    audience="social-service",
    exp_delta=120,
    secret=SERVICE_JWT_SECRET,
) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "aud": audience,
        "scope": list(scope),
        "type": token_type,
        "jti": "test-jti",
        "iat": now,
        "exp": now + exp_delta,
    }
    return jwt.encode(payload, secret, algorithm="HS256")

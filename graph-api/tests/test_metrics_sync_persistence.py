"""Sprint 12: sync_metrics now persists a social_metrics row per resolved
target and bumps last_metrics_sync_at, and a single failing post no longer
aborts the rest of the batch — none of that existed before this sprint (the
route was pure pass-through, see test_internal_routes.py's/
test_internal_routes_per_account.py's pre-existing tests, which only check
the response shape)."""
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
        "last_metrics_sync_at": None,
    }
    fake_oauth_tokens_store[FACEBOOK_ACCOUNT_ID] = {"access_token": "page-42-token"}


def _mock_post(respx_mock, post_id, *, reactions=5, comments=2, shares=1):
    respx_mock.get(f"{META_BASE_URL}/{post_id}").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": "Post",
                "created_time": "2026-01-01T10:00:00+0000",
                "reactions": {"summary": {"total_count": reactions}},
                "comments": {"summary": {"total_count": comments}},
                "shares": {"count": shares},
                "attachments": {"data": []},
            },
        )
    )


def _mock_insights(respx_mock, post_id, *, impressions=100, reach=80):
    respx_mock.get(f"{META_BASE_URL}/{post_id}/insights").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {"name": "post_impressions", "values": [{"value": impressions}]},
                    {"name": "post_impressions_unique", "values": [{"value": reach}]},
                ]
            },
        )
    )


def _sync(client, publication_external_ids):
    return client.post(
        "/internal/v1/metrics/sync",
        json={
            "socialAccountId": FACEBOOK_ACCOUNT_ID,
            "provider": "facebook",
            "publicationExternalIds": list(publication_external_ids),
        },
        headers=_auth_header(scope=["social:read"]),
    )


def test_synced_metrics_are_persisted_against_the_resolved_target(
    client,
    service_jwt_settings,
    respx_mock,
    fake_social_accounts_store,
    fake_oauth_tokens_store,
    fake_publication_targets_store,
    fake_social_metrics_store,
):
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    fake_publication_targets_store[(FACEBOOK_ACCOUNT_ID, "post-1")] = "target-1"
    _mock_post(respx_mock, "post-1")
    _mock_insights(respx_mock, "post-1")

    response = _sync(client, ["post-1"])

    assert response.status_code == 200
    assert len(fake_social_metrics_store) == 1
    stored = fake_social_metrics_store[0]
    assert stored["publication_target_id"] == "target-1"
    assert stored["reactions"] == 5
    assert stored["reach"] == 80


def test_metrics_sync_bumps_last_metrics_sync_at(
    client,
    service_jwt_settings,
    respx_mock,
    fake_social_accounts_store,
    fake_oauth_tokens_store,
    fake_publication_targets_store,
):
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    fake_publication_targets_store[(FACEBOOK_ACCOUNT_ID, "post-1")] = "target-1"
    _mock_post(respx_mock, "post-1")
    _mock_insights(respx_mock, "post-1")

    assert fake_social_accounts_store[("FACEBOOK", "page-42")]["last_metrics_sync_at"] is None

    response = _sync(client, ["post-1"])

    assert response.status_code == 200
    assert fake_social_accounts_store[("FACEBOOK", "page-42")]["last_metrics_sync_at"] is not None


def test_one_failing_post_does_not_abort_the_rest_of_the_batch(
    client,
    service_jwt_settings,
    respx_mock,
    fake_social_accounts_store,
    fake_oauth_tokens_store,
    fake_publication_targets_store,
    fake_social_metrics_store,
):
    """post-bad's own /1_1-equivalent fetch (the unguarded call inside
    post_analytics_service.get_post_analytics) raises — previously this
    aborted the whole sync_metrics loop, losing post-good's metrics too."""
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    fake_publication_targets_store[(FACEBOOK_ACCOUNT_ID, "post-good")] = "target-good"
    fake_publication_targets_store[(FACEBOOK_ACCOUNT_ID, "post-bad")] = "target-bad"
    _mock_post(respx_mock, "post-good")
    _mock_insights(respx_mock, "post-good")
    respx_mock.get(f"{META_BASE_URL}/post-bad").mock(
        return_value=httpx.Response(400, json={"error": {"message": "Unsupported get request", "code": 100}})
    )

    response = _sync(client, ["post-good", "post-bad"])

    assert response.status_code == 200
    body = response.json()["metrics"]
    assert len(body) == 2
    good, bad = body
    assert good["reactions"] == 5
    assert bad["reactions"] is None
    assert bad["impressions"] is None

    assert len(fake_social_metrics_store) == 2
    persisted_by_target = {row["publication_target_id"]: row for row in fake_social_metrics_store}
    assert persisted_by_target["target-good"]["reactions"] == 5
    assert persisted_by_target["target-bad"]["reactions"] is None


def test_unmatched_external_id_is_returned_but_not_persisted(
    client,
    service_jwt_settings,
    respx_mock,
    fake_social_accounts_store,
    fake_oauth_tokens_store,
    fake_social_metrics_store,
):
    """No publication_targets row exists for this (account, external id) —
    the item still comes back in the response (a stale/unknown id is a
    caller-side data problem, not a reason to fail the whole call), but there
    is nothing to file a snapshot under."""
    _seed_facebook_account(fake_social_accounts_store, fake_oauth_tokens_store)
    _mock_post(respx_mock, "post-orphan")
    _mock_insights(respx_mock, "post-orphan")

    response = _sync(client, ["post-orphan"])

    assert response.status_code == 200
    assert len(response.json()["metrics"]) == 1
    assert len(fake_social_metrics_store) == 0


def test_legacy_global_sync_without_social_account_id_does_not_persist(
    client, service_jwt_settings, configured_settings, respx_mock, fake_social_metrics_store
):
    """Sprint 05 behavior preserved: no socialAccountId means no
    social_accounts row to bump and no publication_targets to resolve —
    stays transient/read-only."""
    _mock_post(respx_mock, "1_1")
    respx_mock.get(f"{META_BASE_URL}/1_1/insights").mock(
        return_value=httpx.Response(400, json={"error": {"message": "no permission", "code": 10}})
    )

    response = client.post(
        "/internal/v1/metrics/sync",
        json={"socialAccountId": None, "provider": "facebook", "publicationExternalIds": ["1_1"]},
        headers=_auth_header(scope=["social:read"]),
    )

    assert response.status_code == 200
    assert len(response.json()["metrics"]) == 1
    assert len(fake_social_metrics_store) == 0

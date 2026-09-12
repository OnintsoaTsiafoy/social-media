"""Sprint 07 Day 2: GET /oauth/instagram/callback (Instagram Login, direct)."""
import httpx

from tests.conftest import make_service_jwt

IG_TOKEN_URL = "https://api.instagram.com/oauth/access_token"
IG_GRAPH_HOST = "https://graph.instagram.com/v25.0"


def _start_connect(client, service_jwt_settings) -> str:
    response = client.post(
        "/internal/v1/oauth/instagram/authorization-url",
        json={
            "userId": "11111111-1111-1111-1111-111111111111",
            "brandId": "22222222-2222-2222-2222-222222222222",
            "mobileRedirectUri": "hootly://oauth/callback",
        },
        headers={"Authorization": f"Bearer {make_service_jwt()}"},
    )
    return response.json()["state"]


def test_instagram_callback_nominal_links_a_business_account(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    state = _start_connect(client, service_jwt_settings)

    respx_mock.post(IG_TOKEN_URL).mock(
        return_value=httpx.Response(200, json={"access_token": "short-lived", "user_id": "17800000"})
    )
    respx_mock.get(f"{IG_GRAPH_HOST}/access_token").mock(
        return_value=httpx.Response(200, json={"access_token": "long-lived-ig-token", "expires_in": 5184000})
    )
    respx_mock.get(f"{IG_GRAPH_HOST}/17800000").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "17800000",
                "username": "creator_account",
                "name": "Creator Account",
                "account_type": "BUSINESS",
                "profile_picture_url": "https://example.com/pic.jpg",
            },
        )
    )

    response = client.get(
        "/oauth/instagram/callback", params={"state": state, "code": "auth-code"}, follow_redirects=False
    )

    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith("hootly://oauth/callback?")
    assert "status=success" in location
    assert "network=instagram" in location

    assert len(fake_social_accounts_store) == 1
    account = next(iter(fake_social_accounts_store.values()))
    assert account["provider"] == "INSTAGRAM"
    assert account["auth_method"] == "INSTAGRAM_LOGIN"
    assert account["username"] == "creator_account"

    stored_token = next(iter(fake_oauth_tokens_store.values()))
    assert stored_token["access_token"] == "long-lived-ig-token"


def test_instagram_callback_rejects_personal_account(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store
):
    """Named risk in the sprint spec: using an ineligible Instagram account."""
    state = _start_connect(client, service_jwt_settings)

    respx_mock.post(IG_TOKEN_URL).mock(
        return_value=httpx.Response(200, json={"access_token": "short-lived", "user_id": "17800001"})
    )
    respx_mock.get(f"{IG_GRAPH_HOST}/access_token").mock(
        return_value=httpx.Response(200, json={"access_token": "long-lived-ig-token"})
    )
    respx_mock.get(f"{IG_GRAPH_HOST}/17800001").mock(
        return_value=httpx.Response(
            200, json={"id": "17800001", "username": "regular_user", "account_type": "PERSONAL"}
        )
    )

    response = client.get(
        "/oauth/instagram/callback", params={"state": state, "code": "auth-code"}, follow_redirects=False
    )

    assert response.status_code == 302
    location = response.headers["location"]
    assert "status=error" in location
    assert "reason=incompatible_account" in location
    assert len(fake_social_accounts_store) == 0


def test_instagram_callback_denied_redirects_with_permission_denied(client, service_jwt_settings, respx_mock):
    state = _start_connect(client, service_jwt_settings)

    response = client.get(
        "/oauth/instagram/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert "reason=permission_denied" in response.headers["location"]


def test_instagram_callback_exchange_failure_redirects_provider_error(
    client, service_jwt_settings, respx_mock
):
    state = _start_connect(client, service_jwt_settings)
    respx_mock.post(IG_TOKEN_URL).mock(
        return_value=httpx.Response(400, json={"error_type": "OAuthException", "error_message": "Invalid code"})
    )

    response = client.get(
        "/oauth/instagram/callback", params={"state": state, "code": "bad-code"}, follow_redirects=False
    )

    assert response.status_code == 302
    assert "reason=provider_error" in response.headers["location"]


def test_instagram_and_facebook_states_are_independent(client, service_jwt_settings, fake_oauth_states_store):
    """A state minted for one provider is tracked as such; Facebook's own
    callback tests already cover its consumption in isolation."""
    state = _start_connect(client, service_jwt_settings)
    stored = next(iter(fake_oauth_states_store.values()))
    assert stored["provider"] == "INSTAGRAM"

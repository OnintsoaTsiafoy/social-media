"""Sprint 06 Day 3: GET /oauth/facebook/callback."""
import httpx

from tests.conftest import META_BASE_URL, make_service_jwt


def _start_connect(client, service_jwt_settings) -> str:
    response = client.post(
        "/internal/v1/oauth/facebook/authorization-url",
        json={
            "userId": "11111111-1111-1111-1111-111111111111",
            "brandId": "22222222-2222-2222-2222-222222222222",
            "mobileRedirectUri": "hootly://oauth/callback",
        },
        headers={"Authorization": f"Bearer {make_service_jwt()}"},
    )
    return response.json()["state"]


def _mock_full_exchange(respx_mock, *, pages, permissions=None, instagram_by_page=None):
    respx_mock.get(f"{META_BASE_URL}/oauth/access_token").mock(
        side_effect=[
            httpx.Response(200, json={"access_token": "short-lived-user-token"}),
            httpx.Response(200, json={"access_token": "long-lived-user-token"}),
        ]
    )
    respx_mock.get(f"{META_BASE_URL}/me/accounts").mock(
        return_value=httpx.Response(200, json={"data": pages})
    )
    respx_mock.get(f"{META_BASE_URL}/me/permissions").mock(
        return_value=httpx.Response(200, json={"data": permissions or []})
    )
    instagram_by_page = instagram_by_page or {}
    for page in pages:
        ig = instagram_by_page.get(page["id"])
        respx_mock.get(f"{META_BASE_URL}/{page['id']}").mock(
            return_value=httpx.Response(
                200, json={"instagram_business_account": ig} if ig else {}
            )
        )


def test_callback_missing_state_is_a_json_error(client, service_jwt_settings, respx_mock):
    response = client.get("/oauth/facebook/callback", follow_redirects=False)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "OAUTH_STATE_INVALID"


def test_callback_unknown_or_reused_state_is_a_json_error(client, service_jwt_settings, respx_mock):
    response = client.get(
        "/oauth/facebook/callback",
        params={"state": "never-issued", "code": "abc"},
        follow_redirects=False,
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "OAUTH_STATE_INVALID"


def test_callback_provider_denied_redirects_with_permission_denied(
    client, service_jwt_settings, respx_mock
):
    state = _start_connect(client, service_jwt_settings)

    response = client.get(
        "/oauth/facebook/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith("hootly://oauth/callback?")
    assert "status=error" in location
    assert "reason=permission_denied" in location


def test_callback_state_is_single_use(client, service_jwt_settings, respx_mock):
    state = _start_connect(client, service_jwt_settings)

    first = client.get(
        "/oauth/facebook/callback", params={"state": state, "error": "access_denied"}, follow_redirects=False
    )
    second = client.get(
        "/oauth/facebook/callback", params={"state": state, "error": "access_denied"}, follow_redirects=False
    )

    assert first.status_code == 302
    assert second.status_code == 400
    assert second.json()["error"]["code"] == "OAUTH_STATE_INVALID"


def test_callback_no_eligible_pages_redirects_incompatible_account(
    client, service_jwt_settings, respx_mock
):
    state = _start_connect(client, service_jwt_settings)
    _mock_full_exchange(respx_mock, pages=[])

    response = client.get(
        "/oauth/facebook/callback", params={"state": state, "code": "auth-code"}, follow_redirects=False
    )

    assert response.status_code == 302
    assert "reason=incompatible_account" in response.headers["location"]


def test_callback_provider_error_during_exchange_redirects_provider_error(
    client, service_jwt_settings, respx_mock
):
    state = _start_connect(client, service_jwt_settings)
    respx_mock.get(f"{META_BASE_URL}/oauth/access_token").mock(
        return_value=httpx.Response(400, json={"error": {"message": "Invalid code", "code": 100}})
    )

    response = client.get(
        "/oauth/facebook/callback", params={"state": state, "code": "bad-code"}, follow_redirects=False
    )

    assert response.status_code == 302
    assert "reason=provider_error" in response.headers["location"]


def test_callback_nominal_links_page_and_encrypts_token(
    client,
    service_jwt_settings,
    respx_mock,
    fake_social_accounts_store,
    fake_oauth_tokens_store,
    fake_social_permissions_store,
):
    state = _start_connect(client, service_jwt_settings)
    _mock_full_exchange(
        respx_mock,
        pages=[
            {
                "id": "page-1",
                "name": "Studio Vega",
                "access_token": "page-1-token",
                "tasks": ["MANAGE", "CREATE_CONTENT"],
            }
        ],
        permissions=[{"permission": "pages_show_list", "status": "granted"}],
    )

    response = client.get(
        "/oauth/facebook/callback", params={"state": state, "code": "auth-code"}, follow_redirects=False
    )

    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith("hootly://oauth/callback?")
    assert "status=success" in location
    assert "network=facebook" in location

    assert len(fake_social_accounts_store) == 1
    account = next(iter(fake_social_accounts_store.values()))
    assert account["provider"] == "FACEBOOK"
    assert account["name"] == "Studio Vega"
    assert account["auth_method"] == "FACEBOOK_PAGE"

    stored_token = next(iter(fake_oauth_tokens_store.values()))
    assert stored_token["access_token"] == "page-1-token"  # never the raw Meta token logged/exposed elsewhere

    stored_permissions = next(iter(fake_social_permissions_store.values()))
    assert stored_permissions == [{"permission": "pages_show_list", "status": "GRANTED"}]


def test_callback_also_links_page_linked_instagram_account(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store
):
    state = _start_connect(client, service_jwt_settings)
    _mock_full_exchange(
        respx_mock,
        pages=[{"id": "page-1", "name": "Studio Vega", "access_token": "page-1-token"}],
        instagram_by_page={
            "page-1": {"id": "ig-1", "username": "studiovega", "name": "Studio Vega"}
        },
    )

    response = client.get(
        "/oauth/facebook/callback", params={"state": state, "code": "auth-code"}, follow_redirects=False
    )

    assert response.status_code == 302
    assert len(fake_social_accounts_store) == 2
    providers = {account["provider"] for account in fake_social_accounts_store.values()}
    assert providers == {"FACEBOOK", "INSTAGRAM"}
    ig_account = next(a for a in fake_social_accounts_store.values() if a["provider"] == "INSTAGRAM")
    assert ig_account["username"] == "studiovega"
    assert ig_account["auth_method"] == "FACEBOOK_PAGE"

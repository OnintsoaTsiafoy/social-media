"""Sprint 06 Day 4: refresh-token / permissions / revoke / profile."""
from tests.conftest import META_BASE_URL, make_service_jwt

ACCOUNT_ID = "account-1"


def _auth_header(**kwargs) -> dict:
    return {"Authorization": f"Bearer {make_service_jwt(**kwargs)}"}


def _seed_account(fake_social_accounts_store, fake_oauth_tokens_store, **overrides):
    account = {
        "id": ACCOUNT_ID,
        "brand_id": "brand-1",
        "provider": "FACEBOOK",
        "external_account_id": "page-1",
        "name": "Studio Vega",
        "username": None,
        "status": "CONNECTED",
        "auth_method": "FACEBOOK_PAGE",
        "connected_by_user_id": "user-1",
    }
    account.update(overrides)
    fake_social_accounts_store[(account["provider"], account["external_account_id"])] = account
    fake_oauth_tokens_store[ACCOUNT_ID] = {
        "access_token": "page-1-token",
        "refresh_token": None,
        "scope": [],
        "expires_at": None,
    }
    return account


def test_refresh_token_unknown_account_is_404(client, service_jwt_settings):
    response = client.post(
        f"/internal/v1/social-accounts/does-not-exist/refresh-token", headers=_auth_header()
    )

    assert response.status_code == 404


def test_refresh_token_nominal(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    import httpx

    from tests.conftest import META_BASE_URL

    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    # Un jeton de PAGE se revalide avec `me` (la page elle-même). `me/permissions`
    # est une arête de l'utilisateur : Meta la refuse à un jeton de page.
    me_route = respx_mock.get(f"{META_BASE_URL}/me").mock(
        return_value=httpx.Response(200, json={"id": "page-1", "name": "Studio Vega"})
    )

    response = client.post(f"/internal/v1/social-accounts/{ACCOUNT_ID}/refresh-token", headers=_auth_header())

    assert response.status_code == 200
    body = response.json()
    assert body["socialAccountId"] == ACCOUNT_ID
    assert body["status"] == "CONNECTED"
    assert body["refreshed"] is True
    assert me_route.call_count == 1
    assert respx_mock.calls.call_count == 1  # rien d'autre que `me` (surtout pas me/permissions)


def test_responses_accept_the_uuid_ids_the_real_database_returns():
    """psycopg renvoie `id` en UUID : la construction de la réponse ne doit pas
    échouer (elle répondait 500 en réel, alors que les tests semaient des str)."""
    import uuid

    from modules.oauth.schemas import ProfileResponse, RefreshTokenResponse

    account_id = uuid.uuid4()
    refreshed = RefreshTokenResponse(social_account_id=account_id, status="CONNECTED", expires_at=None, refreshed=True)
    profile = ProfileResponse(social_account_id=account_id, name="Studio Vega")

    assert refreshed.model_dump(by_alias=True)["socialAccountId"] == str(account_id)
    assert profile.model_dump(by_alias=True)["socialAccountId"] == str(account_id)


def test_refresh_token_heals_a_page_wrongly_flagged_for_reauth(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    """Une page marquée à reconnecter alors que son jeton reste valide (l'ancienne
    revalidation via me/permissions échouait toujours) redevient CONNECTED."""
    import httpx

    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store, status="REAUTH_REQUIRED")
    respx_mock.get(f"{META_BASE_URL}/me").mock(
        return_value=httpx.Response(200, json={"id": "page-1", "name": "Studio Vega"})
    )

    response = client.post(f"/internal/v1/social-accounts/{ACCOUNT_ID}/refresh-token", headers=_auth_header())

    assert response.status_code == 200
    assert fake_social_accounts_store[("FACEBOOK", "page-1")]["status"] == "CONNECTED"


def test_refresh_token_without_stored_token_requires_reauth(
    client, service_jwt_settings, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    del fake_oauth_tokens_store[ACCOUNT_ID]  # token missing/already revoked

    response = client.post(f"/internal/v1/social-accounts/{ACCOUNT_ID}/refresh-token", headers=_auth_header())

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "REAUTHENTICATION_REQUIRED"
    assert fake_social_accounts_store[("FACEBOOK", "page-1")]["status"] == "REAUTH_REQUIRED"


def test_refresh_token_meta_rejects_it_requires_reauth(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    import httpx

    from tests.conftest import META_BASE_URL

    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/me").mock(
        return_value=httpx.Response(401, json={"error": {"message": "Invalid token", "code": 190}})
    )

    response = client.post(f"/internal/v1/social-accounts/{ACCOUNT_ID}/refresh-token", headers=_auth_header())

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "REAUTHENTICATION_REQUIRED"
    assert fake_social_accounts_store[("FACEBOOK", "page-1")]["status"] == "REAUTH_REQUIRED"


def test_refresh_token_invalid_token_as_meta_really_sends_it_requires_reauth(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    """Meta répond à un jeton invalide par HTTP 400 + code 190 (pas 401)."""
    import httpx

    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/me").mock(
        return_value=httpx.Response(
            400, json={"error": {"message": "Error validating access token", "type": "OAuthException", "code": 190}}
        )
    )

    response = client.post(f"/internal/v1/social-accounts/{ACCOUNT_ID}/refresh-token", headers=_auth_header())

    assert response.status_code == 409
    assert fake_social_accounts_store[("FACEBOOK", "page-1")]["status"] == "REAUTH_REQUIRED"


def test_refresh_token_meta_outage_does_not_flag_a_healthy_page(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    """Une panne ou une limite de débit de Meta ne dit rien de la validité du
    jeton : l'erreur remonte telle quelle, sans exiger de reconnexion."""
    import httpx

    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/me").mock(
        return_value=httpx.Response(503, json={"error": {"message": "Service unavailable"}})
    )

    response = client.post(f"/internal/v1/social-accounts/{ACCOUNT_ID}/refresh-token", headers=_auth_header())

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"
    assert fake_social_accounts_store[("FACEBOOK", "page-1")]["status"] == "CONNECTED"


def test_refresh_token_non_token_meta_error_does_not_flag_a_healthy_page(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    """Le cas réel qui a fait passer une page saine en « reconnexion requise » :
    Meta répond 400 « (#100) nonexisting field » (code 100, pas 190)."""
    import httpx

    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/me").mock(
        return_value=httpx.Response(
            400,
            json={"error": {"message": "(#100) Tried accessing nonexisting field", "type": "OAuthException", "code": 100}},
        )
    )

    response = client.post(f"/internal/v1/social-accounts/{ACCOUNT_ID}/refresh-token", headers=_auth_header())

    assert response.status_code == 400
    assert fake_social_accounts_store[("FACEBOOK", "page-1")]["status"] == "CONNECTED"


def test_refresh_token_instagram_login_rotates_the_token(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    """Unlike FACEBOOK_PAGE, an INSTAGRAM_LOGIN token genuinely expires (~60
    days) and must be actively rotated, not just revalidated."""
    import httpx

    IG_GRAPH_HOST = "https://graph.instagram.com/v25.0"

    _seed_account(
        fake_social_accounts_store,
        fake_oauth_tokens_store,
        provider="INSTAGRAM",
        external_account_id="ig-creator-1",
        auth_method="INSTAGRAM_LOGIN",
    )
    respx_mock.get(f"{IG_GRAPH_HOST}/refresh_access_token").mock(
        return_value=httpx.Response(200, json={"access_token": "rotated-ig-token", "expires_in": 5184000})
    )

    response = client.post(f"/internal/v1/social-accounts/{ACCOUNT_ID}/refresh-token", headers=_auth_header())

    assert response.status_code == 200
    body = response.json()
    assert body["socialAccountId"] == ACCOUNT_ID
    assert body["status"] == "CONNECTED"
    assert body["refreshed"] is True
    assert body["expiresAt"] is not None
    assert fake_oauth_tokens_store[ACCOUNT_ID]["access_token"] == "rotated-ig-token"
    assert fake_social_accounts_store[("INSTAGRAM", "ig-creator-1")]["status"] == "CONNECTED"


def test_refresh_token_instagram_login_rejected_requires_reauth(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    import httpx

    IG_GRAPH_HOST = "https://graph.instagram.com/v25.0"

    _seed_account(
        fake_social_accounts_store,
        fake_oauth_tokens_store,
        provider="INSTAGRAM",
        external_account_id="ig-creator-2",
        auth_method="INSTAGRAM_LOGIN",
    )
    respx_mock.get(f"{IG_GRAPH_HOST}/refresh_access_token").mock(
        return_value=httpx.Response(400, json={"error_message": "Invalid or expired token"})
    )

    response = client.post(f"/internal/v1/social-accounts/{ACCOUNT_ID}/refresh-token", headers=_auth_header())

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "REAUTHENTICATION_REQUIRED"
    assert fake_social_accounts_store[("INSTAGRAM", "ig-creator-2")]["status"] == "REAUTH_REQUIRED"


def test_get_profile_refreshes_a_facebook_page_account(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    """`refresh-token` only revalidates the token; `/profile` is the only
    route that keeps name/avatar current after a Page rename."""
    import httpx

    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/page-1").mock(
        return_value=httpx.Response(
            200, json={"name": "Studio Vega Renamed", "picture": {"data": {"url": "https://example.com/new.jpg"}}}
        )
    )

    response = client.get(f"/internal/v1/social-accounts/{ACCOUNT_ID}/profile", headers=_auth_header())

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Studio Vega Renamed"
    assert body["avatarUrl"] == "https://example.com/new.jpg"
    assert fake_social_accounts_store[("FACEBOOK", "page-1")]["name"] == "Studio Vega Renamed"


def test_get_profile_refreshes_an_instagram_login_account(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    import httpx

    IG_GRAPH_HOST = "https://graph.instagram.com/v25.0"

    _seed_account(
        fake_social_accounts_store,
        fake_oauth_tokens_store,
        provider="INSTAGRAM",
        external_account_id="ig-creator-3",
        auth_method="INSTAGRAM_LOGIN",
    )
    respx_mock.get(f"{IG_GRAPH_HOST}/ig-creator-3").mock(
        return_value=httpx.Response(
            200, json={"username": "new_handle", "name": "Creator", "profile_picture_url": "https://example.com/p.jpg"}
        )
    )

    response = client.get(f"/internal/v1/social-accounts/{ACCOUNT_ID}/profile", headers=_auth_header())

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "new_handle"
    assert fake_social_accounts_store[("INSTAGRAM", "ig-creator-3")]["username"] == "new_handle"


def test_get_profile_refreshes_an_instagram_linked_via_page_account(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    """Distinct branch from INSTAGRAM_LOGIN: an Instagram account discovered
    through a Facebook Page reuses the Page's own token and Meta host."""
    import httpx

    _seed_account(
        fake_social_accounts_store,
        fake_oauth_tokens_store,
        provider="INSTAGRAM",
        external_account_id="ig-linked-1",
        auth_method="FACEBOOK_PAGE",
    )
    respx_mock.get(f"{META_BASE_URL}/ig-linked-1").mock(
        return_value=httpx.Response(
            200, json={"username": "linked_handle", "name": "Linked Account", "profile_picture_url": "https://example.com/l.jpg"}
        )
    )

    response = client.get(f"/internal/v1/social-accounts/{ACCOUNT_ID}/profile", headers=_auth_header())

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "linked_handle"
    assert fake_social_accounts_store[("INSTAGRAM", "ig-linked-1")]["username"] == "linked_handle"


def test_get_profile_meta_rejects_it_requires_reauth(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    import httpx

    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/page-1").mock(
        return_value=httpx.Response(401, json={"error": {"message": "Invalid token", "code": 190}})
    )

    response = client.get(f"/internal/v1/social-accounts/{ACCOUNT_ID}/profile", headers=_auth_header())

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "REAUTHENTICATION_REQUIRED"
    assert fake_social_accounts_store[("FACEBOOK", "page-1")]["status"] == "REAUTH_REQUIRED"


def test_get_profile_meta_outage_does_not_flag_a_healthy_page(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    import httpx

    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/page-1").mock(
        return_value=httpx.Response(503, json={"error": {"message": "Service unavailable"}})
    )

    response = client.get(f"/internal/v1/social-accounts/{ACCOUNT_ID}/profile", headers=_auth_header())

    assert response.status_code == 503
    assert fake_social_accounts_store[("FACEBOOK", "page-1")]["status"] == "CONNECTED"


def test_get_permissions_reports_missing_required_ones(
    client, service_jwt_settings, fake_social_accounts_store, fake_oauth_tokens_store, fake_social_permissions_store
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    fake_social_permissions_store[ACCOUNT_ID] = [
        {"permission": "pages_show_list", "status": "GRANTED"},
        {"permission": "pages_manage_posts", "status": "DECLINED"},
    ]

    response = client.get(f"/internal/v1/social-accounts/{ACCOUNT_ID}/permissions", headers=_auth_header(scope=["social:read"]))

    assert response.status_code == 200
    body = response.json()
    assert body["permissions"] == ["pages_show_list"]
    assert "pages_manage_posts" in body["missingRequiredPermissions"]
    assert "pages_read_engagement" in body["missingRequiredPermissions"]


def test_revoke_marks_account_disconnected_and_clears_token(
    client, service_jwt_settings, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)

    response = client.post(f"/internal/v1/social-accounts/{ACCOUNT_ID}/revoke", headers=_auth_header())

    assert response.status_code == 200
    assert response.json()["status"] == "DISCONNECTED"
    assert fake_social_accounts_store[("FACEBOOK", "page-1")]["status"] == "DISCONNECTED"
    assert ACCOUNT_ID not in fake_oauth_tokens_store


def test_social_account_routes_require_service_jwt(client, service_jwt_settings, fake_social_accounts_store, fake_oauth_tokens_store):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)

    assert client.post(f"/internal/v1/social-accounts/{ACCOUNT_ID}/refresh-token").status_code == 401
    assert client.get(f"/internal/v1/social-accounts/{ACCOUNT_ID}/permissions").status_code == 401
    assert client.post(f"/internal/v1/social-accounts/{ACCOUNT_ID}/revoke").status_code == 401
    assert client.get(f"/internal/v1/social-accounts/{ACCOUNT_ID}/profile").status_code == 401

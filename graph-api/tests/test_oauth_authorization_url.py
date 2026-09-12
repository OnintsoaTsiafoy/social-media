"""Sprint 06 Day 2: POST /internal/v1/oauth/{provider}/authorization-url."""
from tests.conftest import make_service_jwt

BODY = {
    "userId": "11111111-1111-1111-1111-111111111111",
    "brandId": "22222222-2222-2222-2222-222222222222",
    "mobileRedirectUri": "hootly://oauth/callback",
}


def _auth_header(**kwargs) -> dict:
    return {"Authorization": f"Bearer {make_service_jwt(**kwargs)}"}


def test_authorization_url_nominal(client, service_jwt_settings, fake_oauth_states_store):
    response = client.post(
        "/internal/v1/oauth/facebook/authorization-url",
        json=BODY,
        headers=_auth_header(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["authorizationUrl"].startswith("https://www.facebook.com/v25.0/dialog/oauth?")
    assert "client_id=test-app-id" in body["authorizationUrl"]
    assert "state=" in body["authorizationUrl"]
    assert body["state"]
    assert len(fake_oauth_states_store) == 1


def test_authorization_url_state_is_single_use(client, service_jwt_settings, fake_oauth_states_store):
    """Each call mints a brand-new state; the state itself is consumed at
    most once by the callback (test_oauth_callback.py)."""
    first = client.post(
        "/internal/v1/oauth/facebook/authorization-url", json=BODY, headers=_auth_header()
    ).json()
    second = client.post(
        "/internal/v1/oauth/facebook/authorization-url", json=BODY, headers=_auth_header()
    ).json()

    assert first["state"] != second["state"]
    assert len(fake_oauth_states_store) == 2


def test_authorization_url_rejects_unsupported_provider(client, service_jwt_settings):
    response = client.post(
        "/internal/v1/oauth/twitter/authorization-url",
        json=BODY,
        headers=_auth_header(),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PROVIDER_NOT_SUPPORTED"


def test_authorization_url_instagram_direct_login(client, service_jwt_settings, fake_oauth_states_store):
    """Sprint 07: Instagram Login (direct, no Facebook Page) is now supported."""
    response = client.post(
        "/internal/v1/oauth/instagram/authorization-url",
        json=BODY,
        headers=_auth_header(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["authorizationUrl"].startswith("https://www.instagram.com/oauth/authorize?")
    assert "client_id=test-ig-app-id" in body["authorizationUrl"]


def test_authorization_url_instagram_503_without_instagram_app_configured(
    client, service_jwt_settings, monkeypatch
):
    from core.config import settings

    monkeypatch.setattr(settings, "instagram_app_id", None)

    response = client.post(
        "/internal/v1/oauth/instagram/authorization-url", json=BODY, headers=_auth_header()
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "OAUTH_CONFIGURATION_ERROR"


def test_authorization_url_requires_service_jwt(client, service_jwt_settings):
    response = client.post("/internal/v1/oauth/facebook/authorization-url", json=BODY)

    assert response.status_code == 401


def test_authorization_url_503_without_meta_configuration(client, service_jwt_settings, monkeypatch):
    from core.config import settings

    monkeypatch.setattr(settings, "facebook_app_id", None)

    response = client.post(
        "/internal/v1/oauth/facebook/authorization-url", json=BODY, headers=_auth_header()
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "OAUTH_CONFIGURATION_ERROR"


def test_authorization_url_503_without_app_secret(client, service_jwt_settings, monkeypatch):
    """meta_configured alone isn't enough for OAuth — the app secret is
    needed for the code exchange, checked eagerly rather than failing later
    mid-flow at the callback."""
    from core.config import settings

    monkeypatch.setattr(settings, "facebook_app_secret", None)

    response = client.post(
        "/internal/v1/oauth/facebook/authorization-url", json=BODY, headers=_auth_header()
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "OAUTH_CONFIGURATION_ERROR"

"""Sprint 05 Day 4: network errors, timeouts, 429/Retry-After and token redaction."""
import httpx
import pytest

from modules.facebook.clients.facebook_client import _redact_url
from tests.conftest import META_BASE_URL, PAGE_ID


@pytest.fixture
def client(authenticated_client):
    """`/facebook/*` exige un JWT de service depuis qu'elles ont ete fermees ;
    le refus sans jeton est teste dans tests/test_facebook_auth.py."""
    return authenticated_client


def test_redact_url_hides_access_token():
    url = "https://graph.facebook.com/v25.0/123/posts?fields=id&access_token=SECRET123"

    redacted = _redact_url(url)

    assert "SECRET123" not in redacted
    assert "access_token=" in redacted


def test_redact_url_is_a_noop_without_a_token():
    url = "https://graph.facebook.com/v25.0/123/posts?fields=id"

    assert _redact_url(url) == url


def test_timeout_returns_a_stable_504_instead_of_crashing(client, respx_mock):
    """Fixed Sprint 05 Day 4: no bare httpx call is left unguarded anymore."""
    respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/posts").mock(side_effect=httpx.ConnectTimeout("boom"))

    response = client.get("/facebook/posts")

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "provider_timeout"


def test_connection_error_returns_a_stable_503_instead_of_crashing(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/posts").mock(side_effect=httpx.ConnectError("boom"))

    response = client.get("/facebook/posts")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"


def test_rate_limited_response_surfaces_retry_after_header(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/posts").mock(
        return_value=httpx.Response(
            429,
            headers={"Retry-After": "30"},
            json={"error": {"message": "Application request limit reached", "code": 4}},
        )
    )

    response = client.get("/facebook/posts")

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limited"
    assert response.headers["retry-after"] == "30"


def test_rate_limited_response_without_header_gets_a_documented_default(client, respx_mock):
    """Meta's exact rate-limit header format for this app isn't verified yet
    (flagged as an open Meta fact); a conservative fixed fallback is used
    instead of silently omitting Retry-After."""
    respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/posts").mock(
        return_value=httpx.Response(429, json={"error": {"message": "Rate limited", "code": 4}})
    )

    response = client.get("/facebook/posts")

    assert response.status_code == 429
    assert response.headers["retry-after"] == "60"


def test_invalid_json_response_is_reported_as_provider_unavailable(client, respx_mock):
    respx_mock.get(f"{META_BASE_URL}/{PAGE_ID}/posts").mock(
        return_value=httpx.Response(200, content=b"not-json")
    )

    response = client.get("/facebook/posts")

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "provider_unavailable"

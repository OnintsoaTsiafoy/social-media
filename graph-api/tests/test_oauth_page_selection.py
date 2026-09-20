"""Liaison d'une page Facebook pilotée par un administrateur de la plateforme.

Le compte Facebook qui autorise gère souvent beaucoup de pages (agence) : rien
n'est lié d'office. Le retour de Meta propose les pages, l'administrateur choisit.
"""
import httpx
import pytest

from tests.conftest import META_BASE_URL, make_service_jwt

TARGET_USER = "11111111-1111-1111-1111-111111111111"
BRAND = "22222222-2222-2222-2222-222222222222"
ADMIN = "33333333-3333-3333-3333-333333333333"
CONSOLE_URL = "http://localhost:5173/#/pages"

PAGES = [
    {"id": "page-1", "name": "Studio Vega", "access_token": "page-1-token", "tasks": ["MANAGE"],
     "picture": {"data": {"url": "https://cdn.example/vega.jpg"}}},
    {"id": "page-2", "name": "Client Lointain", "access_token": "page-2-token", "tasks": ["MANAGE"]},
]
PERMISSIONS = [{"permission": "pages_show_list", "status": "granted"}]


def _auth(**kwargs) -> dict:
    return {"Authorization": f"Bearer {make_service_jwt(**kwargs)}"}


def _start(client, *, provider="facebook", select_pages=True) -> str:
    response = client.post(
        f"/internal/v1/oauth/{provider}/authorization-url",
        json={
            "userId": TARGET_USER,
            "brandId": BRAND,
            "mobileRedirectUri": CONSOLE_URL,
            "selectPages": select_pages,
            "initiatedByUserId": ADMIN,
        },
        headers=_auth(),
    )
    assert response.status_code == 200, response.text
    return response.json()["state"]


def _mock_meta(respx_mock, *, pages=PAGES, instagram_by_page=None, instagram_error_for=()):
    respx_mock.get(f"{META_BASE_URL}/oauth/access_token").mock(
        side_effect=[
            httpx.Response(200, json={"access_token": "short-lived-user-token"}),
            httpx.Response(200, json={"access_token": "long-lived-user-token"}),
        ]
    )
    respx_mock.get(f"{META_BASE_URL}/me/accounts").mock(return_value=httpx.Response(200, json={"data": pages}))
    respx_mock.get(f"{META_BASE_URL}/me/permissions").mock(
        return_value=httpx.Response(200, json={"data": PERMISSIONS})
    )
    instagram_by_page = instagram_by_page or {}
    for page in pages:
        if page["id"] in instagram_error_for:
            respx_mock.get(f"{META_BASE_URL}/{page['id']}").mock(
                return_value=httpx.Response(500, json={"error": {"message": "boom", "code": 1}})
            )
            continue
        ig = instagram_by_page.get(page["id"])
        respx_mock.get(f"{META_BASE_URL}/{page['id']}").mock(
            return_value=httpx.Response(200, json={"instagram_business_account": ig} if ig else {})
        )


def _callback(client, state):
    return client.get("/oauth/facebook/callback", params={"state": state, "code": "auth-code"}, follow_redirects=False)


def _selection_id(location: str) -> str:
    return location.split("selection=")[1].split("&")[0]


# --- Démarrage ---------------------------------------------------------------------------------


def test_authorization_url_records_that_an_admin_will_choose_the_pages(
    client, service_jwt_settings, fake_oauth_states_store
):
    _start(client)

    state = next(iter(fake_oauth_states_store.values()))
    assert state["select_pages"] is True
    assert state["initiated_by_user_id"] == ADMIN
    assert state["user_id"] == TARGET_USER  # le compte utilisateur, pas l'administrateur


def test_mobile_flow_keeps_linking_everything_by_default(client, service_jwt_settings, fake_oauth_states_store):
    _start(client, select_pages=False)
    state = next(iter(fake_oauth_states_store.values()))
    assert state["select_pages"] is False
    assert state["initiated_by_user_id"] == ADMIN  # facultatif : transmis tel quel


def test_choosing_pages_is_facebook_only(client, service_jwt_settings):
    response = client.post(
        "/internal/v1/oauth/instagram/authorization-url",
        json={"userId": TARGET_USER, "brandId": BRAND, "mobileRedirectUri": CONSOLE_URL, "selectPages": True},
        headers=_auth(),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_failed"


# --- Retour de Meta ---------------------------------------------------------------------------


def test_callback_proposes_pages_and_links_nothing(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_oauth_selections_store,
):
    state = _start(client)
    _mock_meta(respx_mock)

    response = _callback(client, state)

    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith(f"{CONSOLE_URL}?")
    assert "status=select" in location and "network=facebook" in location
    assert "selection=" in location

    # Rien n'est lié tant que l'administrateur n'a pas choisi.
    assert fake_social_accounts_store == {}
    assert fake_oauth_tokens_store == {}

    selection = fake_oauth_selections_store[_selection_id(location)]
    assert selection["user_id"] == TARGET_USER and selection["brand_id"] == BRAND
    assert selection["initiated_by_user_id"] == ADMIN
    assert [page["id"] for page in selection["payload"]["pages"]] == ["page-1", "page-2"]

    # Aucun jeton dans l'URL renvoyée au navigateur.
    assert "token" not in location


def test_callback_still_redirects_errors_to_the_console(client, service_jwt_settings, respx_mock):
    state = _start(client)
    response = client.get(
        "/oauth/facebook/callback", params={"state": state, "error": "access_denied"}, follow_redirects=False
    )
    assert response.status_code == 302
    assert response.headers["location"].startswith(f"{CONSOLE_URL}?")
    assert "reason=permission_denied" in response.headers["location"]


def test_callback_without_eligible_pages_is_an_incompatible_account(
    client, service_jwt_settings, respx_mock, fake_oauth_selections_store
):
    state = _start(client)
    _mock_meta(respx_mock, pages=[])

    response = _callback(client, state)

    assert "reason=incompatible_account" in response.headers["location"]
    assert fake_oauth_selections_store == {}


def test_a_page_without_token_is_not_proposed(client, service_jwt_settings, respx_mock, fake_oauth_selections_store):
    state = _start(client)
    _mock_meta(respx_mock, pages=[{"id": "page-1", "name": "Sans jeton"}, PAGES[1]])

    _callback(client, state)

    selection = next(iter(fake_oauth_selections_store.values()))
    assert [page["id"] for page in selection["payload"]["pages"]] == ["page-2"]


def test_an_unreadable_instagram_account_does_not_block_the_choice(
    client, service_jwt_settings, respx_mock, fake_oauth_selections_store
):
    state = _start(client)
    _mock_meta(respx_mock, instagram_error_for=("page-1",))

    response = _callback(client, state)

    assert "status=select" in response.headers["location"]
    selection = next(iter(fake_oauth_selections_store.values()))
    assert len(selection["payload"]["pages"]) == 2
    assert selection["payload"]["pages"][0]["instagram"] is None


# --- Lecture de la sélection ---------------------------------------------------------------------


def _proposed(client, respx_mock, **meta) -> str:
    state = _start(client)
    _mock_meta(respx_mock, **meta)
    return _selection_id(_callback(client, state).headers["location"])


def test_reading_a_selection_returns_pages_without_any_token(client, service_jwt_settings, respx_mock):
    selection_id = _proposed(
        client, respx_mock, instagram_by_page={"page-1": {"id": "ig-1", "username": "studiovega", "name": "Vega"}}
    )

    response = client.get(f"/internal/v1/oauth/selections/{selection_id}", headers=_auth())

    assert response.status_code == 200
    body = response.json()
    assert body["userId"] == TARGET_USER and body["brandId"] == BRAND and body["initiatedByUserId"] == ADMIN
    assert [page["externalId"] for page in body["pages"]] == ["page-1", "page-2"]
    assert body["pages"][0]["name"] == "Studio Vega"
    assert body["pages"][0]["pictureUrl"] == "https://cdn.example/vega.jpg"
    assert body["pages"][0]["instagram"] == {"externalId": "ig-1", "username": "studiovega", "name": "Vega"}
    assert body["pages"][1]["instagram"] is None
    assert "page-1-token" not in response.text and "accessToken" not in response.text


def test_selection_routes_require_a_service_token_with_the_right_scope(client, service_jwt_settings, respx_mock):
    selection_id = _proposed(client, respx_mock)

    assert client.get(f"/internal/v1/oauth/selections/{selection_id}").status_code == 401
    # Lire ne demande que « social:read » ; lier demande « social:write ».
    read_only = _auth(scope=("social:read",))
    assert client.get(f"/internal/v1/oauth/selections/{selection_id}", headers=read_only).status_code == 200
    forbidden = client.post(
        f"/internal/v1/oauth/selections/{selection_id}/link", json={"pageIds": ["page-1"]}, headers=read_only
    )
    assert forbidden.status_code == 403
    # Un jeton utilisateur (mobile) n'est jamais accepté.
    assert client.get(
        f"/internal/v1/oauth/selections/{selection_id}", headers=_auth(token_type="access")
    ).status_code in (401, 403)


def test_an_unknown_or_malformed_selection_is_rejected(client, service_jwt_settings):
    missing = client.get("/internal/v1/oauth/selections/99999999-9999-4999-8999-999999999999", headers=_auth())
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"
    assert client.get("/internal/v1/oauth/selections/not-a-uuid", headers=_auth()).status_code == 422


# --- Liaison des pages choisies -----------------------------------------------------------------------


def test_linking_only_the_chosen_page_with_its_instagram(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_social_permissions_store,
):
    selection_id = _proposed(
        client, respx_mock, instagram_by_page={"page-1": {"id": "ig-1", "username": "studiovega", "name": "Vega"}}
    )

    response = client.post(
        f"/internal/v1/oauth/selections/{selection_id}/link", json={"pageIds": ["page-1"]}, headers=_auth()
    )

    assert response.status_code == 200
    accounts = response.json()["accounts"]
    assert [(a["provider"], a["externalAccountId"]) for a in accounts] == [("FACEBOOK", "page-1"), ("INSTAGRAM", "ig-1")]

    # « page-2 » (un autre client de l'agence) n'a JAMAIS été liée.
    assert {key[1] for key in fake_social_accounts_store} == {"page-1", "ig-1"}
    facebook = fake_social_accounts_store[("FACEBOOK", "page-1")]
    assert facebook["brand_id"] == BRAND
    assert facebook["connected_by_user_id"] == TARGET_USER  # le compte utilisateur visé, pas l'administrateur
    assert facebook["auth_method"] == "FACEBOOK_PAGE"
    assert fake_oauth_tokens_store[facebook["id"]]["access_token"] == "page-1-token"
    assert fake_social_permissions_store[facebook["id"]] == [{"permission": "pages_show_list", "status": "GRANTED"}]


def test_a_selection_links_exactly_once(client, service_jwt_settings, respx_mock):
    selection_id = _proposed(client, respx_mock)
    url = f"/internal/v1/oauth/selections/{selection_id}/link"

    first = client.post(url, json={"pageIds": ["page-1"]}, headers=_auth())
    second = client.post(url, json={"pageIds": ["page-1"]}, headers=_auth())

    assert first.status_code == 200
    assert second.status_code == 404
    assert client.get(f"/internal/v1/oauth/selections/{selection_id}", headers=_auth()).status_code == 404


def test_a_page_that_was_not_proposed_is_refused_and_does_not_burn_the_selection(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store
):
    selection_id = _proposed(client, respx_mock)
    url = f"/internal/v1/oauth/selections/{selection_id}/link"

    refused = client.post(url, json={"pageIds": ["page-1", "not-in-the-list"]}, headers=_auth())

    assert refused.status_code == 422
    assert fake_social_accounts_store == {}
    # Corriger la demande reste possible : la sélection n'a pas été consommée.
    assert client.post(url, json={"pageIds": ["page-1"]}, headers=_auth()).status_code == 200


@pytest.mark.parametrize("body", [{}, {"pageIds": []}, {"pageIds": "page-1"}])
def test_the_link_request_needs_at_least_one_page(client, service_jwt_settings, respx_mock, body):
    selection_id = _proposed(client, respx_mock)
    response = client.post(f"/internal/v1/oauth/selections/{selection_id}/link", json=body, headers=_auth())
    assert response.status_code == 422


def test_duplicate_page_ids_link_once(client, service_jwt_settings, respx_mock, fake_social_accounts_store):
    selection_id = _proposed(client, respx_mock)
    response = client.post(
        f"/internal/v1/oauth/selections/{selection_id}/link",
        json={"pageIds": ["page-1", "page-1"]},
        headers=_auth(),
    )
    assert response.status_code == 200
    assert len(response.json()["accounts"]) == 1
    assert len(fake_social_accounts_store) == 1


def test_an_expired_selection_cannot_be_read_or_linked(
    client, service_jwt_settings, respx_mock, fake_oauth_selections_store
):
    from datetime import datetime, timedelta, timezone

    selection_id = _proposed(client, respx_mock)
    fake_oauth_selections_store[selection_id]["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)

    assert client.get(f"/internal/v1/oauth/selections/{selection_id}", headers=_auth()).status_code == 404
    assert client.post(
        f"/internal/v1/oauth/selections/{selection_id}/link", json={"pageIds": ["page-1"]}, headers=_auth()
    ).status_code == 404

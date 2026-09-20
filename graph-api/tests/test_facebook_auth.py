"""Authentification des routes historiques `/facebook/*`.

Ces routes écrivent sur la page Meta configurée dans le `.env` (publier,
modifier, supprimer, répondre) et n'étaient protégées par rien. Elles exigent
désormais le JWT de service, comme `/internal/v1`.

Les fichiers `test_facebook_*.py` décrivent le comportement métier avec un
jeton valide (porté par la fixture `client`) ; ici on ne teste que le refus.
"""

import pytest
from fastapi.testclient import TestClient

from main import app
from tests.conftest import make_service_jwt

# Un appel par méthode, sans en-tête Authorization : la fixture `client` en
# porte un, on construit donc un client nu.
anonymous = TestClient(app)


def _auth_header(**kwargs) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_service_jwt(**kwargs)}"}


def test_read_route_without_authorization_header_is_rejected(configured_settings, service_jwt_settings):
    response = anonymous.get("/facebook/posts")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_write_route_without_authorization_header_is_rejected(configured_settings, service_jwt_settings):
    """Le cas qui comptait : publier sur la page sans aucune identification."""
    response = anonymous.post("/facebook/posts", data={"message": "Bonjour"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_delete_route_without_authorization_header_is_rejected(configured_settings, service_jwt_settings):
    response = anonymous.delete("/facebook/posts/1_1")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_write_route_with_read_only_scope_is_forbidden(configured_settings, service_jwt_settings):
    response = anonymous.post(
        "/facebook/posts",
        data={"message": "Bonjour"},
        headers=_auth_header(scope=["social:read"]),
    )

    assert response.status_code == 403
    assert "social:write" in response.json()["error"]["message"]


def test_read_route_with_write_only_scope_is_forbidden(configured_settings, service_jwt_settings):
    response = anonymous.get("/facebook/posts", headers=_auth_header(scope=["social:write"]))

    assert response.status_code == 403
    assert "social:read" in response.json()["error"]["message"]


def test_user_token_is_rejected(configured_settings, service_jwt_settings):
    """Un JWT mobile, même signé avec le même secret, n'ouvre pas ces routes."""
    response = anonymous.get("/facebook/posts", headers=_auth_header(token_type="access"))

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_token_minted_for_the_ai_service_is_rejected(configured_settings, service_jwt_settings):
    response = anonymous.get("/facebook/posts", headers=_auth_header(audience="ai-service"))

    assert response.status_code == 401


def _facebook_routes():
    """Chaque route montée sous /facebook, avec une méthode qui la déclenche."""
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/facebook"):
            continue
        for method in sorted(getattr(route, "methods", set()) - {"HEAD", "OPTIONS"}):
            yield path, method


@pytest.mark.parametrize("path,method", list(_facebook_routes()))
def test_no_facebook_route_is_reachable_anonymously(
    path, method, configured_settings, service_jwt_settings
):
    """Garde-fou : une route ajoutée plus tard sans dépendance d'authentification
    fait échouer ce test, au lieu d'exposer silencieusement la page Meta."""
    url = path.replace("{post_id}", "1_1").replace("{comment_id}", "c_1").replace("{story_id}", "s_1")

    response = anonymous.request(method, url)

    assert response.status_code == 401, f"{method} {path} répond {response.status_code}"

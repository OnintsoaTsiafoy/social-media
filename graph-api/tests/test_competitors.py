"""Analyse concurrentielle (sprint_listing/PLUS/TODO_ANALYSE_CONCURRENTIELLE_MISE_A_JOUR.md).

Ces routes ont une particularité qu'aucune autre de /internal/v1 ne partage :
elles répondent 200 quand Meta refuse, le refus étant porté par `status`. La
plupart des tests ci-dessous ne vérifient donc pas un code HTTP mais la
traduction du refus — c'est elle qui décide de ce que le produit affichera et
de ce qu'il retentera.
"""
import httpx
import pytest

from modules.competitors.capabilities import classify_meta_failure
from tests.conftest import META_BASE_URL, make_service_jwt

FACEBOOK_ACCOUNT_ID = "fb-account-1"
INSTAGRAM_ACCOUNT_ID = "ig-account-1"
IG_USER_ID = "17841400000000001"
PAGE_ID_OF_BRAND = "page-42"


def _auth_header(**kwargs) -> dict:
    return {"Authorization": f"Bearer {make_service_jwt(**kwargs)}"}


def _seed_facebook(fake_social_accounts_store, fake_oauth_tokens_store):
    fake_social_accounts_store[("FACEBOOK", PAGE_ID_OF_BRAND)] = {
        "id": FACEBOOK_ACCOUNT_ID,
        "brand_id": "brand-1",
        "provider": "FACEBOOK",
        "external_account_id": PAGE_ID_OF_BRAND,
        "name": "Studio Vega",
        "auth_method": "FACEBOOK_PAGE",
        "status": "CONNECTED",
    }
    fake_oauth_tokens_store[FACEBOOK_ACCOUNT_ID] = {"access_token": "page-42-token"}


def _seed_instagram(fake_social_accounts_store, fake_oauth_tokens_store):
    fake_social_accounts_store[("INSTAGRAM", IG_USER_ID)] = {
        "id": INSTAGRAM_ACCOUNT_ID,
        "brand_id": "brand-1",
        "provider": "INSTAGRAM",
        "external_account_id": IG_USER_ID,
        "name": "Studio Vega",
        "auth_method": "FACEBOOK_PAGE",
        "status": "CONNECTED",
    }
    fake_oauth_tokens_store[INSTAGRAM_ACCOUNT_ID] = {"access_token": "ig-token"}


def _profile(client, *, account_id, platform, handle="rival"):
    return client.post(
        "/internal/v1/competitors/profile",
        json={"socialAccountId": account_id, "platform": platform, "handle": handle},
        headers=_auth_header(scope=["social:read"]),
    )


def _posts(client, *, account_id, platform, handle="rival", **extra):
    return client.post(
        "/internal/v1/competitors/posts",
        json={"socialAccountId": account_id, "platform": platform, "handle": handle, **extra},
        headers=_auth_header(scope=["social:read"]),
    )


def _meta_error(code, subcode=None, message="Refus Meta"):
    error = {"message": message, "type": "OAuthException", "code": code}
    if subcode is not None:
        error["error_subcode"] = subcode
    return {"error": error}


# ---------------------------------------------------------------------------
# Classement des refus Meta
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "status_code,code,subcode,expected",
    [
        # Page Public Content Access non approuvé : réparable par une App
        # Review, pas par une nouvelle tentative.
        (400, 10, None, "PERMISSION_REQUIRED"),
        (400, 200, 2018233, "PERMISSION_REQUIRED"),
        (400, 190, None, "PERMISSION_REQUIRED"),
        # Compte personnel, supprimé ou privé.
        (400, 110, None, "UNAVAILABLE"),
        (400, 100, 33, "UNAVAILABLE"),
        (400, None, 2207013, "UNAVAILABLE"),
        (404, None, None, "UNAVAILABLE"),
        # Transitoires : la prochaine exécution retentera.
        (429, None, None, "SYNC_ERROR"),
        (400, 4, None, "SYNC_ERROR"),
        (503, None, None, "SYNC_ERROR"),
        (504, None, None, "SYNC_ERROR"),
        # Inconnu : transitoire par défaut, plutôt que de condamner un
        # concurrent sur une erreur qu'on ne sait pas lire.
        (400, 999, None, "SYNC_ERROR"),
    ],
)
def test_meta_failures_map_to_the_four_competitor_statuses(status_code, code, subcode, expected):
    assert classify_meta_failure(status_code, code, subcode) == expected


# ---------------------------------------------------------------------------
# Instagram — Business Discovery
# ---------------------------------------------------------------------------


def test_instagram_profile_is_resolved_through_business_discovery(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_instagram(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/{IG_USER_ID}").mock(
        return_value=httpx.Response(
            200,
            json={
                "business_discovery": {
                    "id": "17841499999999999",
                    "username": "rival",
                    "name": "Rival Brand",
                    "profile_picture_url": "https://cdn/avatar.jpg",
                    "followers_count": 12000,
                    "media_count": 340,
                }
            },
        )
    )

    response = _profile(client, account_id=INSTAGRAM_ACCOUNT_ID, platform="INSTAGRAM")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ACTIVE"
    assert body["externalId"] == "17841499999999999"
    assert body["followersCount"] == 12000
    assert body["postsCount"] == 340
    assert body["accountType"] == "Compte professionnel"
    # Instagram n'expose pas de partages en Business Discovery : c'est un trou
    # connu, pas une donnée à deviner.
    assert "shares" in body["unavailableFields"]


def test_instagram_personal_account_is_unavailable_not_an_http_error(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_instagram(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/{IG_USER_ID}").mock(
        return_value=httpx.Response(400, json=_meta_error(110, 2207013))
    )

    response = _profile(client, account_id=INSTAGRAM_ACCOUNT_ID, platform="INSTAGRAM")

    # 200 : l'appelant doit persister ce fait, pas le traiter comme une panne.
    assert response.status_code == 200
    assert response.json()["status"] == "UNAVAILABLE"


def test_instagram_response_without_business_discovery_is_unavailable(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_instagram(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/{IG_USER_ID}").mock(return_value=httpx.Response(200, json={"id": IG_USER_ID}))

    response = _profile(client, account_id=INSTAGRAM_ACCOUNT_ID, platform="INSTAGRAM")

    assert response.json()["status"] == "UNAVAILABLE"


def test_instagram_hidden_like_count_is_null_never_zero(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_instagram(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/{IG_USER_ID}").mock(
        return_value=httpx.Response(
            200,
            json={
                "business_discovery": {
                    "media": {
                        "data": [
                            {
                                "id": "ig-post-1",
                                "caption": "Bonjour",
                                # `like_count` absent : le concurrent masque
                                # ses mentions J'aime.
                                "comments_count": 4,
                                "media_type": "IMAGE",
                                "permalink": "https://instagram.com/p/abc",
                                "timestamp": "2026-09-01T10:00:00+0000",
                            }
                        ]
                    }
                }
            },
        )
    )

    body = _posts(client, account_id=INSTAGRAM_ACCOUNT_ID, platform="INSTAGRAM").json()

    assert body["status"] == "ACTIVE"
    post = body["posts"][0]
    assert post["reactionsCount"] is None
    assert post["commentsCount"] == 4
    assert post["sharesCount"] is None
    assert body["unavailableFields"] == ["shares"]


# ---------------------------------------------------------------------------
# Facebook — Page Public Content Access
# ---------------------------------------------------------------------------


def test_facebook_page_without_ppca_is_permission_required(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_facebook(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/rival").mock(
        return_value=httpx.Response(
            400,
            json=_meta_error(10, 2018233, "(#10) To use 'Page Public Content Access', your use of this endpoint must be reviewed."),
        )
    )

    body = _profile(client, account_id=FACEBOOK_ACCOUNT_ID, platform="FACEBOOK").json()

    assert body["status"] == "PERMISSION_REQUIRED"
    assert body["errorMessage"]


def test_facebook_profile_falls_back_to_fan_count_and_reports_missing_fields(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_facebook(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/rival").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "998877",
                "name": "Rival SA",
                "link": "https://facebook.com/rival",
                # Pas de `followers_count` : Meta ne l'expose pas sur toutes
                # les Pages, les mentions J'aime servent alors de repli.
                "fan_count": 4300,
            },
        )
    )

    body = _profile(client, account_id=FACEBOOK_ACCOUNT_ID, platform="FACEBOOK").json()

    assert body["status"] == "ACTIVE"
    assert body["followersCount"] == 4300
    assert body["postsCount"] is None
    # Le total de publications d'une Page n'est pas un champ Graph API.
    assert "postsCount" in body["unavailableFields"]
    assert "avatarUrl" in body["unavailableFields"]
    assert "username" in body["unavailableFields"]


def test_facebook_posts_map_summaries_shares_and_media_type(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_facebook(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/rival/posts").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "998877_1",
                        "message": "Nouveau produit",
                        "created_time": "2026-09-01T10:00:00+0000",
                        "permalink_url": "https://facebook.com/998877_1",
                        "reactions": {"summary": {"total_count": 120}},
                        "comments": {"summary": {"total_count": 18}},
                        "shares": {"count": 7},
                        "attachments": {"data": [{"media_type": "photo"}]},
                    },
                    {
                        # Aucun compteur : Meta ne les rend pas pour ce post.
                        "id": "998877_2",
                        "created_time": "2026-09-02T10:00:00+0000",
                    },
                ]
            },
        )
    )

    body = _posts(client, account_id=FACEBOOK_ACCOUNT_ID, platform="FACEBOOK").json()

    assert body["status"] == "ACTIVE"
    first, second = body["posts"]
    assert (first["reactionsCount"], first["commentsCount"], first["sharesCount"]) == (120, 18, 7)
    assert first["mediaType"] == "photo"
    assert (second["reactionsCount"], second["commentsCount"], second["sharesCount"]) == (None, None, None)


def test_posts_walk_pages_up_to_max_pages(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_facebook(fake_social_accounts_store, fake_oauth_tokens_store)
    pages = [
        httpx.Response(
            200,
            json={
                "data": [{"id": f"p{index}", "created_time": "2026-09-01T10:00:00+0000"}],
                "paging": {"next": "https://next", "cursors": {"after": f"cursor-{index}"}},
            },
        )
        for index in range(4)
    ]
    respx_mock.get(f"{META_BASE_URL}/rival/posts").mock(side_effect=pages)

    body = _posts(client, account_id=FACEBOOK_ACCOUNT_ID, platform="FACEBOOK", maxPages=2).json()

    # Deux pages seulement : la borne existe pour que le coût d'une exécution
    # reste prévisible, pas comme garde-fou théorique.
    assert len(body["posts"]) == 2
    assert body["hasMore"] is True
    assert body["nextCursor"] == "cursor-1"


def test_a_refusal_after_a_first_page_keeps_what_was_already_collected(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_facebook(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/rival/posts").mock(
        side_effect=[
            httpx.Response(
                200,
                json={
                    "data": [{"id": "p0", "created_time": "2026-09-01T10:00:00+0000"}],
                    "paging": {"next": "https://next", "cursors": {"after": "cursor-0"}},
                },
            ),
            httpx.Response(429, json=_meta_error(4)),
        ]
    )

    body = _posts(client, account_id=FACEBOOK_ACCOUNT_ID, platform="FACEBOOK", maxPages=3).json()

    assert body["status"] == "SYNC_ERROR"
    assert len(body["posts"]) == 1
    assert body["hasMore"] is False


# ---------------------------------------------------------------------------
# Audience du compte de la marque
# ---------------------------------------------------------------------------


def test_account_audience_reads_the_brands_own_page_without_ppca(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_facebook(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(f"{META_BASE_URL}/{PAGE_ID_OF_BRAND}").mock(
        return_value=httpx.Response(200, json={"id": PAGE_ID_OF_BRAND, "followers_count": 8400})
    )

    response = client.post(
        "/internal/v1/accounts/audience",
        json={"socialAccountId": FACEBOOK_ACCOUNT_ID},
        headers=_auth_header(scope=["social:read"]),
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "ACTIVE",
        "followersCount": 8400,
        "postsCount": None,
        "errorCode": None,
        "errorMessage": None,
    }


# ---------------------------------------------------------------------------
# Garde-fous d'accès
# ---------------------------------------------------------------------------


def test_competitor_routes_require_the_social_read_scope(client, service_jwt_settings):
    response = client.post(
        "/internal/v1/competitors/profile",
        json={"socialAccountId": FACEBOOK_ACCOUNT_ID, "platform": "FACEBOOK", "handle": "rival"},
        headers=_auth_header(scope=["ai:analyze"]),
    )
    assert response.status_code == 403


def test_an_expired_token_is_a_real_http_error_not_a_competitor_status(
    client, service_jwt_settings, fake_social_accounts_store
):
    # Compte social connu mais sans token actif : le probleme est du cote de la
    # marque, pas du concurrent. Il ne doit donc pas etre enregistre comme un
    # statut sur le concurrent, sinon une reconnexion passerait pour un compte
    # devenu illisible.
    fake_social_accounts_store[("FACEBOOK", PAGE_ID_OF_BRAND)] = {
        "id": FACEBOOK_ACCOUNT_ID,
        "brand_id": "brand-1",
        "provider": "FACEBOOK",
        "external_account_id": PAGE_ID_OF_BRAND,
        "name": "Studio Vega",
        "auth_method": "FACEBOOK_PAGE",
        "status": "EXPIRED",
    }

    response = _profile(client, account_id=FACEBOOK_ACCOUNT_ID, platform="FACEBOOK")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "TOKEN_EXPIRED"


def test_unknown_social_account_is_a_real_http_error(client, service_jwt_settings):
    # Distinction voulue : un compte social inconnu est un défaut d'appel, pas
    # un fait sur le concurrent — il ne doit pas devenir un `status`.
    response = _profile(client, account_id="missing-account", platform="FACEBOOK")
    assert response.status_code == 404


def test_unsupported_platform_is_rejected(
    client, service_jwt_settings, fake_social_accounts_store, fake_oauth_tokens_store
):
    _seed_facebook(fake_social_accounts_store, fake_oauth_tokens_store)
    response = _profile(client, account_id=FACEBOOK_ACCOUNT_ID, platform="TIKTOK")
    assert response.status_code == 422

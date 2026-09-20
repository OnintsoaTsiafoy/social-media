"""Import des publications d'une Page (POST /internal/v1/posts/sync) : synchronisation
initiale, puis incrémentale.

Les faux dépôts (conftest.py) reproduisent les règles du vrai SQL — dédoublonnage par
(compte, identifiant Meta), texte réécrit seulement pour une publication IMPORTED — car
ce sont elles que ces tests vérifient, pas un simple enregistrement d'appels.
"""
from datetime import datetime, timedelta, timezone

import httpx

from tests.conftest import META_BASE_URL, make_service_jwt

ACCOUNT_ID = "fb-account-1"
PAGE_ID = "page-42"
POSTS_URL = f"{META_BASE_URL}/{PAGE_ID}/posts"


def _auth_header(**kwargs) -> dict:
    return {"Authorization": f"Bearer {make_service_jwt(**kwargs)}"}


def _seed_account(fake_social_accounts_store, fake_oauth_tokens_store, *, last_posts_sync_at=None, provider="FACEBOOK"):
    fake_social_accounts_store[(provider, PAGE_ID)] = {
        "id": ACCOUNT_ID,
        "brand_id": "brand-1",
        "provider": provider,
        "external_account_id": PAGE_ID,
        "name": "Studio Vega",
        "auth_method": "FACEBOOK_PAGE",
        "status": "CONNECTED",
        "connected_by_user_id": "user-1",
        "last_posts_sync_at": last_posts_sync_at,
    }
    fake_oauth_tokens_store[ACCOUNT_ID] = {"access_token": "page-42-token"}


def _post(post_id, message="Bonjour", created="2026-01-01T10:00:00+0000", reactions=3, comments=1, shares=None, **extra):
    """Un post tel que Meta le renvoie avec les champs demandés par l'import."""
    post = {
        "id": post_id,
        "created_time": created,
        "permalink_url": f"https://www.facebook.com/{post_id}",
        "reactions": {"data": [], "summary": {"total_count": reactions}},
        "comments": {"data": [], "summary": {"total_count": comments}},
    }
    if message is not None:
        post["message"] = message
    if shares:
        post["shares"] = {"count": shares}
    post.update(extra)
    return post


def _sync(client, cursor=None, provider="facebook"):
    body = {"socialAccountId": ACCOUNT_ID, "provider": provider}
    if cursor:
        body["cursor"] = cursor
    return client.post("/internal/v1/posts/sync", json=body, headers=_auth_header(scope=["social:read"]))


def test_initial_sync_imports_the_whole_history(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_imported_posts_store, fake_social_metrics_store,
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    route = respx_mock.get(POSTS_URL).mock(
        return_value=httpx.Response(
            200,
            json={"data": [_post("p1", "Premier #Promo", shares=2), _post("p2", "Second", reactions=0, comments=0)]},
        )
    )

    response = _sync(client)

    assert response.status_code == 200
    assert response.json() == {
        "mode": "initial", "created": 2, "updated": 0, "unchanged": 0, "skipped": 0, "nextCursor": None, "done": True,
    }
    # Historique complet : aucun `since` envoyé à Meta.
    assert "since" not in route.calls.last.request.url.params
    assert route.calls.last.request.url.params["limit"] == "50"

    stored = fake_imported_posts_store[(ACCOUNT_ID, "p1")]
    assert stored["origin"] == "IMPORTED"
    assert stored["brand_id"] == "brand-1"
    # L'auteur d'une publication importée est l'utilisateur qui a lié la page.
    assert stored["created_by_user_id"] == "user-1"
    assert stored["content"] == "Premier #Promo"
    assert stored["hashtags"] == ["#Promo"]
    assert stored["external_url"] == "https://www.facebook.com/p1"
    assert stored["published_at"] == datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)

    assert fake_social_accounts_store[("FACEBOOK", PAGE_ID)]["last_posts_sync_at"] is not None


def test_first_metrics_snapshot_uses_counts_from_the_post_and_never_invents_zero(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_imported_posts_store, fake_social_metrics_store,
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    # p2 : Meta ne renvoie aucun total (permission absente) — pas un faux 0.
    bare = {"id": "p2", "message": "Sans compteurs", "created_time": "2026-01-02T10:00:00+0000"}
    respx_mock.get(POSTS_URL).mock(
        return_value=httpx.Response(200, json={"data": [_post("p1", reactions=7, comments=4, shares=2), bare]})
    )

    assert _sync(client).status_code == 200

    by_target = {row["publication_target_id"]: row for row in fake_social_metrics_store}
    first = by_target[fake_imported_posts_store[(ACCOUNT_ID, "p1")]["target_id"]]
    assert (first["reactions"], first["comments"], first["shares"]) == (7, 4, 2)
    assert (first["reach"], first["impressions"]) == (None, None)

    second = by_target[fake_imported_posts_store[(ACCOUNT_ID, "p2")]["target_id"]]
    assert (second["reactions"], second["comments"]) == (None, None)
    # Meta omet `shares` quand il n'y a aucun partage : l'absence est la valeur.
    assert second["shares"] == 0


def test_a_post_without_text_falls_back_to_its_story(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_imported_posts_store,
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(POSTS_URL).mock(
        return_value=httpx.Response(
            200,
            json={"data": [_post("p1", None, story="Studio Vega a partagé un lien."), _post("p2", None)]},
        )
    )

    assert _sync(client).status_code == 200

    assert fake_imported_posts_store[(ACCOUNT_ID, "p1")]["content"] == "Studio Vega a partagé un lien."
    assert fake_imported_posts_store[(ACCOUNT_ID, "p2")]["content"] == ""


def test_incremental_sync_only_asks_for_the_window_since_the_last_completed_sync(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_imported_posts_store,
):
    last_sync = datetime(2026, 3, 10, 12, 0, tzinfo=timezone.utc)
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store, last_posts_sync_at=last_sync)
    route = respx_mock.get(POSTS_URL).mock(return_value=httpx.Response(200, json={"data": [_post("new")]}))

    response = _sync(client)

    assert response.json()["mode"] == "incremental"
    # dernière synchro achevée − 7 jours de recouvrement, en timestamp Unix.
    expected = int((last_sync - timedelta(days=7)).timestamp())
    assert route.calls.last.request.url.params["since"] == str(expected)
    assert response.json()["created"] == 1


def test_a_post_already_published_by_hootly_is_not_duplicated_and_gets_its_link(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_imported_posts_store, fake_social_metrics_store,
):
    """Le cas réel : Hootly a publié ce post, la lecture du fil le revoit."""
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    fake_imported_posts_store[(ACCOUNT_ID, "p1")] = {
        "target_id": "target-hootly", "origin": "HOOTLY", "content": "Texte validé dans Hootly",
        "hashtags": [], "external_url": None,
    }
    respx_mock.get(POSTS_URL).mock(
        return_value=httpx.Response(200, json={"data": [_post("p1", "Texte modifié sur Facebook")]})
    )

    body = _sync(client).json()

    assert (body["created"], body["updated"], body["unchanged"]) == (0, 1, 0)
    assert len(fake_imported_posts_store) == 1
    row = fake_imported_posts_store[(ACCOUNT_ID, "p1")]
    # Il obtient son adresse Facebook, mais son texte validé n'est pas réécrit.
    assert row["external_url"] == "https://www.facebook.com/p1"
    assert row["content"] == "Texte validé dans Hootly"
    # Pas de premier relevé : la cible existait déjà, ses métriques ne sont pas les nôtres.
    assert fake_social_metrics_store == []


def test_an_imported_post_edited_on_facebook_is_updated_and_an_untouched_one_is_not(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_imported_posts_store, fake_social_metrics_store,
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(POSTS_URL).mock(
        return_value=httpx.Response(200, json={"data": [_post("p1", "Version 1"), _post("p2", "Stable")]})
    )
    assert _sync(client).json()["created"] == 2
    snapshots_after_import = len(fake_social_metrics_store)

    respx_mock.get(POSTS_URL).mock(
        return_value=httpx.Response(200, json={"data": [_post("p1", "Version 2 #Nouveau"), _post("p2", "Stable")]})
    )
    body = _sync(client).json()

    assert (body["created"], body["updated"], body["unchanged"]) == (0, 1, 1)
    assert fake_imported_posts_store[(ACCOUNT_ID, "p1")]["content"] == "Version 2 #Nouveau"
    assert fake_imported_posts_store[(ACCOUNT_ID, "p1")]["hashtags"] == ["#Nouveau"]
    # Relire un post connu n'ajoute pas de relevé : l'historique de métriques
    # appartient à la synchronisation des métriques, pas à l'import.
    assert len(fake_social_metrics_store) == snapshots_after_import


def test_a_call_reads_a_bounded_number_of_pages_and_only_the_last_one_marks_the_sync_done(
    client, service_jwt_settings, monkeypatch, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_imported_posts_store,
):
    from core.config import settings

    monkeypatch.setattr(settings, "posts_sync_pages_per_call", 2)
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    account = fake_social_accounts_store[("FACEBOOK", PAGE_ID)]

    def _pages(request):
        after = request.url.params.get("after")
        if after is None:
            return httpx.Response(200, json={"data": [_post("p1")], "paging": {"cursors": {"after": "c1"}, "next": "x"}})
        if after == "c1":
            return httpx.Response(200, json={"data": [_post("p2")], "paging": {"cursors": {"after": "c2"}, "next": "x"}})
        if after == "c2":
            return httpx.Response(200, json={"data": [_post("p3")], "paging": {"cursors": {"after": "c2"}}})
        raise AssertionError(f"curseur inattendu {after}")

    respx_mock.get(POSTS_URL).mock(side_effect=_pages)

    first = _sync(client).json()
    # Deux pages lues, pas trois : le curseur permet à l'appelant de reprendre.
    assert (first["done"], first["nextCursor"], first["created"]) == (False, "c2", 2)
    # Import inachevé : rien ne doit laisser croire qu'il est complet.
    assert account["last_posts_sync_at"] is None

    second = _sync(client, cursor=first["nextCursor"]).json()
    assert (second["done"], second["nextCursor"], second["created"]) == (True, None, 1)
    assert second["mode"] == "initial"  # même mode pendant toute la boucle
    assert account["last_posts_sync_at"] is not None
    assert sorted(key[1] for key in fake_imported_posts_store) == ["p1", "p2", "p3"]


def test_a_next_page_announced_without_a_cursor_fails_instead_of_marking_a_truncated_import_done(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(POSTS_URL).mock(
        return_value=httpx.Response(200, json={"data": [_post("p1")], "paging": {"next": "https://graph.facebook.com/..."}})
    )

    response = _sync(client)

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "provider_unavailable"
    assert fake_social_accounts_store[("FACEBOOK", PAGE_ID)]["last_posts_sync_at"] is None


def test_a_post_without_a_usable_date_is_skipped_but_the_others_are_kept(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
    fake_imported_posts_store,
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(POSTS_URL).mock(
        return_value=httpx.Response(
            200,
            json={"data": [_post("broken", created="pas une date"), {"id": "nodate", "message": "x"}, _post("ok")]},
        )
    )

    body = _sync(client).json()

    assert (body["created"], body["skipped"], body["done"]) == (1, 2, True)
    assert list(fake_imported_posts_store) == [(ACCOUNT_ID, "ok")]


def test_a_meta_error_fails_the_call_and_leaves_the_sync_unfinished(
    client, service_jwt_settings, respx_mock, fake_social_accounts_store, fake_oauth_tokens_store,
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    respx_mock.get(POSTS_URL).mock(
        return_value=httpx.Response(400, json={"error": {"message": "(#10) permission manquante", "code": 10}})
    )

    response = _sync(client)

    assert response.status_code == 400
    assert fake_social_accounts_store[("FACEBOOK", PAGE_ID)]["last_posts_sync_at"] is None


def test_an_account_without_an_active_token_needs_reauthentication(
    client, service_jwt_settings, fake_social_accounts_store, fake_oauth_tokens_store,
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)
    fake_oauth_tokens_store.clear()

    response = _sync(client)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "TOKEN_EXPIRED"


def test_an_unknown_account_is_not_found(client, service_jwt_settings):
    response = _sync(client)

    assert response.status_code == 404


def test_the_provider_must_match_the_account(
    client, service_jwt_settings, fake_social_accounts_store, fake_oauth_tokens_store,
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store)

    response = _sync(client, provider="instagram")

    assert response.status_code == 422


def test_instagram_import_is_refused_explicitly_rather_than_silently_partial(
    client, service_jwt_settings, fake_social_accounts_store, fake_oauth_tokens_store,
):
    _seed_account(fake_social_accounts_store, fake_oauth_tokens_store, provider="INSTAGRAM")

    response = _sync(client, provider="instagram")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unprocessable"


def test_the_route_requires_the_read_scope(client, service_jwt_settings):
    forbidden = client.post(
        "/internal/v1/posts/sync",
        json={"socialAccountId": ACCOUNT_ID, "provider": "facebook"},
        headers=_auth_header(scope=["ai:analyze"]),
    )
    anonymous = client.post("/internal/v1/posts/sync", json={"socialAccountId": ACCOUNT_ID, "provider": "facebook"})

    assert forbidden.status_code == 403
    assert anonymous.status_code == 401


def test_the_social_account_id_is_required(client, service_jwt_settings):
    """Contrairement aux commentaires, pas de repli sur la Page globale de l'.env :
    un post importé doit être rattaché à une marque, donc à un compte réel."""
    response = client.post(
        "/internal/v1/posts/sync", json={"provider": "facebook"}, headers=_auth_header(scope=["social:read"])
    )

    assert response.status_code == 422


def test_hashtags_are_extracted_like_the_composer_writes_them():
    from modules.facebook.services.internal_service import _extract_hashtags

    assert _extract_hashtags("Promo #Été2026 et #promo, #Été2026 encore") == ["#Été2026", "#promo"]
    # Ni fragment d'URL ni entité HTML.
    assert _extract_hashtags("Lire https://ex.com/page#section &#39;ok&#39; a#b") == []
    assert _extract_hashtags("(#entre_parentheses)") == ["#entre_parentheses"]
    assert len(_extract_hashtags(" ".join(f"#t{i}" for i in range(50)))) == 30
    assert _extract_hashtags("") == []

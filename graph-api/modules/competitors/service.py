"""Logique derrière /internal/v1/competitors/* et /internal/v1/accounts/audience.

Même découpage que `modules/facebook/services/internal_service.py` : résoudre
le compte social de la marque et son token déchiffré, puis déléguer au module
du bon réseau. La différence tenante : ici, un refus Meta n'est pas propagé en
erreur HTTP. Il est classé (`capabilities.classify_meta_failure`) et renvoyé
dans un `status`, parce que c'est exactement ce que l'appelant doit persister —
un concurrent devenu illisible est une information à afficher, pas un incident
à retenter en boucle.

Ce service n'écrit rien : à la différence de `sync_comments`/`sync_metrics`, il
n'y a pas de table concurrents côté graph-api. La persistance appartient au
worker, qui orchestre déjà la séquence profil → publications → relevé et
possède les règles de déduplication. graph-api reste ici ce qu'il est pour le
reste du produit : la seule porte vers Meta.
"""
import logging

from core.exceptions import GraphAPIError
from db import oauth_tokens_repository, social_accounts_repository
from modules.competitors import facebook as facebook_competitors
from modules.competitors import instagram as instagram_competitors
from modules.competitors.capabilities import classify_meta_failure
from modules.competitors.schemas import (
    AccountAudienceRequest,
    AccountAudienceResponse,
    CompetitorPostsRequest,
    CompetitorPostsResponse,
    CompetitorProfileRequest,
    CompetitorProfileResponse,
)

logger = logging.getLogger("graph_api.competitors")

_MODULES = {
    "FACEBOOK": facebook_competitors,
    "INSTAGRAM": instagram_competitors,
}


def _module_for(platform: str):
    module = _MODULES.get((platform or "").upper())
    if module is None:
        raise GraphAPIError(
            status_code=422,
            detail=f"Réseau '{platform}' non pris en charge pour l'analyse concurrentielle.",
            code="unprocessable",
        )
    return module


async def _resolve_account_and_token(social_account_id: str) -> tuple[dict, str]:
    account = await social_accounts_repository.get_by_id(social_account_id)
    if account is None:
        raise GraphAPIError(status_code=404, detail="Compte social introuvable.", code="not_found")

    token = await oauth_tokens_repository.get_decrypted_access_token(social_account_id)
    if token is None:
        raise GraphAPIError(
            status_code=409,
            detail="Aucun token actif pour ce compte ; reconnexion requise.",
            code="TOKEN_EXPIRED",
        )
    return account, token


def _failure(exc: GraphAPIError) -> tuple[str, str, str]:
    status = classify_meta_failure(exc.status_code, exc.meta_code, exc.meta_subcode)
    return status, exc.code, exc.detail


async def profile(body: CompetitorProfileRequest) -> CompetitorProfileResponse:
    account, token = await _resolve_account_and_token(body.social_account_id)
    module = _module_for(body.platform)

    try:
        data = await module.fetch_profile(account=account, token=token, handle=body.handle)
    except GraphAPIError as exc:
        status, code, message = _failure(exc)
        logger.info(
            "competitor_profile_refused platform=%s status=%s metaCode=%s",
            body.platform, status, exc.meta_code,
        )
        return CompetitorProfileResponse(status=status, errorCode=code, errorMessage=message)

    if data.get("unavailable"):
        return CompetitorProfileResponse(
            status="UNAVAILABLE",
            errorCode="not_found",
            errorMessage="Ce compte n'est pas accessible via l'API Meta (compte personnel, supprimé ou privé).",
        )

    return CompetitorProfileResponse(
        status="ACTIVE",
        externalId=data.get("externalId"),
        username=data.get("username"),
        name=data.get("name"),
        profileUrl=data.get("profileUrl"),
        avatarUrl=data.get("avatarUrl"),
        accountType=data.get("accountType"),
        followersCount=data.get("followersCount"),
        postsCount=data.get("postsCount"),
        unavailableFields=data.get("unavailableFields") or [],
    )


async def posts(body: CompetitorPostsRequest) -> CompetitorPostsResponse:
    """Parcourt jusqu'à `max_pages` pages de publications publiques.

    Une erreur survenue APRÈS une première page réussie ne jette pas ce qui a
    déjà été lu : les publications collectées sont renvoyées avec le statut du
    refus. Un lot partiel vaut mieux qu'un balayage perdu — c'est la même
    logique que « ne pas bloquer tout l'écran si une seule métrique manque ».
    """
    account, token = await _resolve_account_and_token(body.social_account_id)
    module = _module_for(body.platform)

    collected = []
    unavailable_fields: list[str] = []
    cursor = body.cursor
    has_more = False

    for _ in range(max(1, body.max_pages)):
        try:
            page, cursor, has_more, missing = await module.fetch_posts(
                account=account, token=token, handle=body.handle, limit=body.limit, cursor=cursor
            )
        except GraphAPIError as exc:
            status, code, message = _failure(exc)
            logger.info(
                "competitor_posts_refused platform=%s status=%s metaCode=%s collected=%d",
                body.platform, status, exc.meta_code, len(collected),
            )
            return CompetitorPostsResponse(
                status=status,
                posts=collected,
                nextCursor=cursor,
                hasMore=False,
                unavailableFields=unavailable_fields,
                errorCode=code,
                errorMessage=message,
            )

        collected.extend(page)
        for name in missing:
            if name not in unavailable_fields:
                unavailable_fields.append(name)
        if not has_more or not cursor:
            break

    return CompetitorPostsResponse(
        status="ACTIVE",
        posts=collected,
        nextCursor=cursor if has_more else None,
        hasMore=has_more,
        unavailableFields=sorted(unavailable_fields),
    )


async def account_audience(body: AccountAudienceRequest) -> AccountAudienceResponse:
    account, token = await _resolve_account_and_token(body.social_account_id)
    module = _module_for(account.get("provider"))

    try:
        data = await module.fetch_self_audience(account=account, token=token)
    except GraphAPIError as exc:
        status, code, message = _failure(exc)
        return AccountAudienceResponse(status=status, errorCode=code, errorMessage=message)

    return AccountAudienceResponse(
        status="ACTIVE",
        followersCount=data.get("followersCount"),
        postsCount=data.get("postsCount"),
    )

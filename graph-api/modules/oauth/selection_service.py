"""Choix des pages à lier par un administrateur de la plateforme.

Deux temps, tous deux appelés par Express (jamais par un navigateur) :

1. `get_selection` — la liste des pages que le compte Facebook autorisé peut
   gérer, SANS jeton ;
2. `link_selection` — lie les pages choisies, une seule fois.

Express vérifie que c'est bien l'administrateur qui a lancé la liaison et qu'aucune
page n'appartient déjà à une autre marque ; graph-api revérifie l'essentiel
(pages proposées, usage unique) parce que lui seul détient les jetons.
"""
from core.exceptions import GraphAPIError
from db import oauth_selections_repository
from modules.oauth.page_linking import link_page
from modules.oauth.schemas import (
    LinkedAccount,
    PageSelectionLinkResponse,
    PageSelectionResponse,
    SelectionInstagram,
    SelectionPage,
)


def _not_found() -> GraphAPIError:
    return GraphAPIError(
        status_code=404,
        detail="Sélection introuvable, expirée ou déjà utilisée.",
        code="not_found",
    )


async def get_selection(selection_id: str) -> PageSelectionResponse:
    selection = await oauth_selections_repository.get_selection(selection_id)
    if selection is None:
        raise _not_found()

    pages = []
    for page in selection["payload"]["pages"]:
        instagram = page.get("instagram")
        pages.append(
            SelectionPage(
                externalId=page["id"],
                name=page.get("name", ""),
                pictureUrl=page.get("pictureUrl"),
                instagram=(
                    SelectionInstagram(
                        externalId=instagram["id"],
                        username=instagram.get("username"),
                        name=instagram.get("name"),
                    )
                    if instagram
                    else None
                ),
            )
        )

    return PageSelectionResponse(
        id=selection["id"],
        userId=selection["user_id"],
        brandId=selection["brand_id"],
        initiatedByUserId=selection["initiated_by_user_id"],
        expiresAt=selection["expires_at"].isoformat(),
        pages=pages,
    )


async def link_selection(selection_id: str, page_ids: list[str]) -> PageSelectionLinkResponse:
    selection = await oauth_selections_repository.get_selection(selection_id)
    if selection is None:
        raise _not_found()

    proposed = {page["id"]: page for page in selection["payload"]["pages"]}
    unknown = [page_id for page_id in dict.fromkeys(page_ids) if page_id not in proposed]
    if unknown:
        # Une page qui n'a pas été proposée ne peut pas être liée : le jeton
        # correspondant n'existe pas, et l'identifiant vient du client.
        raise GraphAPIError(
            status_code=422,
            detail="Une page choisie ne fait pas partie de la sélection.",
            code="validation_failed",
        )

    # Réclamation AVANT toute écriture : deux envois simultanés ne lient pas deux fois.
    if not await oauth_selections_repository.claim_selection(selection_id):
        raise _not_found()

    permissions = selection["payload"].get("permissions", [])
    accounts: list[LinkedAccount] = []
    for page_id in dict.fromkeys(page_ids):
        linked = await link_page(
            page=proposed[page_id],
            brand_id=selection["brand_id"],
            user_id=selection["user_id"],
            permissions=permissions,
        )
        for account in linked:
            accounts.append(
                LinkedAccount(
                    id=str(account["id"]),
                    provider=account["provider"],
                    externalAccountId=account["external_account_id"],
                    name=account.get("name") or "",
                    username=account.get("username"),
                )
            )
    return PageSelectionLinkResponse(accounts=accounts)

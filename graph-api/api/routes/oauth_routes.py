"""Public OAuth routes (Sprint 06 Day 3).

Not behind the service JWT: Meta calls these directly as a top-level browser
redirect after the user consents. Protected instead by the one-time-use
`state` parameter (see modules/oauth/callback_service.py).
"""
from fastapi import APIRouter
from fastapi.responses import RedirectResponse

from modules.oauth import callback_service

router = APIRouter(tags=["OAuth"])


@router.get("/oauth/facebook/callback")
async def facebook_oauth_callback(
    code: str | None = None, state: str | None = None, error: str | None = None
):
    redirect_url = await callback_service.handle_facebook_callback(code=code, state=state, error=error)
    return RedirectResponse(url=redirect_url, status_code=302)


@router.get("/oauth/instagram/callback")
async def instagram_oauth_callback(
    code: str | None = None, state: str | None = None, error: str | None = None
):
    redirect_url = await callback_service.handle_instagram_callback(code=code, state=state, error=error)
    return RedirectResponse(url=redirect_url, status_code=302)

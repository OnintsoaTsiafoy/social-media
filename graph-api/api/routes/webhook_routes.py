"""Meta webhooks (Sprint 08 Day 2) — public, no service JWT.

Same "graph-api is the only Meta-facing service" precedent as
`/oauth/{provider}/callback`: Meta calls this directly, authenticated by its
own mechanism (a shared verify_token for the GET challenge, an HMAC
signature for POST deliveries) rather than our service JWT. Exempted from
the default rate limiter (`core/rate_limit.py`): Meta retries aggressively on
a non-200/slow response, so a 429 here would only make redelivery worse.
"""
import json
import logging

from fastapi import APIRouter, Request, Response

from core.rate_limit import limiter
from modules.webhooks.service import process_payload
from modules.webhooks.signature import secret_for_object, verify_challenge_token, verify_payload_signature

router = APIRouter(tags=["Webhooks"])
logger = logging.getLogger("graph_api.webhooks")


@router.get("/webhooks/meta")
@limiter.exempt
async def webhook_challenge(request: Request) -> Response:
    params = request.query_params
    if params.get("hub.mode") == "subscribe" and verify_challenge_token(params.get("hub.verify_token")):
        return Response(content=params.get("hub.challenge", ""), media_type="text/plain")
    return Response(status_code=403)


@router.post("/webhooks/meta")
@limiter.exempt
async def webhook_receive(request: Request) -> Response:
    raw_body = await request.body()

    try:
        payload = json.loads(raw_body)
    except ValueError:
        return Response(status_code=400)

    object_field = payload.get("object")
    secret = secret_for_object(object_field)
    if not secret:
        logger.warning("webhook_unknown_object", extra={"object": object_field})
        return Response(status_code=403)

    signature_header = request.headers.get("x-hub-signature-256")
    if not verify_payload_signature(raw_body, signature_header, secret):
        logger.warning("webhook_signature_mismatch", extra={"object": object_field})
        return Response(status_code=403)

    summary = await process_payload(object_field, payload)
    logger.info("webhook_processed", extra=summary)
    return Response(status_code=200)

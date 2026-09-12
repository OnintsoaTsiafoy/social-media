"""Meta webhook signature verification (Sprint 08 Day 2).

Two distinct Meta Apps already exist in this codebase (Facebook Login for
Business / Instagram Login, Sprint 07) — each has its own webhook
subscription and signs its own deliveries with its own App Secret. The
payload's top-level `object` field ("page" vs "instagram") selects which
secret to verify against; there is no single universal webhook secret.
Verified live during planning against Meta's current webhook documentation
for both products, not assumed.
"""
import hashlib
import hmac

from core.config import settings

_SIGNATURE_PREFIX = "sha256="


def secret_for_object(object_field: str | None) -> str | None:
    if object_field == "instagram":
        return settings.instagram_app_secret
    if object_field == "page":
        return settings.facebook_app_secret
    return None


def verify_payload_signature(raw_body: bytes, signature_header: str | None, secret: str) -> bool:
    """Computed over the exact raw bytes Meta signed — never a re-serialized
    or parsed-then-dumped version of the body, which can differ byte-for-byte
    (key order, whitespace, unicode escaping) and silently break this check."""
    if not signature_header or not signature_header.startswith(_SIGNATURE_PREFIX):
        return False
    provided = signature_header[len(_SIGNATURE_PREFIX):]
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(provided, expected)


def verify_challenge_token(token: str | None) -> bool:
    if not token or not settings.meta_webhook_verify_token:
        return False
    return hmac.compare_digest(token, settings.meta_webhook_verify_token)

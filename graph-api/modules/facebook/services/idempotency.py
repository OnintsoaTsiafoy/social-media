"""Idempotency-Key handling for /internal/v1, backed by the
``service_idempotency_keys`` table (Sprint 06 Day 1) — replaces the
in-memory, process-local stopgap used in Sprint 05 now that graph-api has a
database connection.
"""
from core.exceptions import GraphAPIError
from db import idempotency_repository


async def get_cached_response(endpoint: str, key: str, request_payload: dict) -> dict | None:
    cached, conflict = await idempotency_repository.get_cached_response(
        endpoint, key, request_payload
    )
    if conflict:
        raise GraphAPIError(
            status_code=409,
            detail="Idempotency-Key déjà utilisée avec un corps de requête différent.",
            code="idempotency_conflict",
        )
    return cached


async def store_response(endpoint: str, key: str, request_payload: dict, response_body: dict) -> None:
    await idempotency_repository.store_response(endpoint, key, request_payload, response_body)

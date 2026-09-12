from fastapi import HTTPException


def default_code_for_status(status_code: int) -> str:
    """Stable error code for a status Meta or a local check can produce.

    Kept as a small, explicit table (Sprint 05 Day 4) instead of leaking raw
    Meta error text as the only signal callers can branch on.
    """
    if status_code == 400:
        return "validation_failed"
    if status_code == 404:
        return "not_found"
    if status_code == 429:
        return "rate_limited"
    if status_code in (502, 503, 504):
        return "provider_unavailable"
    return "meta_error"


class GraphAPIError(HTTPException):
    """Exception levée lors d'une erreur retournée par Facebook Graph API."""

    def __init__(
        self,
        status_code: int,
        detail: str,
        code: str | None = None,
        retry_after: str | None = None,
    ):
        super().__init__(status_code=status_code, detail=detail)
        self.code = code or default_code_for_status(status_code)
        self.retry_after = retry_after

    @classmethod
    def from_response(
        cls, status_code: int, error_data: dict, retry_after: str | None = None
    ) -> "GraphAPIError":
        error = error_data.get("error", {})
        message = error.get("message", "Erreur inconnue Graph API")
        code = error.get("code")
        err_type = error.get("type")
        if code is not None or err_type is not None:
            message = f"{message} (type={err_type}, code={code})"
        return cls(status_code=status_code, detail=message, retry_after=retry_after)

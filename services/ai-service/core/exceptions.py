from fastapi import HTTPException


def default_code_for_status(status_code: int) -> str:
    """Même table que graph-api/core/exceptions.py : les deux services internes
    parlent le vocabulaire d'erreur documenté dans docs/CONTRATS_API.md, pour
    que services/api/src/lib/*ServiceClient.js n'ait pas à traduire deux
    dialectes différents."""
    if status_code == 400:
        return "validation_failed"
    if status_code == 404:
        return "not_found"
    if status_code == 422:
        return "validation_failed"
    if status_code == 429:
        return "rate_limited"
    if status_code in (502, 503, 504):
        return "provider_unavailable"
    return "ai_error"


class AIServiceError(HTTPException):
    """Erreur métier du service d'analyse, rendue dans l'enveloppe
    {error:{code,message,requestId}} par le gestionnaire de `main.py`."""

    def __init__(self, status_code: int, detail: str, code: str | None = None):
        super().__init__(status_code=status_code, detail=detail)
        self.code = code or default_code_for_status(status_code)

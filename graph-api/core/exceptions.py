from fastapi import HTTPException


class GraphAPIError(HTTPException):
    """Exception levée lors d'une erreur retournée par Facebook Graph API."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(status_code=status_code, detail=detail)

    @classmethod
    def from_response(cls, status_code: int, error_data: dict) -> "GraphAPIError":
        error = error_data.get("error", {})
        message = error.get("message", "Erreur inconnue Graph API")
        code = error.get("code")
        err_type = error.get("type")
        if code is not None or err_type is not None:
            message = f"{message} (type={err_type}, code={code})"
        return cls(status_code=status_code, detail=message)

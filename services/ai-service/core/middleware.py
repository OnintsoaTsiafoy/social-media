import re
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{8,100}$")


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Propage ou génère un identifiant de requête, comme
    services/api/src/lib/http.js et graph-api/core/middleware.py, pour qu'une
    analyse déclenchée depuis le mobile se suive d'Express jusqu'ici."""

    async def dispatch(self, request: Request, call_next):
        supplied = request.headers.get("x-request-id")
        request_id = supplied if supplied and _VALID_REQUEST_ID.match(supplied) else str(uuid.uuid4())
        request.state.request_id = request_id

        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        return response

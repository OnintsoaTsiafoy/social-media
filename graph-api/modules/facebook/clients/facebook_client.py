import logging
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from core.config import settings
from core.exceptions import GraphAPIError

logger = logging.getLogger("graph_api.facebook_client")

_REDACTED = "***"


def _redact_url(url: str) -> str:
    """Strip access_token before a URL ever reaches a log line (Sprint 05 Day 4)."""
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    redacted = [(key, _REDACTED if key == "access_token" else value) for key, value in query]
    return urlunsplit(parts._replace(query=urlencode(redacted)))


class FacebookClient:
    """Client HTTP pour communiquer avec Facebook Graph API.

    Sprint 07: also instantiable with an explicit ``page_id``/``access_token``
    (a real per-account token resolved via social_accounts/oauth_tokens),
    instead of always reading the single globally-configured Page. The
    module-level singleton below keeps working exactly as before — it's just
    this class's zero-argument case — so the legacy /facebook/* routes are
    unaffected.
    """

    def __init__(self, *, page_id: str | None = None, access_token: str | None = None):
        self.base_url = settings.graph_api_base_url
        self.page_id = page_id or settings.facebook_page_id
        self.access_token = access_token or settings.facebook_page_access_token

    def _require_configuration(self) -> None:
        """Prevent accidental Meta requests before this client has a Page and a token."""
        if not (self.page_id and self.access_token):
            raise GraphAPIError(
                status_code=503,
                detail="Configuration Meta absente. Consultez /ready avant d'appeler les routes Facebook.",
                code="provider_unavailable",
            )

    @staticmethod
    def _extract_error_payload(response: httpx.Response) -> dict:
        try:
            return response.json()
        except ValueError:
            return {"error": {"message": response.text or "Erreur inconnue Graph API"}}

    def _handle_response(
        self, response: httpx.Response, success_codes: tuple[int, ...] = (200, 201)
    ) -> dict:
        if response.status_code not in success_codes:
            retry_after = response.headers.get("Retry-After")
            if response.status_code == 429 and not retry_after:
                # Meta doesn't consistently send a standard Retry-After header on
                # rate limiting (it favors X-Business-Use-Case-Usage/X-App-Usage
                # instead); this fixed fallback is a documented, deliberately
                # conservative default pending live verification of the exact
                # header Meta sends for this app (Sprint 05/06 open item).
                retry_after = "60"
            raise GraphAPIError.from_response(
                response.status_code,
                self._extract_error_payload(response),
                retry_after=retry_after,
            )

        try:
            return response.json()
        except ValueError as exc:
            raise GraphAPIError(
                status_code=502,
                detail="Reponse invalide retournee par Graph API.",
                code="provider_unavailable",
            ) from exc

    def _default_timeout(self) -> httpx.Timeout:
        return httpx.Timeout(timeout=settings.graph_api_default_timeout_seconds)

    def _upload_timeout(self) -> httpx.Timeout:
        upload_seconds = settings.graph_api_upload_timeout_seconds
        return httpx.Timeout(connect=10.0, write=upload_seconds, read=upload_seconds, pool=10.0)

    async def _send(
        self,
        method: str,
        endpoint: str,
        *,
        timeout: httpx.Timeout,
        params: dict | None = None,
        data: dict | None = None,
        json: dict | None = None,
        files: dict | None = None,
    ) -> httpx.Response:
        """Single choke point for outbound Meta calls: network failures are
        translated into stable errors here instead of propagating as an
        unhandled 500 (Sprint 05 Day 4)."""
        url = f"{self.base_url}/{endpoint}"
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                return await client.request(
                    method, url, params=params, data=data, json=json, files=files
                )
        except httpx.TimeoutException as exc:
            logger.warning("Meta request timed out: %s %s", method, _redact_url(url))
            raise GraphAPIError(
                status_code=504,
                detail="Le service Meta n'a pas repondu a temps.",
                code="provider_timeout",
            ) from exc
        except httpx.HTTPError as exc:
            logger.warning(
                "Meta request failed: %s %s (%s)", method, _redact_url(url), exc.__class__.__name__
            )
            raise GraphAPIError(
                status_code=503,
                detail="Le service Meta est injoignable.",
                code="provider_unavailable",
            ) from exc

    async def get(self, endpoint: str, params: dict | None = None) -> dict:
        self._require_configuration()
        params = dict(params or {})
        params["access_token"] = self.access_token

        response = await self._send(
            "GET", endpoint, timeout=self._default_timeout(), params=params
        )
        return self._handle_response(response, success_codes=(200,))

    async def post(self, endpoint: str, data: dict | None = None) -> dict:
        return await self.post_form(endpoint=endpoint, data=data)

    async def post_form(self, endpoint: str, data: dict | None = None) -> dict:
        self._require_configuration()
        params = {"access_token": self.access_token}

        response = await self._send(
            "POST", endpoint, timeout=self._default_timeout(), params=params, data=data or {}
        )
        return self._handle_response(response)

    async def post_json(self, endpoint: str, data: dict | None = None) -> dict:
        self._require_configuration()
        params = {"access_token": self.access_token}

        response = await self._send(
            "POST", endpoint, timeout=self._default_timeout(), params=params, json=data or {}
        )
        return self._handle_response(response)

    async def put_form(self, endpoint: str, data: dict | None = None) -> dict:
        self._require_configuration()
        params = {"access_token": self.access_token}

        response = await self._send(
            "PUT", endpoint, timeout=self._default_timeout(), params=params, data=data or {}
        )
        return self._handle_response(response)

    async def delete(self, endpoint: str) -> dict:
        self._require_configuration()
        params = {"access_token": self.access_token}

        response = await self._send(
            "DELETE", endpoint, timeout=self._default_timeout(), params=params
        )
        return self._handle_response(response, success_codes=(200, 201))

    async def post_multipart(
        self,
        endpoint: str,
        data: dict | None = None,
        files: dict | None = None,
    ) -> dict:
        self._require_configuration()
        params = {"access_token": self.access_token}

        response = await self._send(
            "POST",
            endpoint,
            timeout=self._upload_timeout(),
            params=params,
            data=data or {},
            files=files or {},
        )
        return self._handle_response(response)

    async def upload_unpublished_photo(
        self, content: bytes, filename: str, content_type: str
    ) -> str:
        """Upload une photo sans la publier et retourne son ID."""
        data = await self.post_multipart(
            f"{self.page_id}/photos",
            data={"published": "false"},
            files={"source": (filename, content, content_type)},
        )
        return data["id"]


facebook_client = FacebookClient()

import httpx

from core.config import settings
from core.exceptions import GraphAPIError

# Timeout standard pour les appels texte/lecture
_DEFAULT_TIMEOUT = httpx.Timeout(timeout=30.0)
# Timeout étendu pour les uploads de fichiers (images, vidéos)
_UPLOAD_TIMEOUT = httpx.Timeout(connect=10.0, write=120.0, read=120.0, pool=10.0)


class FacebookClient:
    """Client HTTP pour communiquer avec Facebook Graph API."""

    def __init__(self):
        self.base_url = settings.graph_api_base_url
        self.page_id = settings.facebook_page_id
        self.access_token = settings.facebook_page_access_token

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
            raise GraphAPIError.from_response(
                response.status_code, self._extract_error_payload(response)
            )

        try:
            return response.json()
        except ValueError as exc:
            raise GraphAPIError(
                status_code=502, detail="Reponse invalide retournee par Graph API."
            ) from exc

    async def get(self, endpoint: str, params: dict | None = None) -> dict:
        params = params or {}
        params["access_token"] = self.access_token

        async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client:
            response = await client.get(f"{self.base_url}/{endpoint}", params=params)

        return self._handle_response(response, success_codes=(200,))

    async def post(self, endpoint: str, data: dict | None = None) -> dict:
        return await self.post_form(endpoint=endpoint, data=data)

    async def post_form(self, endpoint: str, data: dict | None = None) -> dict:
        params = {"access_token": self.access_token}
        payload = data or {}

        async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client:
            response = await client.post(
                f"{self.base_url}/{endpoint}", params=params, data=payload
            )

        return self._handle_response(response)

    async def post_json(self, endpoint: str, data: dict | None = None) -> dict:
        params = {"access_token": self.access_token}

        async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client:
            response = await client.post(
                f"{self.base_url}/{endpoint}", params=params, json=data or {}
            )

        return self._handle_response(response)

    async def put_form(self, endpoint: str, data: dict | None = None) -> dict:
        params = {"access_token": self.access_token}
        payload = data or {}

        async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client:
            response = await client.put(
                f"{self.base_url}/{endpoint}", params=params, data=payload
            )

        return self._handle_response(response)

    async def delete(self, endpoint: str) -> dict:
        params = {"access_token": self.access_token}

        async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT) as client:
            response = await client.delete(f"{self.base_url}/{endpoint}", params=params)

        return self._handle_response(response, success_codes=(200, 201))

    async def post_multipart(
        self,
        endpoint: str,
        data: dict | None = None,
        files: dict | None = None,
    ) -> dict:
        params = {"access_token": self.access_token}
        form_data = data or {}
        upload_files = files or {}

        async with httpx.AsyncClient(timeout=_UPLOAD_TIMEOUT) as client:
            response = await client.post(
                f"{self.base_url}/{endpoint}",
                params=params,
                data=form_data,
                files=upload_files,
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

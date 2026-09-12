from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Social Graph API"
    debug: bool = False

    # Facebook is optional at process startup: health probes and local contract
    # work must remain available before a Meta account has been connected. The
    # social routes will be guarded by service-level configuration checks in
    # Sprint 05/06.
    facebook_app_id: str | None = None
    facebook_page_id: str | None = None
    facebook_page_access_token: str | None = None
    # Only needed for the OAuth code/token exchange (Sprint 06) — never sent
    # anywhere except directly to Meta's oauth/access_token endpoint.
    facebook_app_secret: str | None = None

    # Instagram Login (direct, no Facebook Page) — Sprint 07. A Page-linked
    # Instagram professional account uses the Facebook app credentials above
    # instead; these are only for the standalone Instagram API product.
    instagram_app_id: str | None = None
    instagram_app_secret: str | None = None

    # Instagram media container polling (Sprint 07 Day 3). Kept short in
    # tests via monkeypatch; Meta's own guidance is up to ~5 minutes in
    # production for a slow video, but most images finish in well under 30s.
    instagram_container_poll_interval_seconds: float = 3.0
    instagram_container_poll_max_attempts: int = 40

    # Graph API
    graph_api_base_url: str = "https://graph.facebook.com/v25.0"

    # Timeouts (seconds) — configurable so a slow network doesn't require a
    # code change (Sprint 05 Day 4).
    graph_api_default_timeout_seconds: float = 30.0
    graph_api_upload_timeout_seconds: float = 120.0

    # Service JWT shared with Express/worker for /internal/v1 (Sprint 05 Day 5).
    # Mirrors services/api/src/auth/tokens.js's guard against the dev placeholder.
    service_jwt_secret: str | None = None

    # Comma-separated browser origins allowed to call this service. Left empty
    # by default: /internal/v1 is server-to-server and /oauth/*/callback is a
    # top-level browser navigation — neither is subject to CORS in practice.
    cors_allowed_origins: str = ""

    # Sprint 06: graph-api's own Postgres connection (raw SQL, no ORM) for
    # social_accounts/oauth_tokens/social_permissions/oauth_states/
    # service_idempotency_keys — the same tables Prisma migrates but reads
    # exactly like services/worker already reads publications/* via raw `pg`.
    database_url: str | None = None

    # AES-256-GCM key for Meta tokens at rest, versioned from day one even
    # with a single key so rotation later doesn't require a schema change.
    # Each key is a base64-encoded 32-byte value.
    token_encryption_key_current_version: int = 1
    token_encryption_key_1: str | None = None

    # Sprint 08 Day 3 — safety cap on the backfill sync's per-post page walk.
    # Neither comments edge supports server-side timestamp filtering (checked
    # directly against Meta's current docs, not assumed), so each run
    # re-walks every page of every known post; this bounds the worst case
    # for a post with an unusually large comment count. Kept low in tests.
    comments_sync_max_pages_per_post: int = 20

    # Sprint 08 — Meta webhook challenge handshake secret (hub.verify_token),
    # distinct from facebook_app_secret/instagram_app_secret (those sign the
    # POST body's payload, this one is only compared against the GET
    # subscription challenge). One value shared across both Meta Apps: it's
    # Hootly's own secret, not Meta's, so there's no reason to split it.
    meta_webhook_verify_token: str | None = None

    # This service's OWN public base URL — used only to build the
    # `redirect_uri` registered with Meta (`{public_base_url}/oauth/{provider}/callback`).
    # Distinct from graph_api_base_url, which is Meta's API host. Must be a
    # real HTTPS domain registered in the Meta App's OAuth settings outside
    # of local dev.
    public_base_url: str = "http://localhost:8000"

    model_config = {"env_file": ".env"}

    @property
    def meta_configured(self) -> bool:
        """Whether all values needed to call Meta are available locally."""
        return all(
            value is not None and value.strip()
            for value in (
                self.facebook_app_id,
                self.facebook_page_id,
                self.facebook_page_access_token,
            )
        )

    @property
    def service_jwt_configured(self) -> bool:
        return bool(self.service_jwt_secret) and not self.service_jwt_secret.startswith(
            "change-me"
        )

    @property
    def cors_allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]

    @property
    def oauth_configured(self) -> bool:
        """meta_configured plus the app secret, needed only for the OAuth
        code/token exchange — kept separate so /ready and the existing
        /facebook/* routes don't start requiring a secret they never used."""
        return self.meta_configured and bool(
            self.facebook_app_secret and self.facebook_app_secret.strip()
        )

    @property
    def instagram_oauth_configured(self) -> bool:
        return bool(self.instagram_app_id and self.instagram_app_secret)

    @property
    def database_configured(self) -> bool:
        return bool(self.database_url)

    @property
    def encryption_configured(self) -> bool:
        return bool(self.token_encryption_key_1)

    @property
    def webhook_configured(self) -> bool:
        return bool(self.meta_webhook_verify_token) and bool(
            (self.facebook_app_secret and self.facebook_app_secret.strip())
            or (self.instagram_app_secret and self.instagram_app_secret.strip())
        )


settings = Settings()

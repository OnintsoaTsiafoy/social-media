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

    # Graph API
    graph_api_base_url: str = "https://graph.facebook.com/v25.0"

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


settings = Settings()

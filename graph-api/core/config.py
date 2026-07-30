from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Social Graph API"
    debug: bool = False

    # Facebook
    facebook_app_id: str
    facebook_page_id: str
    facebook_page_access_token: str

    # Graph API
    graph_api_base_url: str = "https://graph.facebook.com/v25.0"

    model_config = {"env_file": ".env"}


settings = Settings()

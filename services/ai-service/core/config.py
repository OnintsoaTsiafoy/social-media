from pathlib import Path

from pydantic_settings import BaseSettings

SERVICE_NAME = "ai-service"
SERVICE_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    app_name: str = "Hootly AI Service"
    debug: bool = False

    # Seul mode implémenté : les modèles scikit-learn entraînés par
    # `training/train.py` et chargés depuis `artifacts/`. La variable existait
    # déjà (valeur « stub » au Sprint 01, quand aucune analyse n'existait) ;
    # elle garde son rôle de garde-fou de /ready, avec désormais une valeur qui
    # correspond à quelque chose de réel.
    ai_model_mode: str = "local"

    artifacts_dir: Path = SERVICE_ROOT / "artifacts"

    # JWT de service partagé avec Express et le worker. Même mécanique que
    # graph-api (HS256, secret partagé) mais audience distincte : un jeton
    # émis pour graph-api ne doit pas ouvrir ce service, et réciproquement.
    service_jwt_secret: str | None = None

    cors_allowed_origins: str = ""

    # Plafond de taille d'un commentaire analysé. Au-delà, le texte est tronqué
    # plutôt que refusé : Meta laisse passer des commentaires très longs et une
    # analyse sur les 4 000 premiers caractères reste utile.
    max_comment_characters: int = 4000

    # Sprint 10 — génération. `local` (défaut) : générateur déterministe piloté
    # par les réglages de marque, sans réseau ni clé. `llm` : passe par Claude
    # quand une clé est configurée, et retombe sur le générateur local en cas
    # d'indisponibilité (voir modules/generation/provider.py).
    ai_generation_mode: str = "local"
    anthropic_api_key: str | None = None
    generation_model: str = "claude-opus-5"

    # Aligné sur MAX_RESPONSE_LENGTH de l'éditeur de réponse mobile : une
    # proposition plus longue que ce que l'écran accepte serait rejetée à
    # l'enregistrement, après avoir été payée.
    max_response_characters: int = 500
    # Aligné sur MAX_HASHTAGS (social-media/src/lib/validation.ts).
    max_hashtags: int = 15

    model_config = {"env_file": ".env"}

    @property
    def service_jwt_configured(self) -> bool:
        return bool(self.service_jwt_secret) and not self.service_jwt_secret.startswith("change-me")

    @property
    def model_mode_supported(self) -> bool:
        return self.ai_model_mode.strip().lower() == "local"

    @property
    def generation_mode_is_llm(self) -> bool:
        return self.ai_generation_mode.strip().lower() == "llm"

    @property
    def cors_allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]


settings = Settings()

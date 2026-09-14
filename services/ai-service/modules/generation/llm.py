"""Adaptateur Claude, actif uniquement si une clé est configurée.

Volontairement le second choix, pas le défaut : la démonstration et les tests
du sprint doivent fonctionner hors ligne et sans budget (voir `local.py`).
Quand `AI_GENERATION_MODE=llm` et qu'une clé est présente, la génération passe
ici ; sinon le générateur local reprend la main — c'est exactement le même
schéma que `meta_configured` côté graph-api, où l'absence de configuration ne
fait jamais tomber le service.

Aucun appel réel n'est fait dans les tests : ils remplacent `_client()`, comme
les appels Meta sont interceptés par respx dans graph-api.
"""
import logging

from core.config import settings
from modules.generation.prompt import PROMPT_VERSION, build_messages

logger = logging.getLogger("ai_service.generation.llm")

# Court par construction : une réponse de community manager fait deux à trois
# phrases. Un plafond bas évite aussi qu'une consigne malveillante glissée dans
# un commentaire ne produise un pavé.
MAX_TOKENS = 1024


class LlmUnavailable(RuntimeError):
    """Le modèle distant n'a pas pu répondre. Jamais propagée telle quelle au
    client : le fournisseur retombe sur le générateur local."""


def is_configured() -> bool:
    return settings.generation_mode_is_llm and bool(settings.anthropic_api_key)


def _client():
    # Import local : le paquet n'est requis que sur ce chemin, et le service
    # doit démarrer même si la dépendance venait à manquer dans une image
    # allégée.
    import anthropic

    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def generate(
    *,
    brand: dict,
    analysis: dict | None,
    comment_text: str,
    author_name: str | None,
    publication: dict | None,
    history: list[dict],
    language: str,
    tone: str,
    instruction: str | None,
    documents: list[dict] | None = None,
    examples: list[dict] | None = None,
    strategy: str = "llm",
) -> tuple[str, list[dict]]:
    """Retourne `(texte, avertissements)` ou lève `LlmUnavailable`."""
    import anthropic

    system, messages = build_messages(
        brand=brand,
        analysis=analysis,
        comment_text=comment_text,
        author_name=author_name,
        publication=publication,
        history=history,
        language=language,
        tone=tone,
        instruction=instruction,
        documents=documents,
        examples=examples,
        strategy=strategy,
    )

    try:
        response = _client().messages.create(
            model=settings.generation_model,
            max_tokens=MAX_TOKENS,
            # Rédiger une réponse courte conforme à une charte est une tâche
            # simple : un effort faible suffit et réduit la latence vue par le
            # community manager, qui attend devant son écran.
            output_config={"effort": "low"},
            system=system,
            messages=messages,
        )
    except anthropic.AuthenticationError as exc:
        logger.warning("llm_generation_rejected reason=authentication")
        raise LlmUnavailable("Clé d'API refusée.") from exc
    except anthropic.RateLimitError as exc:
        logger.warning("llm_generation_rejected reason=rate_limited")
        raise LlmUnavailable("Modèle momentanément saturé.") from exc
    except anthropic.APIStatusError as exc:
        logger.warning("llm_generation_rejected reason=status status=%s", exc.status_code)
        raise LlmUnavailable(f"Réponse d'erreur du modèle ({exc.status_code}).") from exc
    except anthropic.APIConnectionError as exc:
        logger.warning("llm_generation_rejected reason=connection")
        raise LlmUnavailable("Modèle injoignable.") from exc

    # Un refus de sécurité rend un texte vide ou absent : traité comme une
    # indisponibilité pour que le générateur local prenne le relais, plutôt que
    # de proposer une réponse vide au community manager.
    if response.stop_reason == "refusal":
        logger.warning("llm_generation_refused")
        raise LlmUnavailable("Le modèle a refusé de répondre à ce commentaire.")

    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if not text:
        raise LlmUnavailable("Le modèle n'a produit aucun texte.")

    warnings: list[dict] = []
    if response.stop_reason == "max_tokens":
        warnings.append(
            {
                "code": "response_truncated",
                "severity": "warning",
                "message": "La proposition a été tronquée : relisez-la avant envoi.",
            }
        )

    return text, warnings


GENERATOR_NAME = "claude"
PROMPT = PROMPT_VERSION

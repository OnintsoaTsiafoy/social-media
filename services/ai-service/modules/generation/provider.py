"""Choix du générateur et repli.

Le repli n'est pas un détail d'implémentation : un community manager qui
clique « Générer » doit obtenir une proposition, même si le modèle distant est
saturé. Il obtient alors la proposition du générateur local ET un
avertissement disant laquelle des deux il a sous les yeux — jamais un échec
silencieux ni une substitution invisible.
"""
import logging

from modules.generation import llm, local

logger = logging.getLogger("ai_service.generation")


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
) -> tuple[str, str, str, list[dict]]:
    """Retourne `(texte, générateur, version_de_prompt, avertissements)`.

    `générateur` et `version_de_prompt` remontent jusqu'à la base : sans eux,
    impossible de savoir plus tard si une proposition venait du modèle distant
    ou du repli local, ni sous quelles consignes.
    """
    if llm.is_configured():
        try:
            text, warnings = llm.generate(
                brand=brand,
                analysis=analysis,
                comment_text=comment_text,
                author_name=author_name,
                publication=publication,
                history=history,
                language=language,
                tone=tone,
                instruction=instruction,
            )
            return text, llm.GENERATOR_NAME, llm.PROMPT, warnings
        # `Exception` et pas seulement `LlmUnavailable` : le chemin distant est
        # justement celui dont on ne maîtrise rien (panne, changement de format
        # de réponse, dépendance absente d'une image allégée). Ne rattraper que
        # les erreurs prévues ferait échouer la génération sur la seule classe
        # d'erreurs qu'on n'avait pas anticipée — exactement le cas où le repli
        # est le plus utile.
        except Exception as error:  # noqa: BLE001
            logger.warning("generation_fallback_to_local reason=%s", error)
            text, warnings = local.generate(
                brand=brand,
                analysis=analysis,
                author_name=author_name,
                language=language,
                tone=tone,
                instruction=instruction,
            )
            warnings.append(
                {
                    "code": "llm_fallback",
                    "severity": "warning",
                    "message": (
                        "Le modèle de génération n'était pas disponible : proposition "
                        "produite par le générateur local, à relire attentivement."
                    ),
                }
            )
            return text, local.GENERATOR_NAME, local.GENERATOR_NAME, warnings

    text, warnings = local.generate(
        brand=brand,
        analysis=analysis,
        author_name=author_name,
        language=language,
        tone=tone,
        instruction=instruction,
    )
    return text, local.GENERATOR_NAME, local.GENERATOR_NAME, warnings

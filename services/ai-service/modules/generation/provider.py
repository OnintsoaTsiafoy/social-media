"""Choix du générateur et repli.

Le repli n'est pas un détail d'implémentation : un community manager qui
clique « Générer » doit obtenir une proposition, même si le modèle distant est
saturé. Il obtient alors la proposition du générateur local ET un
avertissement disant laquelle des deux il a sous les yeux — jamais un échec
silencieux ni une substitution invisible.
"""
import logging
import re

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
    documents: list[dict] | None = None,
    examples: list[dict] | None = None,
    strategy: str = "llm",
) -> tuple[str, str, str, list[dict]]:
    """Retourne `(texte, générateur, version_de_prompt, avertissements)`.

    `générateur` et `version_de_prompt` remontent jusqu'à la base : sans eux,
    impossible de savoir plus tard si une proposition venait du modèle distant
    ou du repli local, ni sous quelles consignes.
    """
    if strategy != 'llm' and not documents:
        text = {
            'fr': "Informations insuffisantes : une validation humaine est nécessaire avant de répondre.",
            'en': "Insufficient information: human review is required before replying.",
            'ar': "المعلومات غير كافية. يجب مراجعة الرد بشرياً قبل الإجابة.",
        }.get(language, "Informations insuffisantes : une validation humaine est nécessaire.")
        return text, 'rag-insufficient-context', llm.PROMPT, [{
            'code': 'insufficient_knowledge', 'severity': 'blocking',
            'message': "Aucune source documentaire suffisamment proche. Complétez la base ou rédigez une réponse vérifiée.",
        }]
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
                documents=documents,
                examples=examples,
                strategy=strategy,
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
            if strategy != 'llm':
                text, warnings = grounded_local(documents or [], language)
                warnings.append({'code': 'llm_fallback', 'severity': 'warning', 'message': 'Modèle indisponible : extrait documentaire proposé.'})
                return text, 'local-document-extract-1.0.0', llm.PROMPT, warnings
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

    if strategy != 'llm':
        text, warnings = grounded_local(documents or [], language)
        return text, 'local-document-extract-1.0.0', llm.PROMPT, warnings
    text, warnings = local.generate(
        brand=brand,
        analysis=analysis,
        author_name=author_name,
        language=language,
        tone=tone,
        instruction=instruction,
    )
    return text, local.GENERATOR_NAME, local.GENERATOR_NAME, warnings


def grounded_local(documents: list[dict], language: str) -> tuple[str, list[dict]]:
    """Offline preview only: quote a complete source passage, never invent facts."""
    content = str(documents[0].get('content', '')).strip()
    sentences = re.split(r'(?<=[.!?؟。])\s+|\n+', content)
    selected = []
    for sentence in sentences:
        if len(' '.join(selected + [sentence])) > 480:
            break
        selected.append(sentence)
    text = ' '.join(selected) or content[:480]
    # An extract is useful to the CM but is not a tone/language-aware answer.
    return text, [{'code': 'document_extract', 'severity': 'blocking',
                   'message': "Extrait de source : adaptez et vérifiez ce texte avant validation, ou activez la génération LLM."}]

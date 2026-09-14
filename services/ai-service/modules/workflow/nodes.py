"""Nœuds du graphe d'assistance (Sprint 10 Jour 1).

Chaque nœud est une fonction pure de l'état vers un fragment d'état, ce qui
permet de le tester isolément sans construire le graphe — c'est la tâche
« tester chaque nœud isolément » de la fiche, et la raison pour laquelle la
logique ne vit pas dans l'assemblage de `graph.py`.

Aucun nœud ne lève : une erreur est écrite dans `errors` et le graphe décide
de la suite. Une exception traversant LangGraph ferait perdre l'état partiel,
donc la raison de l'échec.
"""
import logging

from core.config import settings
from modules.generation import provider
from modules.generation.language import response_language
from modules.nlp import pipeline
from modules.nlp.language import detect_language
from modules.safety import checks
from modules.workflow.state import AssistanceState

logger = logging.getLogger("ai_service.workflow")

SUPPORTED_RESPONSE_LANGUAGES = ("fr", "en", "ar")


def validate(state: AssistanceState) -> dict:
    """Refuse ce qui ne peut pas produire une réponse utile."""
    text = (state.get("commentText") or "").strip()
    if not text:
        return {
            "errors": [
                {
                    "code": "empty_comment",
                    "message": "Le commentaire est vide : il n'y a rien à quoi répondre.",
                }
            ]
        }
    if len(text) > settings.max_comment_characters:
        # Tronqué plutôt que refusé : un commentaire très long reste
        # exploitable, et le refuser priverait le community manager d'aide
        # précisément sur le message le plus pénible à traiter.
        return {"commentText": text[: settings.max_comment_characters]}
    return {"commentText": text}


def resolve_language(state: AssistanceState) -> dict:
    """Langue de la RÉPONSE, qui n'est pas forcément celle du commentaire.

    Priorité : ce que le community manager a choisi à l'écran, puis la langue
    principale de la marque, puis le français. La langue détectée du
    commentaire ne décide pas : répondre automatiquement dans la langue de
    l'auteur serait un choix éditorial que la marque n'a pas fait.
    """
    requested = (state.get("requestedLanguage") or "").strip().lower()
    brand_language = (state.get("brand", {}).get("language") or "").strip().lower()
    language = requested or brand_language or "fr"
    if language not in SUPPORTED_RESPONSE_LANGUAGES:
        language = "fr"

    detected, _ = detect_language(state.get("commentText", ""))
    if state.get('strategy', 'llm') != 'llm' and not requested:
        language = response_language(state.get('commentText', ''), language)
    warnings = []
    if detected == "other" and language == "fr":
        warnings.append(
            {
                "code": "comment_language_differs",
                "severity": "info",
                "message": (
                    "Le commentaire ne semble pas rédigé en français ; la réponse est "
                    "proposée en français."
                ),
            }
        )
    return {"language": language, "warnings": state.get("warnings", []) + warnings}


def analyse(state: AssistanceState) -> dict:
    """Réutilise l'analyse du Sprint 09, jamais une seconde implémentation."""
    try:
        result = pipeline.analyse(state["commentText"])
    except Exception as error:  # noqa: BLE001 - converti en erreur d'état
        logger.warning("workflow_analysis_failed error=%s", error)
        # La génération reste possible sans analyse : la réponse sera
        # simplement moins ajustée, ce qui vaut mieux qu'un écran en erreur.
        return {
            "analysis": None,
            "warnings": state.get("warnings", [])
            + [
                {
                    "code": "analysis_unavailable",
                    "severity": "warning",
                    "message": "L'analyse n'a pas pu être calculée : la proposition est générique.",
                }
            ],
        }

    return {
        "analysis": {
            "sentiment": result.sentiment,
            "intent": result.intent,
            "priority": result.priority,
            "confidence": result.confidence,
            "urgent": result.urgent,
            "sensitive": result.sensitive,
            "lowConfidence": result.low_confidence,
            "recommendedAction": result.recommended_action,
            "explanation": result.explanation,
            "modelVersion": result.model_version,
        }
    }


def prioritise(state: AssistanceState) -> dict:
    """Remonte la priorité au niveau du graphe et signale les sujets sensibles.

    Un sujet sensible ne bloque pas la génération — le community manager a
    justement besoin d'un brouillon — mais il ne doit jamais être proposé comme
    une réponse ordinaire.
    """
    analysis = state.get("analysis") or {}
    priority = analysis.get("priority", "medium")
    warnings = list(state.get("warnings", []))

    if analysis.get("sensitive"):
        warnings.append(
            {
                "code": "sensitive_topic",
                "severity": "warning",
                "message": (
                    "Sujet sensible détecté : faites relire cette réponse par un responsable "
                    "avant de l'envoyer."
                ),
            }
        )
    if analysis.get("lowConfidence"):
        warnings.append(
            {
                "code": "low_confidence_analysis",
                "severity": "info",
                "message": "L'analyse du commentaire est peu fiable : vérifiez que la réponse est adaptée.",
            }
        )

    return {"priority": priority, "warnings": warnings}


def build_context(state: AssistanceState) -> dict:
    """Assemble le contexte transmis au générateur, et le rend inspectable.

    Le texte produit ici n'est pas le prompt (celui-ci est construit dans
    `modules/generation/prompt.py`) : c'est un résumé lisible de ce que le
    graphe a réuni, renvoyé dans la réponse pour qu'on puisse vérifier après
    coup *ce que le générateur avait sous les yeux* — notamment qu'aucun
    historique de trop n'y est entré.
    """
    brand = state.get("brand", {})
    parts = [f"marque={brand.get('name') or 'inconnue'}"]
    parts.append(f"ton={state.get('requestedTone') or brand.get('tone') or 'professional'}")
    parts.append(f"langue={state.get('language', 'fr')}")
    if state.get("publication"):
        parts.append("publication=incluse")
    history = state.get("history") or []
    if history:
        parts.append(f"historique={len(history)} échange(s)")
    if state.get("instruction"):
        parts.append("consigne=fournie")
    analysis = state.get("analysis")
    if analysis:
        parts.append(f"analyse={analysis.get('sentiment')}/{analysis.get('intent')}")
    parts.append(f"documents={len(state.get('documents') or [])}")
    parts.append(f"exemples_validés={len(state.get('examples') or [])}")
    return {"context": ", ".join(parts)}


def generate(state: AssistanceState) -> dict:
    brand = state.get("brand", {})
    tone = (state.get("requestedTone") or brand.get("tone") or "professional").lower()

    try:
        text, generator, prompt_version, warnings = provider.generate(
            brand=brand,
            analysis=state.get("analysis"),
            comment_text=state.get("commentText", ""),
            author_name=state.get("authorName"),
            publication=state.get("publication"),
            history=state.get("history") or [],
            language=state.get("language", "fr"),
            tone=tone,
            instruction=state.get("instruction"),
            documents=state.get("documents") or [],
            examples=state.get("examples") or [],
            strategy=state.get("strategy", "llm"),
        )
    except Exception as error:  # noqa: BLE001
        logger.warning("workflow_generation_failed error=%s", error)
        return {
            "errors": state.get("errors", [])
            + [{"code": "generation_failed", "message": "La génération a échoué."}]
        }

    return {
        "draft": text,
        "generator": generator,
        "promptVersion": prompt_version,
        "warnings": state.get("warnings", []) + warnings,
    }


def safety(state: AssistanceState) -> dict:
    draft = state.get("draft", "")
    warnings = list(state.get("warnings", []))
    if state.get('strategy', 'llm') != 'llm':
        lower = draft.lower()
        if any(phrase in lower for phrase in ['validation humaine', 'human review is required', 'informations insuffisantes', 'insufficient information']):
            if not any(w['code'] == 'insufficient_knowledge' for w in warnings):
                warnings.append({'code': 'insufficient_knowledge', 'severity': 'blocking',
                                 'message': "Le générateur indique que le contexte est insuffisant. Vérifiez et adaptez la réponse."})
    warnings.extend(
        checks.check(
            text=draft,
            brand=state.get("brand", {}),
            language=state.get("language", "fr"),
            max_characters=settings.max_response_characters,
        )
    )
    return {"warnings": warnings, "blocked": checks.is_blocked(warnings)}


def decide_action(state: AssistanceState) -> dict:
    """Décision finale, jamais un envoi.

    Aucune branche ne publie quoi que ce soit : l'approbation humaine reste
    obligatoire (risque « envoyer automatiquement une réponse » de la fiche).
    Cette valeur dit seulement à l'écran quoi mettre en avant.
    """
    if state.get("errors"):
        return {"action": "failed"}
    if state.get("blocked"):
        return {"action": "blocked"}
    analysis = state.get("analysis") or {}
    if analysis.get("sensitive") or state.get("priority") == "high":
        return {"action": "escalate"}
    return {"action": "propose"}

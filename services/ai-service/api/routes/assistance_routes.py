"""Routes de génération assistée (Sprint 10).

Déclarées `def` et non `async def` : le graphe est synchrone et, en mode
`llm`, il fait un appel réseau bloquant. Starlette exécute une route
synchrone dans un pool de threads, ce qui empêche cet appel de geler la boucle
d'événements — une route `async def` contenant un appel bloquant bloquerait
tout le service pendant la génération.

Aucune de ces routes n'envoie quoi que ce soit : elles produisent des
propositions. L'envoi réel reste `/internal/v1/comments/reply` de graph-api,
déclenché par une approbation humaine explicite (Sprint 08).
"""
import logging

from fastapi import APIRouter, Depends, Request

from core.config import settings
from core.exceptions import AIServiceError
from core.security import require_service_jwt
from modules.generation import hashtags as hashtags_module
from modules.safety import checks
from modules.workflow import graph
from modules.workflow.schemas import (
    AssistanceRequest,
    AssistanceResult,
    GenerateResponseResult,
    HashtagRequest,
    HashtagResult,
    SafetyCheckRequest,
    SafetyCheckResult,
    SuggestionPayload,
)

logger = logging.getLogger("ai_service.assistance")

router = APIRouter(prefix="/internal/v1", tags=["assistance"])


def _run(payload: AssistanceRequest) -> dict:
    state = graph.run(
        commentId=payload.commentId,
        commentText=payload.commentText,
        authorName=payload.authorName,
        brand=payload.brand.model_dump(),
        publication=payload.publication.model_dump() if payload.publication else None,
        history=[entry.model_dump() for entry in payload.history],
        instruction=payload.instruction,
        requestedTone=payload.tone,
        requestedLanguage=payload.language,
        documents=payload.documents,
        examples=payload.examples,
        strategy=payload.strategy,
    )

    errors = state.get("errors") or []
    if errors and not state.get("draft"):
        # Un commentaire vide ou une génération en échec sont des situations
        # que l'appelant doit distinguer d'une proposition bloquée par le
        # contrôle de sécurité : statut différent, code différent.
        first = errors[0]
        raise AIServiceError(
            status_code=400 if first.get("code") == "empty_comment" else 503,
            detail=first.get("message", "La génération a échoué."),
            code="validation_failed" if first.get("code") == "empty_comment" else "ai_error",
        )
    return state


def _suggestion(payload: AssistanceRequest, state: dict) -> SuggestionPayload:
    brand_tone = payload.brand.tone or "professional"
    return SuggestionPayload(
        text=state.get("draft", ""),
        language=state.get("language", "fr"),
        tone=(payload.tone or brand_tone).lower(),
        generator=state.get("generator", "local-template-1.0.0"),
        promptVersion=state.get("promptVersion", "local-template-1.0.0"),
        blocked=bool(state.get("blocked")),
        action=state.get("action", "propose"),
        warnings=state.get("warnings", []),
    )


@router.post("/responses/generate", response_model=GenerateResponseResult)
def generate_response(
    payload: AssistanceRequest,
    request: Request,
    _claims: dict = Depends(require_service_jwt("ai:generate")),
) -> GenerateResponseResult:
    """Proposition de réponse seule — ce qu'appelle l'éditeur de réponse mobile."""
    state = _run(payload)
    logger.info(
        "response_generated commentId=%s generator=%s action=%s warnings=%d requestId=%s",
        payload.commentId,
        state.get("generator"),
        state.get("action"),
        len(state.get("warnings", [])),
        getattr(request.state, "request_id", None),
    )
    return GenerateResponseResult(commentId=payload.commentId, suggestion=_suggestion(payload, state), analysis=state.get('analysis'))


@router.post("/workflows/comment-assistance", response_model=AssistanceResult)
def comment_assistance(
    payload: AssistanceRequest,
    _claims: dict = Depends(require_service_jwt("ai:generate")),
) -> AssistanceResult:
    """Parcours complet : analyse, priorité, contexte, génération, contrôle.

    Même graphe que `/responses/generate`, mais l'état entier est rendu —
    utile pour instrumenter le parcours et pour un appelant qui n'a pas déjà
    l'analyse du commentaire.
    """
    state = _run(payload)
    return AssistanceResult(
        commentId=payload.commentId,
        context=state.get("context", ""),
        priority=state.get("priority", "medium"),
        analysis=state.get("analysis"),
        suggestion=_suggestion(payload, state),
        errors=state.get("errors", []),
    )


@router.post("/responses/safety-check", response_model=SafetyCheckResult)
def safety_check(
    payload: SafetyCheckRequest,
    _claims: dict = Depends(require_service_jwt("ai:generate")),
) -> SafetyCheckResult:
    """Contrôle d'un texte **déjà rédigé**, y compris réécrit à la main.

    C'est le cas d'usage principal de cette route : la réécriture humaine est
    le moment où un engagement non autorisé a le plus de chances d'apparaître,
    et un contrôle limité aux sorties du générateur passerait à côté.
    """
    warnings = checks.check(
        text=payload.text,
        brand=payload.brand.model_dump(),
        language=payload.language,
        max_characters=settings.max_response_characters,
    )
    return SafetyCheckResult(blocked=checks.is_blocked(warnings), warnings=warnings)


@router.post("/hashtags/generate", response_model=HashtagResult)
def generate_hashtags(
    payload: HashtagRequest,
    _claims: dict = Depends(require_service_jwt("ai:generate")),
) -> HashtagResult:
    limit = payload.limit or settings.max_hashtags
    return HashtagResult(
        hashtags=hashtags_module.generate(
            text=payload.text,
            brand=payload.brand.model_dump(),
            preserve=payload.preserve,
            limit=limit,
        ),
        keywords=hashtags_module.keywords(payload.text),
    )

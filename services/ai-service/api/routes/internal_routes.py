"""Routes serveur-à-serveur du service d'analyse (Sprint 09).

Appelées par Express (analyse à la demande depuis l'écran commentaire) et par
le worker (analyse automatique des commentaires reçus). Jamais par le mobile :
docs/DECISIONS_ARCHITECTURE.md interdit au téléphone d'atteindre autre chose
que l'API Express.
"""
import logging

from fastapi import APIRouter, Depends, Request

from core.security import require_service_jwt
from modules.nlp.pipeline import analyse, models_info
from modules.nlp.schemas import (
    AnalysisPayload,
    AnalyzeCommentRequest,
    AnalyzeCommentResponse,
    ModelsInfoResponse,
)

logger = logging.getLogger("ai_service.internal")

router = APIRouter(prefix="/internal/v1", tags=["internal"])


@router.post("/comments/analyze", response_model=AnalyzeCommentResponse)
async def analyze_comment(
    payload: AnalyzeCommentRequest,
    request: Request,
    _claims: dict = Depends(require_service_jwt("ai:analyze")),
) -> AnalyzeCommentResponse:
    result = analyse(payload.text)
    logger.info(
        "comment_analyzed commentId=%s sentiment=%s intent=%s priority=%s confidence=%.2f requestId=%s",
        payload.commentId,
        result.sentiment,
        result.intent,
        result.priority,
        result.confidence,
        getattr(request.state, "request_id", None),
    )
    return AnalyzeCommentResponse(
        commentId=payload.commentId,
        analysis=AnalysisPayload(
            sentiment=result.sentiment,
            intent=result.intent,
            priority=result.priority,
            confidence=result.confidence,
            sentimentConfidence=result.sentiment_confidence,
            intentConfidence=result.intent_confidence,
            lowConfidence=result.low_confidence,
            urgent=result.urgent,
            sensitive=result.sensitive,
            language=result.language,
            recommendedAction=result.recommended_action,
            explanation=result.explanation,
            modelVersion=result.model_version,
            datasetVersion=result.dataset_version,
            analysedAt=result.analyzed_at,
            signals=result.signals,
            topTerms=result.top_terms,
        ),
    )


@router.get("/models/info", response_model=ModelsInfoResponse)
async def models_information(
    _claims: dict = Depends(require_service_jwt("ai:analyze")),
) -> ModelsInfoResponse:
    """Carte du modèle servi : version, dataset, hyperparamètres et métriques
    de test. Sert à vérifier en exploitation *quel* modèle a produit une
    analyse stockée, sans avoir à relire les journaux."""
    return ModelsInfoResponse(**models_info())

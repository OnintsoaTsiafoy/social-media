"""Route d'explication du meilleur horaire de publication (sprint_listing/PLUS/
TODO_RECOMMANDATION_MEILLEUR_HORAIRE.md, section 6).

Déclarée `def`, pas `async def` : comme `assistance_routes.py`, le générateur
peut faire un appel réseau bloquant vers Claude ; Starlette l'exécute dans un
pool de threads, ce qu'une route `async def` empêcherait.
"""
import logging

from fastapi import APIRouter, Depends, Request

from core.security import require_service_jwt
from modules.analytics import best_times_explainer, competitor_explainer
from modules.analytics.competitor_schemas import (
    CompetitorExplainRequest,
    CompetitorExplanationResult,
)
from modules.analytics.schemas import BestTimesExplainRequest, BestTimesExplanationResult
from modules.analytics import insight_explainer
from modules.analytics.insight_schemas import AnalyticsExplainRequest, AnalyticsExplanationResult

logger = logging.getLogger("ai_service.analytics")

router = APIRouter(prefix="/internal/v1", tags=["analytics"])


@router.post("/analytics/explain", response_model=AnalyticsExplanationResult)
def explain_analytics(
    payload: AnalyticsExplainRequest,
    request: Request,
    _claims: dict = Depends(require_service_jwt("ai:generate")),
) -> AnalyticsExplanationResult:
    result = insight_explainer.generate(payload, request.state.request_id)
    logger.info("analytics_explained requestId=%s model=%s status=%s",
                request.state.request_id, result.model, result.aiStatus)
    return result


@router.post("/analytics/best-times/explain", response_model=BestTimesExplanationResult)
def explain_best_times(
    payload: BestTimesExplainRequest,
    _claims: dict = Depends(require_service_jwt("ai:generate")),
) -> BestTimesExplanationResult:
    text, generator, warnings = best_times_explainer.generate(facts=payload.model_dump())
    logger.info("best_times_explained network=%s generator=%s", payload.network, generator)
    return BestTimesExplanationResult(text=text, generator=generator, warnings=warnings)


@router.post("/analytics/competitors/explain", response_model=CompetitorExplanationResult)
def explain_competitors(
    payload: CompetitorExplainRequest,
    _claims: dict = Depends(require_service_jwt("ai:generate")),
) -> CompetitorExplanationResult:
    """Synthèse d'une comparaison concurrentielle déjà calculée par Express.

    Aucun KPI n'est recalculé ici : tout chiffre du texte doit provenir du
    corps reçu, sans quoi la sortie du modèle est rejetée au profit du gabarit
    local (voir competitor_explainer._validate_numbers).
    """
    text, recommendations, generator, warnings = competitor_explainer.generate(
        facts=payload.model_dump()
    )
    logger.info(
        "competitors_explained count=%d generator=%s", len(payload.competitors), generator
    )
    return CompetitorExplanationResult(
        text=text, recommendations=recommendations, generator=generator, warnings=warnings
    )

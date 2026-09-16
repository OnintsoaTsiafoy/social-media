"""The LLM prioritizes verified evidence; rendering cannot introduce new claims."""
import json
import logging

from core.config import settings
from modules.analytics.insight_schemas import (
    AnalyticsExplainRequest,
    AnalyticsExplanationResult,
    InsightExplanation,
    InsightPlan,
)

logger = logging.getLogger("ai_service.analytics.insights")
EMPTY_SUMMARY = "Les données disponibles ne permettent pas encore de dégager une analyse fiable."
SYSTEM_PROMPT = (
    "Tu prépares une analyse concise en français pour un community manager. "
    "Les métriques, faits, formulations et recommandations ont déjà été calculés et vérifiés "
    "par le backend. Sélectionne uniquement leurs identifiants, selon leur importance. "
    "Ne calcule, n'invente et ne reformule aucun chiffre. N'utilise aucune métrique absente, "
    "partielle ou indisponible. Retourne uniquement un objet JSON avec les listes d'identifiants "
    "summary (un ou deux faits), importantFacts (quatre maximum), positivePoints (trois maximum, "
    "polarity=positive), attentionPoints (trois maximum, polarity=attention), recommendations "
    "(trois maximum, faits possédant une recommandation). Aucun texte libre ni autre clé. "
    "Privilégie les urgences et variations significatives. Les listes peuvent être vides, "
    "sauf summary si des faits sont fournis. Les avertissements seront affichés séparément."
)


def local_plan(payload: AnalyticsExplainRequest) -> InsightPlan:
    facts = payload.facts
    return InsightPlan(
        summary=[fact.id for fact in facts[:2]],
        importantFacts=[fact.id for fact in facts[:4]],
        positivePoints=[fact.id for fact in facts if fact.polarity == "positive"][:3],
        attentionPoints=[fact.id for fact in facts if fact.polarity == "attention"][:3],
        recommendations=[fact.id for fact in facts if fact.recommendation][:3],
    )


def render(payload: AnalyticsExplainRequest, plan: InsightPlan) -> InsightExplanation:
    if payload.facts and not plan.summary:
        raise ValueError("Summary must reference evidence")
    facts = {fact.id: fact for fact in payload.facts}
    referenced = []
    result = {}
    for section, ids in plan.model_dump().items():
        texts = []
        for fact_id in ids:
            fact = facts.get(fact_id)
            if fact is None:
                raise ValueError("Unknown evidence")
            if section == "positivePoints" and fact.polarity != "positive":
                raise ValueError("Invalid positive point")
            if section == "attentionPoints" and fact.polarity != "attention":
                raise ValueError("Invalid attention point")
            if section == "recommendations" and not fact.recommendation:
                raise ValueError("Recommendation without evidence")
            if fact.metric not in referenced:
                referenced.append(fact.metric)
            text = fact.recommendation if section == "recommendations" else fact.message
            if text not in texts:
                texts.append(text)
        result[section] = texts
    result["summary"] = " ".join(result["summary"]) or EMPTY_SUMMARY
    return InsightExplanation(**result, referencedMetrics=referenced, warnings=payload.warnings)


def llm_plan(payload: AnalyticsExplainRequest) -> InsightPlan:
    import anthropic

    # Bounded below the Express deadline; no SDK retries that extend it.
    with anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=18.0, max_retries=0) as client:
        response = client.messages.create(
            model=settings.generation_model,
            max_tokens=800,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": payload.model_dump_json()}],
        )
    if response.stop_reason != "end_turn":
        raise ValueError("Incomplete model output")
    raw = "".join(block.text for block in response.content if block.type == "text")
    if len(raw) > 6000:
        raise ValueError("Model output too long")
    return InsightPlan.model_validate(json.loads(raw))


def generate(payload: AnalyticsExplainRequest, request_id: str) -> AnalyticsExplanationResult:
    if payload.facts and settings.generation_mode_is_llm and settings.anthropic_api_key:
        try:
            plan = llm_plan(payload)
            explanation = render(payload, plan)
            return AnalyticsExplanationResult(plan=plan, explanation=explanation,
                                              model=settings.generation_model, aiStatus="available")
        except Exception:  # Provider and validation failures have the same safe fallback.
            # Never log provider exceptions: they can include payloads or credentials.
            logger.warning("analytics_explain_fallback requestId=%s", request_id)
    plan = local_plan(payload)
    return AnalyticsExplanationResult(plan=plan, explanation=render(payload, plan),
                                      model="analytics-local-v1", aiStatus="fallback")

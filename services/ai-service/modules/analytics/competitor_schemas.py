"""Schémas de `/internal/v1/analytics/competitors/explain` (section 10 du TODO
analyse concurrentielle).

Mêmes conventions que `schemas.py` : ai-service reste sans état et ne recalcule
jamais une statistique. Il ne reçoit ici que des métriques DÉJÀ calculées par
Express (`services/api/src/competitors/analytics.js::toAiFacts`).

Deux choix de forme portent directement une exigence du TODO :

  - `metrics` ne contient que des métriques disponibles des deux côtés. Une
    métrique manquante n'arrive pas à `null`, elle n'arrive pas du tout — elle
    figure seulement, sous forme de libellé, dans `unavailableMetrics`. Le
    modèle ne peut donc pas « utiliser une donnée absente » : il ne la voit
    pas.
  - chaque comparaison porte ses `interactionComponents`, pour que le texte
    puisse dire sur quelle base les interactions ont été rapprochées.
"""
from typing import Literal

from pydantic import BaseModel, Field


class ComparedMetric(BaseModel):
    key: str
    label: str
    unit: Literal["count", "percent"]
    brand: float
    competitor: float
    differencePercent: float | None = None


class CompetitorComparison(BaseModel):
    name: str
    network: str
    postsCount: int
    brandPostsCount: int
    interactionComponents: list[str] = Field(default_factory=list)
    metrics: list[ComparedMetric] = Field(default_factory=list)
    unavailableMetrics: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class CompetitorExplainRequest(BaseModel):
    period: Literal["7d", "30d", "90d"]
    periodStart: str
    periodEnd: str
    # Plafonné comme `alternatives` dans BestTimesExplainRequest : Express n'en
    # envoie jamais plus de 10 (limite de `comparisonQuerySchema`), et cette
    # borne empêche un appelant dévoyé de gonfler le prompt.
    competitors: list[CompetitorComparison] = Field(default_factory=list, max_length=10)


class WarningPayload(BaseModel):
    code: str
    severity: str
    message: str


class CompetitorExplanationResult(BaseModel):
    text: str
    # Au plus 3, conformément au TODO. Le plafond est appliqué à la génération,
    # pas seulement déclaré ici.
    recommendations: list[str] = Field(default_factory=list, max_length=3)
    generator: str
    warnings: list[WarningPayload] = Field(default_factory=list)

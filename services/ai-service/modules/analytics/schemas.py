"""Schémas de `/internal/v1/analytics/best-times/explain`.

Mêmes conventions que `modules/workflow/schemas.py` : ai-service reste sans
état, tous les faits (créneau retenu, alternatives, échantillon) sont calculés
par Express (`services/api/src/analytics/bestTimes.js`) et transmis tels
quels — ce service ne recalcule jamais une statistique, il ne fait que la
mettre en mots.
"""
from typing import Literal

from pydantic import BaseModel, Field


class BestSlotPayload(BaseModel):
    weekday: int = Field(ge=0, le=6)
    weekdayLabel: str
    slotId: str
    slotStartHour: int
    slotEndHour: int
    slotLabel: str
    score: float
    confidence: Literal["low", "medium", "high"]
    sampleSize: int
    metrics: dict
    deltaVsAveragePercent: float | None = None


class BestTimesExplainRequest(BaseModel):
    network: Literal["facebook", "instagram"]
    period: Literal["7d", "30d", "90d"]
    analyzedCount: int
    best: BestSlotPayload
    # Au plus 2 côté Express (analyticsBestTimes ne renvoie jamais plus de 2
    # alternatives) — plafonné ici aussi pour qu'un appelant qui dévierait de
    # ce contrat ne puisse pas gonfler le prompt envoyé au modèle.
    alternatives: list[BestSlotPayload] = Field(default_factory=list, max_length=2)


class WarningPayload(BaseModel):
    code: str
    severity: str
    message: str


class BestTimesExplanationResult(BaseModel):
    text: str
    generator: str
    warnings: list[WarningPayload] = Field(default_factory=list)

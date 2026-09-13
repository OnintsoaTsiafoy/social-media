"""Schémas Pydantic de /internal/v1 (Sprint 09 Jour 5).

Le contrat est calé sur le type `AiAnalysis` déjà défini côté mobile
(social-media/src/types/index.ts) : les écrans 18 et 19 existent depuis le
Sprint 01 et attendent exactement ces champs. Les deux ajouts par rapport à ce
type — `lowConfidence` et `signals` — sont des informations que le mobile
n'avait aucun moyen d'obtenir tant que l'analyse était une fixture.
"""
from pydantic import BaseModel, Field

Sentiment = str
Intent = str
Priority = str


class AnalyzeCommentRequest(BaseModel):
    # `commentId` n'est pas utilisé pour l'analyse elle-même : il sert
    # uniquement à corréler les journaux entre Express, le worker et ce
    # service. Le service reste sans état et n'écrit dans aucune table.
    commentId: str | None = None
    text: str = Field(min_length=1)


class AnalysisPayload(BaseModel):
    sentiment: Sentiment
    intent: Intent
    priority: Priority
    confidence: float
    sentimentConfidence: float
    intentConfidence: float
    lowConfidence: bool
    urgent: bool
    sensitive: bool
    language: str
    recommendedAction: str
    explanation: str
    modelVersion: str
    datasetVersion: str
    analysedAt: str
    signals: list[str]
    topTerms: list[str]


class AnalyzeCommentResponse(BaseModel):
    commentId: str | None = None
    analysis: AnalysisPayload


class ModelTaskInfo(BaseModel):
    regularisation: float
    validationMacroF1: float
    confidenceThreshold: float
    confidentAccuracy: float
    confidentCoverage: float


class ModelsInfoResponse(BaseModel):
    modelVersion: str
    datasetVersion: str
    fullVersion: str
    trainedAt: str
    randomSeed: int
    algorithm: str
    library: dict
    dataset: dict
    tasks: dict[str, ModelTaskInfo]
    metrics: dict | None = None

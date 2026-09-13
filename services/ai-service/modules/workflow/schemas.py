"""Schémas Pydantic des routes du Sprint 10.

Le contexte de marque et l'historique sont transmis **par l'appelant** :
ai-service reste sans état et ne lit aucune table, exactement comme pour
l'analyse du Sprint 09. C'est aussi ce qui borne l'historique — le service ne
peut pas en réclamer davantage que ce qu'Express a décidé d'envoyer.
"""
from pydantic import BaseModel, Field


class BrandContextPayload(BaseModel):
    name: str | None = None
    tone: str = "professional"
    customTone: str | None = None
    formality: str = "adaptive"
    language: str = "fr"
    emojisAllowed: bool = True
    targetLength: str = "2 phrases"
    greeting: str | None = None
    closing: str | None = None
    forbiddenTerms: list[str] = Field(default_factory=list)
    recommendedTerms: list[str] = Field(default_factory=list)
    instructions: str | None = None
    complaintInstructions: str | None = None
    urgencyInstructions: str | None = None
    supportInstructions: str | None = None


class PublicationContextPayload(BaseModel):
    content: str | None = None
    hashtags: list[str] = Field(default_factory=list)


class HistoryEntryPayload(BaseModel):
    author: str | None = None
    text: str


class AssistanceRequest(BaseModel):
    commentId: str | None = None
    commentText: str
    authorName: str | None = None
    brand: BrandContextPayload = Field(default_factory=BrandContextPayload)
    publication: PublicationContextPayload | None = None
    # Déjà tronqué par Express : le service ne redemande jamais d'historique et
    # n'en conserve aucun entre deux appels.
    history: list[HistoryEntryPayload] = Field(default_factory=list, max_length=10)
    instruction: str | None = Field(default=None, max_length=1000)
    tone: str | None = None
    language: str | None = None


class WarningPayload(BaseModel):
    code: str
    severity: str
    message: str
    matches: list[str] | None = None


class SuggestionPayload(BaseModel):
    text: str
    language: str
    tone: str
    generator: str
    promptVersion: str
    blocked: bool
    action: str
    warnings: list[WarningPayload]


class GenerateResponseResult(BaseModel):
    commentId: str | None = None
    suggestion: SuggestionPayload


class AssistanceResult(BaseModel):
    commentId: str | None = None
    # Le contexte réellement assemblé par le graphe, rendu inspectable pour
    # qu'on puisse vérifier après coup ce que le générateur avait sous les yeux.
    context: str
    priority: str
    analysis: dict | None = None
    suggestion: SuggestionPayload | None = None
    errors: list[dict] = Field(default_factory=list)


class SafetyCheckRequest(BaseModel):
    text: str
    brand: BrandContextPayload = Field(default_factory=BrandContextPayload)
    language: str = "fr"


class SafetyCheckResult(BaseModel):
    blocked: bool
    warnings: list[WarningPayload]


class HashtagRequest(BaseModel):
    text: str = Field(min_length=1)
    brand: BrandContextPayload = Field(default_factory=BrandContextPayload)
    # Hashtags déjà sélectionnés par le community manager : renvoyés en tête et
    # jamais évincés par le plafond.
    preserve: list[str] = Field(default_factory=list)
    limit: int | None = Field(default=None, ge=1, le=30)


class HashtagResult(BaseModel):
    hashtags: list[str]
    keywords: list[str]

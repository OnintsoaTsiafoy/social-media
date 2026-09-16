"""Strict evidence-only contract; no comments, credentials or publication text."""
from datetime import datetime
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


Identifier = Annotated[str, StringConstraints(min_length=1, max_length=80, pattern=r"^[A-Za-z][A-Za-z0-9_.]*$")]
ShortText = Annotated[str, StringConstraints(min_length=1, max_length=350)]
Unit = Literal["count", "percent", "percentage_points"]


class Metric(StrictModel):
    label: ShortText
    value: float | None
    unit: Unit
    availability: Literal["available", "partial", "unavailable"]

    @model_validator(mode="after")
    def availability_matches_value(self):
        if (self.value is None) != (self.availability == "unavailable"):
            raise ValueError("Unavailable metrics must be null")
        return self


class Fact(StrictModel):
    id: Identifier
    type: Identifier
    metric: Identifier
    value: float
    unit: Unit
    polarity: Literal["neutral", "positive", "attention"]
    message: ShortText
    recommendation: ShortText | None


class AnalyticsExplainRequest(StrictModel):
    period: Literal["7d", "30d", "90d"]
    network: Literal["all", "facebook", "instagram"]
    periodStart: str = Field(max_length=32)
    periodEnd: str = Field(max_length=32)
    metrics: dict[Identifier, Metric] = Field(max_length=80)
    facts: list[Fact] = Field(max_length=32)
    warnings: list[Annotated[str, StringConstraints(max_length=500)]] = Field(max_length=9)

    @model_validator(mode="after")
    def validate_evidence(self):
        start = datetime.fromisoformat(self.periodStart.replace("Z", "+00:00"))
        end = datetime.fromisoformat(self.periodEnd.replace("Z", "+00:00"))
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError("Invalid analytics period")
        if len({fact.id for fact in self.facts}) != len(self.facts):
            raise ValueError("Duplicate fact IDs")
        for fact in self.facts:
            source = self.metrics.get(fact.metric)
            if (source is None or source.availability != "available"
                    or source.value != fact.value or source.unit != fact.unit):
                raise ValueError("Fact references missing or inconsistent evidence")
            numbers = re.findall(r"[+-]?\d+(?:[.,]\d+)?", fact.message)
            if any(float(number.replace(",", ".")) != fact.value for number in numbers):
                raise ValueError("Fact text contains an unverified number")
            if fact.recommendation and re.search(r"\d", fact.recommendation):
                raise ValueError("Recommendations must not introduce numbers")
        return self


class InsightPlan(StrictModel):
    summary: list[Identifier] = Field(max_length=2)
    importantFacts: list[Identifier] = Field(max_length=4)
    positivePoints: list[Identifier] = Field(max_length=3)
    attentionPoints: list[Identifier] = Field(max_length=3)
    recommendations: list[Identifier] = Field(max_length=3)

    @model_validator(mode="after")
    def unique_references(self):
        for ids in self.model_dump().values():
            if len(set(ids)) != len(ids):
                raise ValueError("Duplicate references")
        return self


class InsightExplanation(StrictModel):
    summary: str = Field(max_length=700)
    importantFacts: list[ShortText] = Field(max_length=4)
    positivePoints: list[ShortText] = Field(max_length=3)
    attentionPoints: list[ShortText] = Field(max_length=3)
    recommendations: list[ShortText] = Field(max_length=3)
    referencedMetrics: list[Identifier] = Field(max_length=15)
    warnings: list[Annotated[str, StringConstraints(max_length=500)]] = Field(max_length=10)


class AnalyticsExplanationResult(StrictModel):
    plan: InsightPlan
    explanation: InsightExplanation
    model: str = Field(min_length=1, max_length=120)
    aiStatus: Literal["available", "fallback"]

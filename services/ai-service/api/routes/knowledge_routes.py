import base64
import binascii
import logging
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core.exceptions import AIServiceError
from core.security import require_service_jwt
from modules.knowledge import pipeline

router = APIRouter(prefix="/internal/v1/knowledge", tags=["knowledge"], dependencies=[Depends(require_service_jwt("ai:knowledge"))])
logger = logging.getLogger("ai_service.knowledge")


class ExtractRequest(BaseModel):
    data: str = Field(max_length=14_000_000)
    filename: str = Field(min_length=1, max_length=255)
    mimeType: str = Field(max_length=127)


class PrepareRequest(BaseModel):
    content: str = Field(min_length=1, max_length=pipeline.MAX_CHARACTERS)


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=32)
    kind: Literal["query", "passage"] = "query"


@router.post("/extract")
def extract(payload: ExtractRequest):
    try:
        data = base64.b64decode(payload.data, validate=True)
        return {"content": pipeline.extract_text(data, payload.filename, payload.mimeType)}
    except (ValueError, binascii.Error) as exc:
        raise AIServiceError(status_code=400, code="validation_failed", detail=str(exc)) from exc


def _run(operation):
    try:
        return operation()
    except ValueError as exc:
        raise AIServiceError(status_code=400, code="validation_failed", detail=str(exc)) from exc
    except Exception as exc:
        # No text, document contents or credentials in logs/errors.
        logger.warning("embedding_unavailable type=%s", type(exc).__name__)
        raise AIServiceError(status_code=503, code="ai_error", detail="Le modèle d'embedding est indisponible. Réessayez l'indexation.") from exc


@router.post("/prepare")
def prepare(payload: PrepareRequest):
    return _run(lambda: pipeline.prepare(payload.content))


@router.post("/embed")
def embed(payload: EmbedRequest):
    if any(not text.strip() or len(text) > 4000 for text in payload.texts):
        raise AIServiceError(status_code=400, code="validation_failed", detail="Textes requis, maximum 4 000 caractères.")
    return _run(lambda: {"model": pipeline.MODEL_NAME, "embeddings": pipeline.embed(payload.texts, payload.kind)})

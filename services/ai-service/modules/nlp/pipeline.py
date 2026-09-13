"""Chargement des modèles et analyse d'un commentaire.

Les artefacts sont chargés **une seule fois** par processus (Sprint 09 Jour 5,
« charger les modèles une seule fois ») : un `joblib.load` par requête
coûterait plus cher que l'inférence elle-même. Le cache est un module-level
singleton, pas un état porté par la requête.
"""
import json
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import joblib

from core.config import settings
from core.exceptions import AIServiceError
from modules.nlp.language import detect_language
from modules.nlp.model import explain_terms
from modules.nlp.rules import (
    build_explanation,
    compute_priority,
    is_sensitive,
    is_urgent,
    match_signals,
    recommend_action,
)

logger = logging.getLogger("ai_service.pipeline")

TASKS = ("sentiment", "intent")
# Repli si le model card ne porte pas de seuil (artefacts d'une version
# antérieure) : préférer une valeur prudente à une absence de signal.
DEFAULT_THRESHOLD = 0.55


@dataclass
class Analysis:
    sentiment: str
    intent: str
    priority: str
    confidence: float
    sentiment_confidence: float
    intent_confidence: float
    low_confidence: bool
    urgent: bool
    sensitive: bool
    language: str
    recommended_action: str
    explanation: str
    model_version: str
    dataset_version: str
    analyzed_at: str
    signals: list[str] = field(default_factory=list)
    top_terms: list[str] = field(default_factory=list)


@dataclass
class LoadedModels:
    models: dict
    card: dict
    thresholds: dict[str, float]


_lock = threading.Lock()
_loaded: LoadedModels | None = None


def _artifacts_dir() -> Path:
    return settings.artifacts_dir


def load_models(force: bool = False) -> LoadedModels:
    """Charge les artefacts, une fois, de façon sûre entre threads.

    Uvicorn sert les routes `async` sur la boucle principale mais les routes
    synchrones dans un pool de threads : le verrou évite deux chargements
    concurrents au tout premier appel.
    """
    global _loaded
    if _loaded is not None and not force:
        return _loaded

    with _lock:
        if _loaded is not None and not force:
            return _loaded

        directory = _artifacts_dir()
        card_path = directory / "model_card.json"
        missing = [
            path.name
            for path in (card_path, *(directory / f"{task}.joblib" for task in TASKS))
            if not path.exists()
        ]
        if missing:
            raise AIServiceError(
                status_code=503,
                detail=(
                    "Modèles non entraînés : "
                    + ", ".join(missing)
                    + ". Lancer `python -m training.train`."
                ),
                code="provider_unavailable",
            )

        card = json.loads(card_path.read_text(encoding="utf-8"))
        models = {task: joblib.load(directory / f"{task}.joblib") for task in TASKS}
        thresholds = {
            task: float(card.get("tasks", {}).get(task, {}).get("confidenceThreshold", DEFAULT_THRESHOLD))
            for task in TASKS
        }
        _loaded = LoadedModels(models=models, card=card, thresholds=thresholds)
        logger.info(
            "models_loaded version=%s dataset=%s", card.get("modelVersion"), card.get("datasetVersion")
        )
        return _loaded


def models_ready() -> bool:
    """Utilisé par /ready : ne doit jamais lever, seulement répondre."""
    try:
        load_models()
        return True
    except AIServiceError:
        return False


def models_info() -> dict:
    loaded = load_models()
    info = dict(loaded.card)
    metrics_path = _artifacts_dir() / "metrics.json"
    # Les métriques sont produites par `training/evaluate.py`, qui peut ne pas
    # avoir été lancé : leur absence n'empêche pas de servir, elle est juste
    # signalée telle quelle.
    info["metrics"] = (
        json.loads(metrics_path.read_text(encoding="utf-8")) if metrics_path.exists() else None
    )
    return info


def _predict(model, text: str) -> tuple[str, float]:
    probabilities = model.predict_proba([text])[0]
    index = probabilities.argmax()
    return str(model.classes_[index]), float(probabilities[index])


def analyse(text: str) -> Analysis:
    loaded = load_models()
    trimmed = (text or "").strip()[: settings.max_comment_characters]
    if not trimmed:
        raise AIServiceError(
            status_code=400,
            detail="Le commentaire est vide, rien à analyser.",
            code="validation_failed",
        )

    language, _ = detect_language(trimmed)

    sentiment, sentiment_confidence = _predict(loaded.models["sentiment"], trimmed)
    intent, intent_confidence = _predict(loaded.models["intent"], trimmed)

    signals = match_signals(trimmed)
    urgent = is_urgent(signals)
    sensitive = is_sensitive(signals)
    priority = compute_priority(sentiment, intent, urgent, sensitive)

    # La confiance globale est le MINIMUM des deux tâches, pas leur moyenne :
    # une intention sûre ne compense pas un sentiment douteux, les deux sont
    # affichées ensemble au community manager.
    confidence = min(sentiment_confidence, intent_confidence)
    low_confidence = (
        sentiment_confidence < loaded.thresholds["sentiment"]
        or intent_confidence < loaded.thresholds["intent"]
        # Hors du français, le modèle n'a aucune compétence : la confiance
        # affichée serait un artefact (voir modules/nlp/language.py).
        or language != "fr"
    )

    top_terms = explain_terms(loaded.models["intent"], trimmed, intent)
    if not top_terms:
        top_terms = explain_terms(loaded.models["sentiment"], trimmed, sentiment)

    explanation = build_explanation(sentiment, intent, signals, top_terms, low_confidence)
    if language != "fr":
        explanation += " Le commentaire ne semble pas rédigé en français : analyse peu fiable."

    return Analysis(
        sentiment=sentiment,
        intent=intent,
        priority=priority,
        confidence=round(confidence, 4),
        sentiment_confidence=round(sentiment_confidence, 4),
        intent_confidence=round(intent_confidence, 4),
        low_confidence=low_confidence,
        urgent=urgent,
        sensitive=sensitive,
        language=language,
        recommended_action=recommend_action(intent, urgent, sensitive),
        explanation=explanation,
        model_version=loaded.card.get("fullVersion", loaded.card.get("modelVersion", "inconnu")),
        dataset_version=loaded.card.get("datasetVersion", "inconnu"),
        analyzed_at=datetime.now(timezone.utc).isoformat(),
        signals=sorted(signals),
        top_terms=top_terms,
    )

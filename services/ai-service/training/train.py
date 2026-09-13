"""Entraînement reproductible des deux classifieurs.

    python -m training.train

Relancé deux fois sur le même fichier de données, ce script produit des
artefacts identiques : la graine est fixée, le découpage est recalculé et non
tiré au sort, et la sélection d'hyperparamètre parcourt une grille fixe.

Protocole, explicitement séparé pour que l'évaluation reste honnête :
`train` sert à ajuster, `validation` à choisir `C` et le seuil de confiance,
`test` n'est jamais touché ici — il n'est lu que par `training/evaluate.py`.
Le modèle final est réajusté sur `train + validation` avec le `C` retenu, ce
qui est légitime (aucune information de test n'entre) et récupère les 15 %
d'exemples qu'un modèle entraîné sur `train` seul laisserait de côté.
"""
import json
import platform
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import joblib
import sklearn
from sklearn.metrics import f1_score

from modules.nlp.model import build_classifier
from training.dataset import (
    DATASET_FILE,
    DATASET_VERSION,
    RANDOM_SEED,
    Example,
    dataset_checksum,
    describe,
    load_examples,
    split_examples,
)

MODEL_VERSION = "fr-linear-1.0.0"
ARTIFACTS_DIR = Path(__file__).resolve().parent.parent / "artifacts"

REGULARISATION_GRID = (0.5, 1.0, 2.0, 4.0, 8.0)
# Seuils candidats pour « confiance faible ». On retient le plus bas qui rend
# le sous-ensemble confiant fiable à au moins TARGET_CONFIDENT_ACCURACY :
# monter le seuil plus haut n'améliorerait plus la fiabilité et ne ferait
# qu'envoyer inutilement des analyses correctes en relecture manuelle.
THRESHOLD_GRID = (0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80)
TARGET_CONFIDENT_ACCURACY = 0.85

TASKS = ("sentiment", "intent")


@dataclass
class TaskResult:
    name: str
    regularisation: float
    validation_macro_f1: float
    threshold: float
    threshold_accuracy: float
    threshold_coverage: float


def _labels(examples: list[Example], task: str) -> list[str]:
    return [getattr(example, task) for example in examples]


def _texts(examples: list[Example]) -> list[str]:
    return [example.text for example in examples]


def _select_regularisation(
    train: list[Example], validation: list[Example], task: str
) -> tuple[float, float]:
    best_value, best_score = REGULARISATION_GRID[0], -1.0
    for candidate in REGULARISATION_GRID:
        model = build_classifier(candidate, RANDOM_SEED)
        model.fit(_texts(train), _labels(train, task))
        predicted = model.predict(_texts(validation))
        score = f1_score(_labels(validation, task), predicted, average="macro", zero_division=0)
        if score > best_score:
            best_value, best_score = candidate, score
    return best_value, best_score


def _select_threshold(
    train: list[Example], validation: list[Example], task: str, regularisation: float
) -> tuple[float, float, float]:
    """Seuil de confiance, mesuré avec un modèle qui n'a jamais vu `validation`.

    Le calculer avec le modèle final (réajusté sur validation) donnerait des
    probabilités optimistes sur ces mêmes exemples, donc un seuil trop bas.
    """
    model = build_classifier(regularisation, RANDOM_SEED)
    model.fit(_texts(train), _labels(train, task))

    probabilities = model.predict_proba(_texts(validation))
    predicted = model.classes_[probabilities.argmax(axis=1)]
    confidences = probabilities.max(axis=1)
    truth = _labels(validation, task)

    fallback = (THRESHOLD_GRID[0], 0.0, 1.0)
    for threshold in THRESHOLD_GRID:
        confident = [index for index, value in enumerate(confidences) if value >= threshold]
        if not confident:
            continue
        correct = sum(1 for index in confident if predicted[index] == truth[index])
        accuracy = correct / len(confident)
        coverage = len(confident) / len(truth)
        if threshold == THRESHOLD_GRID[0]:
            fallback = (threshold, accuracy, coverage)
        if accuracy >= TARGET_CONFIDENT_ACCURACY:
            return threshold, accuracy, coverage
    # Aucun seuil n'atteint la cible : on le dit dans le model card plutôt que
    # de faire croire à une garantie que le modèle ne tient pas.
    return fallback


def train_all(output_dir: Path = ARTIFACTS_DIR) -> dict:
    examples = load_examples()
    splits = split_examples(examples)
    output_dir.mkdir(parents=True, exist_ok=True)

    results: list[TaskResult] = []
    for task in TASKS:
        regularisation, validation_f1 = _select_regularisation(
            splits.train, splits.validation, task
        )
        threshold, threshold_accuracy, coverage = _select_threshold(
            splits.train, splits.validation, task, regularisation
        )

        final = build_classifier(regularisation, RANDOM_SEED)
        combined = splits.train + splits.validation
        final.fit(_texts(combined), _labels(combined, task))
        joblib.dump(final, output_dir / f"{task}.joblib")

        results.append(
            TaskResult(
                name=task,
                regularisation=regularisation,
                validation_macro_f1=round(validation_f1, 4),
                threshold=threshold,
                threshold_accuracy=round(threshold_accuracy, 4),
                threshold_coverage=round(coverage, 4),
            )
        )

    card = {
        "modelVersion": MODEL_VERSION,
        "datasetVersion": DATASET_VERSION,
        "fullVersion": f"{MODEL_VERSION}+{DATASET_VERSION}",
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "randomSeed": RANDOM_SEED,
        "algorithm": "TF-IDF (mots 1-2 + caractères 3-5) → régression logistique",
        "library": {"scikitLearn": sklearn.__version__, "python": platform.python_version()},
        "dataset": {
            "file": DATASET_FILE.name,
            "checksum": dataset_checksum(),
            "total": describe(examples),
            "train": describe(splits.train),
            "validation": describe(splits.validation),
            "test": describe(splits.test),
        },
        "tasks": {
            result.name: {
                "regularisation": result.regularisation,
                "validationMacroF1": result.validation_macro_f1,
                "confidenceThreshold": result.threshold,
                "confidentAccuracy": result.threshold_accuracy,
                "confidentCoverage": result.threshold_coverage,
            }
            for result in results
        },
    }
    (output_dir / "model_card.json").write_text(
        json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return card


if __name__ == "__main__":
    summary = train_all()
    print(json.dumps(summary["tasks"], ensure_ascii=False, indent=2))
    print(f"Artefacts écrits dans {ARTIFACTS_DIR}")

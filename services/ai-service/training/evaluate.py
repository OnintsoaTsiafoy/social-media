"""Évaluation sur l'ensemble de test — le seul endroit qui y touche.

    python -m training.evaluate

Produit `artifacts/metrics.json` : précision, rappel et F1 par classe et en
macro, matrice de confusion, comportement sur les cas difficiles (fautes,
emojis, texte très court, texte long), et performance des règles urgence /
sensibilité contre leurs annotations.

Les règles sont évaluées ici au même titre que les modèles : ne mesurer que
ce qui est appris reviendrait à livrer sans preuve la partie du système qui
décide des escalades.
"""
import json
from pathlib import Path

import joblib
from sklearn.metrics import classification_report, confusion_matrix

from modules.nlp.rules import is_sensitive, is_urgent, match_signals
from training.dataset import Example, load_examples, split_examples
from training.train import ARTIFACTS_DIR, TASKS

# Seuils de longueur pour les tranches de difficulté (en caractères).
SHORT_MAX = 25
LONG_MIN = 80
EMOJI_MIN_ORDINAL = 0x2000


def _labels(examples: list[Example], task: str) -> list[str]:
    return [getattr(example, task) for example in examples]


def _texts(examples: list[Example]) -> list[str]:
    return [example.text for example in examples]


def _has_emoji(text: str) -> bool:
    return any(ord(char) > EMOJI_MIN_ORDINAL for char in text)


def _binary_scores(truth: list[bool], predicted: list[bool]) -> dict:
    true_positive = sum(1 for t, p in zip(truth, predicted) if t and p)
    false_positive = sum(1 for t, p in zip(truth, predicted) if not t and p)
    false_negative = sum(1 for t, p in zip(truth, predicted) if t and not p)
    precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0
    recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "support": sum(truth),
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "falseNegative": false_negative,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
    }


def _slice_accuracy(
    examples: list[Example], predicted: list[str], task: str, keep
) -> dict:
    indices = [index for index, example in enumerate(examples) if keep(example)]
    if not indices:
        return {"count": 0, "accuracy": None}
    correct = sum(1 for index in indices if predicted[index] == getattr(examples[index], task))
    return {"count": len(indices), "accuracy": round(correct / len(indices), 4)}


def evaluate(artifacts_dir: Path = ARTIFACTS_DIR) -> dict:
    examples = load_examples()
    splits = split_examples(examples)
    test = splits.test
    texts = _texts(test)

    report: dict = {"testSize": len(test), "tasks": {}, "rules": {}}

    for task in TASKS:
        model = joblib.load(artifacts_dir / f"{task}.joblib")
        probabilities = model.predict_proba(texts)
        predicted = list(model.classes_[probabilities.argmax(axis=1)])
        confidences = probabilities.max(axis=1)
        truth = _labels(test, task)
        classes = list(model.classes_)

        detail = classification_report(
            truth, predicted, labels=classes, output_dict=True, zero_division=0
        )
        matrix = confusion_matrix(truth, predicted, labels=classes)

        report["tasks"][task] = {
            "classes": classes,
            "accuracy": round(detail["accuracy"], 4),
            "macroF1": round(detail["macro avg"]["f1-score"], 4),
            "weightedF1": round(detail["weighted avg"]["f1-score"], 4),
            "perClass": {
                label: {
                    "precision": round(detail[label]["precision"], 4),
                    "recall": round(detail[label]["recall"], 4),
                    "f1": round(detail[label]["f1-score"], 4),
                    "support": int(detail[label]["support"]),
                }
                for label in classes
            },
            # Lignes = vérité, colonnes = prédiction, dans l'ordre de `classes`.
            "confusionMatrix": matrix.tolist(),
            "meanConfidence": round(float(confidences.mean()), 4),
            "difficultCases": {
                "shortText": _slice_accuracy(
                    test, predicted, task, lambda example: len(example.text) <= SHORT_MAX
                ),
                "longText": _slice_accuracy(
                    test, predicted, task, lambda example: len(example.text) >= LONG_MIN
                ),
                "withEmoji": _slice_accuracy(
                    test, predicted, task, lambda example: _has_emoji(example.text)
                ),
                "withoutEmoji": _slice_accuracy(
                    test, predicted, task, lambda example: not _has_emoji(example.text)
                ),
            },
        }

    signals = [match_signals(text) for text in texts]
    report["rules"] = {
        "urgent": _binary_scores(
            [example.urgent for example in test], [is_urgent(signal) for signal in signals]
        ),
        "sensitive": _binary_scores(
            [example.sensitive for example in test], [is_sensitive(signal) for signal in signals]
        ),
    }

    (artifacts_dir / "metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


if __name__ == "__main__":
    result = evaluate()
    for task, scores in result["tasks"].items():
        print(f"\n{task}: exactitude {scores['accuracy']} — F1 macro {scores['macroF1']}")
        for label, values in scores["perClass"].items():
            print(
                f"  {label:<13} P {values['precision']:.2f}  R {values['recall']:.2f}"
                f"  F1 {values['f1']:.2f}  (n={values['support']})"
            )
    print("\nrègles:")
    for name, scores in result["rules"].items():
        print(
            f"  {name:<10} P {scores['precision']:.2f}  R {scores['recall']:.2f}"
            f"  F1 {scores['f1']:.2f}  (n={scores['support']})"
        )

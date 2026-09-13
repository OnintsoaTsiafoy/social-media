"""Chargement, contrôle et découpage du dataset — déterministe.

Le découpage n'est pas sauvegardé dans un fichier : il est *recalculé* à
l'identique à chaque exécution à partir de `RANDOM_SEED`. Deux entraînements
sur le même fichier de données produisent donc exactement les mêmes ensembles,
et un `evaluate.py` lancé séparément mesure bien sur des exemples que
`train.py` n'a jamais vus.
"""
import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from sklearn.model_selection import train_test_split

RANDOM_SEED = 42
TEST_SIZE = 0.15
VALIDATION_SIZE = 0.15

DATASET_DIR = Path(__file__).resolve().parent.parent / "dataset"
DATASET_FILE = DATASET_DIR / "comments.v1.jsonl"
DATASET_VERSION = "v1"

SENTIMENTS = ("positive", "neutral", "negative")
INTENTS = ("question", "info_request", "complaint", "claim", "other")


@dataclass(frozen=True)
class Example:
    id: str
    text: str
    sentiment: str
    intent: str
    urgent: bool
    sensitive: bool


@dataclass(frozen=True)
class Splits:
    train: list[Example]
    validation: list[Example]
    test: list[Example]


class DatasetError(RuntimeError):
    pass


def load_examples(path: Path = DATASET_FILE) -> list[Example]:
    """Lit le JSONL et refuse tout ce qui rendrait les métriques fausses.

    Les doublons exacts sont éliminés ici plutôt que tolérés : un même texte
    présent dans l'entraînement et dans le test produit une fuite de données
    et un F1 flatteur qui ne veut rien dire.
    """
    if not path.exists():
        raise DatasetError(f"Dataset introuvable : {path}")

    seen_ids: set[str] = set()
    seen_texts: set[str] = set()
    examples: list[Example] = []

    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise DatasetError(f"JSON invalide ligne {line_number} : {exc}") from exc

        for field in ("id", "text", "sentiment", "intent", "urgent", "sensitive"):
            if field not in row:
                raise DatasetError(f"Champ « {field} » manquant ligne {line_number}")
        if row["sentiment"] not in SENTIMENTS:
            raise DatasetError(f"Sentiment inconnu ligne {line_number} : {row['sentiment']}")
        if row["intent"] not in INTENTS:
            raise DatasetError(f"Intention inconnue ligne {line_number} : {row['intent']}")
        if row["id"] in seen_ids:
            raise DatasetError(f"Identifiant dupliqué ligne {line_number} : {row['id']}")

        text = row["text"].strip()
        if not text:
            raise DatasetError(f"Texte vide ligne {line_number}")
        if text in seen_texts:
            raise DatasetError(f"Texte dupliqué ligne {line_number} : {text[:40]}…")

        seen_ids.add(row["id"])
        seen_texts.add(text)
        examples.append(
            Example(
                id=row["id"],
                text=text,
                sentiment=row["sentiment"],
                intent=row["intent"],
                urgent=bool(row["urgent"]),
                sensitive=bool(row["sensitive"]),
            )
        )

    if not examples:
        raise DatasetError("Dataset vide.")
    return examples


MINIMUM_STRATUM = 3


def _strata(examples: list[Example]) -> list[str]:
    """Clé de stratification : le couple (sentiment, intention), avec repli.

    Un couple trop rare pour survivre à deux découpages successifs (moins de
    `MINIMUM_STRATUM` exemples, par exemple `negative`+`other` qui n'en a
    qu'un) retombe d'abord sur le seul sentiment, puis, s'il reste trop rare,
    rejoint le stratum le plus peuplé. Ces quelques exemples sont donc répartis
    sans garantie de proportion — c'est le prix à payer pour que la
    stratification tienne : si `train_test_split` levait, le repli serait un
    découpage purement aléatoire, donc des métriques qui changeraient à chaque
    exécution et une reproductibilité perdue sur l'ensemble du dataset.
    """
    keys = [f"{example.sentiment}|{example.intent}" for example in examples]

    counts = Counter(keys)
    keys = [key if counts[key] >= MINIMUM_STRATUM else key.split("|")[0] for key in keys]

    counts = Counter(keys)
    majority = counts.most_common(1)[0][0]
    return [key if counts[key] >= MINIMUM_STRATUM else majority for key in keys]


def split_examples(examples: list[Example]) -> Splits:
    strata = _strata(examples)
    train_val, test = train_test_split(
        examples,
        test_size=TEST_SIZE,
        random_state=RANDOM_SEED,
        stratify=strata,
    )
    # La part de validation est exprimée sur le dataset complet : on la
    # recalcule sur le reste pour que 0.15 signifie bien 15 % du total.
    relative_validation = VALIDATION_SIZE / (1 - TEST_SIZE)
    train, validation = train_test_split(
        train_val,
        test_size=relative_validation,
        random_state=RANDOM_SEED,
        stratify=_strata(train_val),
    )
    return Splits(train=train, validation=validation, test=test)


def dataset_checksum(path: Path = DATASET_FILE) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def describe(examples: list[Example]) -> dict:
    return {
        "count": len(examples),
        "sentiment": dict(Counter(example.sentiment for example in examples)),
        "intent": dict(Counter(example.intent for example in examples)),
        "urgent": sum(example.urgent for example in examples),
        "sensitive": sum(example.sensitive for example in examples),
    }

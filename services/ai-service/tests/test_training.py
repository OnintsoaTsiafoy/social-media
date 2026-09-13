import json

import pytest

from modules.nlp.language import detect_language
from training.dataset import (
    DatasetError,
    load_examples,
    split_examples,
)


def test_the_shipped_dataset_is_valid():
    """Le dataset livré doit passer les mêmes contrôles que n'importe quel
    ajout : ce test échoue si une annotation future introduit un doublon, une
    classe inconnue ou un texte vide."""
    examples = load_examples()

    assert len(examples) > 400
    assert len({example.id for example in examples}) == len(examples)
    assert len({example.text for example in examples}) == len(examples)


def test_duplicate_texts_are_refused(tmp_path):
    path = tmp_path / "doublons.jsonl"
    row = {"text": "Bonjour", "sentiment": "neutral", "intent": "question", "urgent": False, "sensitive": False}
    path.write_text(
        json.dumps({**row, "id": "a"}) + "\n" + json.dumps({**row, "id": "b"}) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(DatasetError, match="dupliqué"):
        load_examples(path)


def test_unknown_labels_are_refused(tmp_path):
    path = tmp_path / "classe.jsonl"
    path.write_text(
        json.dumps(
            {
                "id": "a",
                "text": "Bonjour",
                "sentiment": "mitige",
                "intent": "question",
                "urgent": False,
                "sensitive": False,
            }
        )
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(DatasetError, match="Sentiment inconnu"):
        load_examples(path)


def test_splits_are_disjoint_and_cover_everything():
    examples = load_examples()
    splits = split_examples(examples)

    ids = [
        {example.id for example in splits.train},
        {example.id for example in splits.validation},
        {example.id for example in splits.test},
    ]
    assert sum(len(group) for group in ids) == len(examples)
    assert set.union(*ids) == {example.id for example in examples}
    assert not ids[0] & ids[2]
    assert not ids[0] & ids[1]
    assert not ids[1] & ids[2]


def test_splitting_is_reproducible():
    """Sans ça, deux exécutions de `evaluate.py` mesureraient sur des
    ensembles différents et les métriques publiées ne voudraient rien dire."""
    first = split_examples(load_examples())
    second = split_examples(load_examples())

    assert [example.id for example in first.test] == [example.id for example in second.test]


def test_every_class_is_present_in_the_test_split():
    splits = split_examples(load_examples())

    assert {example.sentiment for example in splits.test} == {"positive", "neutral", "negative"}
    assert {example.intent for example in splits.test} == {
        "question",
        "info_request",
        "complaint",
        "claim",
        "other",
    }


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Bonjour, quel est le délai de livraison de ma commande ?", "fr"),
        ("Hello, when will my order be shipped please? Thanks for your help", "other"),
        ("Hola, quiero saber cuando llega mi pedido por favor gracias", "other"),
    ],
)
def test_language_detection(text, expected):
    assert detect_language(text)[0] == expected


def test_very_short_text_is_not_declared_foreign():
    """Un « merci » ou un emoji seul ne porte aucun signal de langue : mieux
    vaut le traiter comme français que d'inventer une détection."""
    assert detect_language("merci")[0] == "fr"
    assert detect_language("😍")[0] == "fr"

from modules.nlp.preprocessing import apply_negation, normalise, normalise_for_rules


def test_urls_mentions_and_contact_details_become_markers():
    result = normalise("Voir https://exemple.fr @marque ou contact@exemple.fr au 06 12 34 56 78")

    assert "tokurl" in result
    assert "tokmention" in result
    assert "tokemail" in result
    assert "tokphone" in result
    # Aucune donnée personnelle ne doit entrer dans le vocabulaire du modèle.
    assert "exemple" not in result
    assert "06" not in result


def test_negation_marks_the_following_tokens():
    assert apply_negation(["je", "ne", "recommande", "pas"]) == [
        "je",
        "ne",
        "neg_recommande",
        "neg_pas",
    ]


def test_negation_does_not_cross_a_clause_break():
    tokens = apply_negation(["jamais", "vu", ".", "produit", "correct"])

    assert tokens == ["jamais", "neg_vu", "produit", "correct"]


def test_negated_and_affirmative_forms_differ():
    assert normalise("je recommande") != normalise("je ne recommande pas")


def test_emojis_become_polarity_tokens():
    assert "emopos" in normalise("❤️")
    assert "emoneg" in normalise("😡")


def test_emoji_only_comment_still_produces_features():
    assert normalise("😍😍").strip() != ""


def test_repeated_characters_are_collapsed():
    assert normalise("trooooop bien") == normalise("troop bien")


def test_accents_and_case_are_normalised():
    assert normalise("Déçu") == normalise("decu")


def test_rules_normalisation_preserves_negation_phrases():
    """Le prétraitement ML détruit « toujours pas » (il devient
    « neg_toujours neg_pas ») : les règles ont donc leur propre normalisation,
    et ce test est là pour que la distinction ne se reperde pas."""
    text = "je n'ai toujours pas été remboursé"

    assert "toujours pas" in normalise_for_rules(text)
    assert "toujours pas" not in normalise(text)


def test_rules_normalisation_keeps_numbers_and_unifies_apostrophes():
    result = normalise_for_rules("Ça fait 3 semaines… c’est long")

    assert "3 semaines" in result
    assert "c'est" in result


def test_empty_text_is_handled():
    assert normalise("") == ""
    assert normalise_for_rules("") == ""

"""Section 10 du TODO analyse concurrentielle : l'IA explique, elle ne calcule
pas, et elle n'a pas le droit d'écrire un chiffre absent des faits reçus.

Le contrôle mécanique (`_validate_numbers`) est ce que ces tests protègent en
priorité : c'est la seule barrière capable d'attraper un chiffre plausible mais
inventé, qu'aucune relecture humaine ne distinguerait d'un chiffre réel.
"""
import pytest

from modules.analytics import competitor_explainer as explainer


def facts(**overrides) -> dict:
    base = {
        "period": "30d",
        "periodStart": "2026-08-17T00:00:00.000Z",
        "periodEnd": "2026-09-16T00:00:00.000Z",
        "competitors": [
            {
                "name": "Concurrent A",
                "network": "Instagram",
                "postsCount": 7,
                "brandPostsCount": 4,
                "interactionComponents": ["reactions", "comments"],
                "metrics": [
                    {
                        "key": "postsPerWeek",
                        "label": "Publications par semaine",
                        "unit": "count",
                        "brand": 4,
                        "competitor": 7,
                        "differencePercent": -42.9,
                    },
                    {
                        "key": "engagementRate",
                        "label": "Taux d'engagement",
                        "unit": "percent",
                        "brand": 6.2,
                        "competitor": 4.8,
                        "differencePercent": 29.2,
                    },
                ],
                "unavailableMetrics": ["Partages par publication"],
                "notes": ["Interactions comparées hors partages."],
            }
        ],
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Interdiction d'inventer un chiffre
# ---------------------------------------------------------------------------


def test_numbers_present_in_the_facts_are_accepted():
    assert explainer._validate_numbers(
        "La marque publie 4 fois par semaine contre 7 pour le concurrent.", facts()
    )


def test_a_decimal_value_from_the_facts_is_accepted_as_written():
    assert explainer._validate_numbers("Le taux d'engagement atteint 6,2 % contre 4,8 %.", facts())


def test_a_rounded_value_from_the_facts_is_accepted():
    # Un texte naturel écrit « 6 % » là où les faits portent 6,2 : refuser cela
    # rejetterait des sorties correctes.
    assert explainer._validate_numbers("Le taux d'engagement avoisine 6 %.", facts())


def test_an_invented_number_is_rejected():
    assert not explainer._validate_numbers("Le taux d'engagement atteint 18,5 % ce mois-ci.", facts())


def test_a_number_from_an_unavailable_metric_is_rejected():
    # « Partages par publication » est listée comme indisponible : aucun
    # chiffre ne peut donc lui être associé.
    assert not explainer._validate_numbers("Le concurrent obtient 12 partages par publication.", facts())


# ---------------------------------------------------------------------------
# Repli local
# ---------------------------------------------------------------------------


def test_without_a_configured_model_the_local_template_is_used():
    text, recommendations, generator, _warnings = explainer.generate(facts=facts())

    assert generator == explainer.GENERATOR_LOCAL
    assert "Concurrent A" in text
    # Le gabarit local est lui aussi soumis à la règle : il ne reformule que
    # des chiffres reçus.
    assert explainer._validate_numbers(text, facts())


def test_the_local_template_never_exceeds_three_recommendations():
    many = facts(
        competitors=[
            {
                "name": f"Concurrent {index}",
                "network": "Instagram",
                "postsCount": 10,
                "brandPostsCount": 10,
                "interactionComponents": ["reactions"],
                "metrics": [
                    {
                        "key": "avgReactions",
                        "label": "Réactions par publication",
                        "unit": "count",
                        "brand": 10,
                        "competitor": 20,
                        "differencePercent": -50,
                    }
                ],
                "unavailableMetrics": ["Partages par publication"],
                "notes": [],
            }
            for index in range(4)
        ]
    )

    _text, recommendations, _generator, _warnings = explainer.generate(facts=many)

    assert len(recommendations) <= explainer.MAX_RECOMMENDATIONS


def test_a_comparison_without_any_comparable_metric_says_so_instead_of_guessing():
    empty = facts(
        competitors=[
            {
                "name": "Concurrent A",
                "network": "Facebook",
                "postsCount": 0,
                "brandPostsCount": 0,
                "interactionComponents": [],
                "metrics": [],
                "unavailableMetrics": ["Taux d'engagement", "Réactions par publication"],
                "notes": [],
            }
        ]
    )

    text, _recommendations, _generator, warnings = explainer.generate(facts=empty)

    assert "comparable" in text
    assert any(warning["code"] == "no_comparable_metric" for warning in warnings)


# ---------------------------------------------------------------------------
# Avertissements sur données insuffisantes
# ---------------------------------------------------------------------------


def test_a_small_sample_produces_an_explicit_warning():
    _text, _recommendations, _generator, warnings = explainer.generate(facts=facts())
    assert any(warning["code"] == "low_sample" for warning in warnings)


def test_a_sufficient_sample_produces_no_low_sample_warning():
    big = facts(
        competitors=[
            {
                **facts()["competitors"][0],
                "postsCount": 20,
                "brandPostsCount": 18,
            }
        ]
    )
    _text, _recommendations, _generator, warnings = explainer.generate(facts=big)
    assert not any(warning["code"] == "low_sample" for warning in warnings)


# ---------------------------------------------------------------------------
# Sortie du modèle distant
# ---------------------------------------------------------------------------


@pytest.fixture
def llm(monkeypatch):
    """Simule un modèle configuré et pilote sa réponse."""
    monkeypatch.setattr(explainer, "_llm_configured", lambda: True)

    def configure(response: str | None):
        monkeypatch.setattr(explainer, "_llm_generate", lambda _facts: response)

    return configure


def test_a_valid_model_output_is_split_into_summary_and_recommendations(llm):
    llm(
        "La marque publie 4 fois contre 7 pour le concurrent.\n"
        "RECOMMANDATIONS:\n- Publier plus souvent.\n- Tester un autre format.\n"
    )

    text, recommendations, generator, _warnings = explainer.generate(facts=facts())

    assert generator == explainer.GENERATOR_LLM
    assert "RECOMMANDATIONS" not in text
    assert recommendations == ["Publier plus souvent.", "Tester un autre format."]


def test_a_model_output_with_an_invented_number_falls_back_to_the_local_template(llm):
    llm("Le concurrent atteint 18,5 % d'engagement, contre 6,2 % pour la marque.")

    text, _recommendations, generator, warnings = explainer.generate(facts=facts())

    assert generator == explainer.GENERATOR_LOCAL
    assert "18,5" not in text
    assert any(warning["code"] == "llm_fallback" for warning in warnings)


def test_a_model_failure_falls_back_without_raising(llm):
    llm(None)

    _text, _recommendations, generator, warnings = explainer.generate(facts=facts())

    assert generator == explainer.GENERATOR_LOCAL
    assert any(warning["code"] == "llm_fallback" for warning in warnings)

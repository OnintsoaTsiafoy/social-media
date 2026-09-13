"""Tests du graphe d'assistance : chaque nœud isolément, puis l'assemblage."""
from types import SimpleNamespace

import pytest

from core.config import settings
from modules.generation import llm
from modules.workflow import graph, nodes
from modules.workflow.state import initial_state

BRAND = {
    "name": "Studio Vega",
    "tone": "friendly",
    "formality": "adaptive",
    "language": "fr",
    "emojisAllowed": True,
    "targetLength": "2 phrases",
    "greeting": "Bonjour {prénom},",
    "closing": "À très vite !",
    "forbiddenTerms": ["remboursement immédiat"],
    "recommendedTerms": [],
}


def state(**overrides):
    base = initial_state(
        commentText="Commande jamais reçue, je veux une solution.",
        authorName="Alice Martin",
        brand=BRAND,
        publication=None,
        history=[],
        instruction=None,
        requestedTone=None,
        requestedLanguage=None,
    )
    base.update(overrides)
    return base


# --- Nœuds isolés -----------------------------------------------------------


def test_validate_rejects_an_empty_comment():
    result = nodes.validate(state(commentText="   "))

    assert result["errors"][0]["code"] == "empty_comment"


def test_validate_truncates_instead_of_refusing_a_very_long_comment():
    """Refuser priverait le community manager d'aide précisément sur le message
    le plus pénible à traiter."""
    long_comment = "a" * (settings.max_comment_characters + 500)

    result = nodes.validate(state(commentText=long_comment))

    assert "errors" not in result
    assert len(result["commentText"]) == settings.max_comment_characters


def test_the_response_language_follows_the_request_then_the_brand():
    assert nodes.resolve_language(state(requestedLanguage="en"))["language"] == "en"
    assert nodes.resolve_language(state(brand={**BRAND, "language": "en"}))["language"] == "en"
    assert nodes.resolve_language(state())["language"] == "fr"


def test_an_unsupported_requested_language_falls_back_to_french():
    assert nodes.resolve_language(state(requestedLanguage="klingon"))["language"] == "fr"


def test_the_comment_language_never_decides_the_response_language():
    """Répondre automatiquement dans la langue de l'auteur serait un choix
    éditorial que la marque n'a pas fait."""
    result = nodes.resolve_language(
        state(commentText="Hello, where is my order please? Thanks for your help")
    )

    assert result["language"] == "fr"
    assert any(warning["code"] == "comment_language_differs" for warning in result["warnings"])


def test_analyse_populates_the_analysis(client):
    result = nodes.analyse(state())

    assert result["analysis"]["sentiment"] in ("positive", "neutral", "negative")


def test_analysis_failure_does_not_stop_the_workflow(monkeypatch):
    from modules.nlp import pipeline

    monkeypatch.setattr(
        pipeline, "analyse", lambda text: (_ for _ in ()).throw(RuntimeError("modèle absent"))
    )

    result = nodes.analyse(state())

    assert result["analysis"] is None
    assert any(warning["code"] == "analysis_unavailable" for warning in result["warnings"])


def test_a_sensitive_comment_is_flagged_without_blocking_generation():
    analysis = {"priority": "high", "sensitive": True, "lowConfidence": False}

    result = nodes.prioritise(state(analysis=analysis))

    assert result["priority"] == "high"
    assert any(warning["code"] == "sensitive_topic" for warning in result["warnings"])


def test_the_context_reports_what_was_assembled():
    result = nodes.build_context(
        state(
            publication={"content": "Notre collection"},
            history=[{"author": "marque", "text": "Bonjour"}],
            instruction="proposer un suivi",
            analysis={"sentiment": "negative", "intent": "claim"},
        )
    )

    assert "publication=incluse" in result["context"]
    assert "historique=1" in result["context"]
    assert "consigne=fournie" in result["context"]
    assert "analyse=negative/claim" in result["context"]


@pytest.mark.parametrize(
    "current,expected",
    [
        ({"errors": [{"code": "x", "message": "y"}]}, "failed"),
        ({"blocked": True}, "blocked"),
        ({"analysis": {"sensitive": True}}, "escalate"),
        ({"priority": "high"}, "escalate"),
        ({"priority": "low"}, "propose"),
    ],
)
def test_the_final_action_is_derived_from_the_state(current, expected):
    assert nodes.decide_action(state(**current))["action"] == expected


# --- Graphe complet ---------------------------------------------------------


def run(**overrides):
    payload = {
        "commentText": "Commande jamais reçue, je veux une solution.",
        "authorName": "Alice Martin",
        "brand": BRAND,
        "publication": None,
        "history": [],
        "instruction": None,
        "requestedTone": None,
        "requestedLanguage": None,
    }
    payload.update(overrides)
    return graph.run(**payload)


def test_the_nominal_path_produces_a_proposal(client):
    result = run(commentText="Bonjour, vous livrez en Belgique ?")

    assert result["draft"]
    assert result["action"] == "propose"
    assert result["blocked"] is False
    assert result["generator"]
    assert result["promptVersion"]


def test_an_empty_comment_short_circuits_to_the_final_node(client):
    result = run(commentText="   ")

    assert result["action"] == "failed"
    assert result["errors"]
    assert result["draft"] == ""


def test_an_instruction_that_breaks_the_brand_rules_is_blocked(client):
    """Le contrôle s'applique à la sortie, quelle que soit la consigne — sinon
    il suffirait de demander l'interdit pour l'obtenir."""
    result = run(instruction="proposer un remboursement immédiat")

    assert result["blocked"] is True
    assert result["action"] == "blocked"
    codes = {warning["code"] for warning in result["warnings"]}
    assert "forbidden_term" in codes
    assert "unauthorised_promise" in codes


def test_a_sensitive_comment_is_routed_to_escalation(client):
    result = run(commentText="Le produit m'a envoyée aux urgences, j'ai fait une réaction.")

    assert result["action"] == "escalate"
    assert any(warning["code"] == "sensitive_topic" for warning in result["warnings"])


def test_the_graph_is_deterministic_without_an_llm(client):
    assert run()["draft"] == run()["draft"]


def test_nothing_in_the_graph_ever_sends(client):
    """Garde-fou explicite : aucune sortie du graphe n'est un envoi. L'action
    la plus engageante possible reste « escalate »."""
    for text in (
        "Bonjour, vous livrez en Belgique ?",
        "Commande jamais reçue depuis 3 mois, je saisis la justice.",
        "Bravo pour cette collection !",
    ):
        assert run(commentText=text)["action"] in ("propose", "escalate", "blocked", "failed")


# --- Chemin LLM -------------------------------------------------------------


def _fake_anthropic(text: str, stop_reason: str = "end_turn"):
    message = SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)], stop_reason=stop_reason
    )
    return SimpleNamespace(messages=SimpleNamespace(create=lambda **kwargs: message))


@pytest.fixture
def llm_enabled(monkeypatch):
    monkeypatch.setattr(settings, "ai_generation_mode", "llm")
    monkeypatch.setattr(settings, "anthropic_api_key", "clé-de-test")
    return settings


def test_the_llm_is_used_when_configured(client, llm_enabled, monkeypatch):
    monkeypatch.setattr(llm, "_client", lambda: _fake_anthropic("Bonjour Alice, nous vérifions."))

    result = run()

    assert result["draft"] == "Bonjour Alice, nous vérifions."
    assert result["generator"] == "claude"
    assert result["promptVersion"] == "comment-reply-1.0.0"


def test_an_unavailable_llm_falls_back_to_the_local_generator(client, llm_enabled, monkeypatch):
    """Un community manager qui clique « Générer » doit obtenir une proposition,
    même si le modèle distant est saturé — mais il doit savoir laquelle des deux
    il a sous les yeux."""

    def explode():
        raise RuntimeError("boom")

    monkeypatch.setattr(llm, "_client", explode)

    result = run()

    assert result["draft"]
    assert result["generator"] == "local-template-1.0.0"
    assert any(warning["code"] == "llm_fallback" for warning in result["warnings"])


def test_a_refusal_falls_back_instead_of_proposing_nothing(client, llm_enabled, monkeypatch):
    monkeypatch.setattr(llm, "_client", lambda: _fake_anthropic("", stop_reason="refusal"))

    result = run()

    assert result["draft"]
    assert result["generator"] == "local-template-1.0.0"


def test_a_truncated_llm_response_is_flagged(client, llm_enabled, monkeypatch):
    monkeypatch.setattr(
        llm, "_client", lambda: _fake_anthropic("Bonjour Alice, nous", stop_reason="max_tokens")
    )

    result = run()

    assert any(warning["code"] == "response_truncated" for warning in result["warnings"])


def test_the_llm_is_ignored_without_a_key(client, monkeypatch):
    monkeypatch.setattr(settings, "ai_generation_mode", "llm")
    monkeypatch.setattr(settings, "anthropic_api_key", None)

    assert llm.is_configured() is False
    assert run()["generator"] == "local-template-1.0.0"

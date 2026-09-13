"""Assemblage du graphe LangGraph (Sprint 10 Jour 1).

Le graphe est compilé **une fois** au premier appel, comme les modèles du
Sprint 09 : la compilation est bon marché mais pas gratuite, et la refaire à
chaque requête n'apporterait rien.

Deux branches conditionnelles seulement, parce qu'il n'y en a que deux qui
changent réellement le parcours :

    validate ──(commentaire vide)──────────────► decide_action ► FIN
        │
        └──► resolve_language ► analyse ► prioritise ► build_context
                                                            │
                                                            ▼
                                        generate ──(échec)──► decide_action ► FIN
                                            │
                                            └──► safety ► decide_action ► FIN

`decide_action` est le seul point de sortie : quel que soit le chemin, l'appelant
reçoit un état complet avec une `action` explicite, jamais une réponse partielle.
"""
import threading

from langgraph.graph import END, StateGraph

from modules.workflow import nodes
from modules.workflow.state import AssistanceState, initial_state

_lock = threading.Lock()
_compiled = None


def _after_validation(state: AssistanceState) -> str:
    return "decide_action" if state.get("errors") else "resolve_language"


def _after_generation(state: AssistanceState) -> str:
    # Une génération en échec n'a pas de texte à contrôler : passer quand même
    # par `safety` produirait un avertissement « réponse vide » qui masquerait
    # la vraie cause.
    return "decide_action" if state.get("errors") else "safety"


def build() -> StateGraph:
    graph = StateGraph(AssistanceState)

    graph.add_node("validate", nodes.validate)
    graph.add_node("resolve_language", nodes.resolve_language)
    graph.add_node("analyse", nodes.analyse)
    graph.add_node("prioritise", nodes.prioritise)
    graph.add_node("build_context", nodes.build_context)
    graph.add_node("generate", nodes.generate)
    graph.add_node("safety", nodes.safety)
    graph.add_node("decide_action", nodes.decide_action)

    graph.set_entry_point("validate")
    graph.add_conditional_edges(
        "validate", _after_validation, {"decide_action": "decide_action", "resolve_language": "resolve_language"}
    )
    graph.add_edge("resolve_language", "analyse")
    graph.add_edge("analyse", "prioritise")
    graph.add_edge("prioritise", "build_context")
    graph.add_edge("build_context", "generate")
    graph.add_conditional_edges(
        "generate", _after_generation, {"decide_action": "decide_action", "safety": "safety"}
    )
    graph.add_edge("safety", "decide_action")
    graph.add_edge("decide_action", END)

    return graph


def compiled():
    global _compiled
    if _compiled is not None:
        return _compiled
    with _lock:
        if _compiled is None:
            _compiled = build().compile()
    return _compiled


def run(**inputs) -> AssistanceState:
    """Exécute le graphe et retourne l'état final.

    Synchrone : la route FastAPI qui l'appelle est déclarée `def` (et non
    `async def`), donc Starlette l'exécute dans un pool de threads — un appel
    réseau bloquant vers le modèle ne gèle pas la boucle d'événements.
    """
    return compiled().invoke(initial_state(**inputs))

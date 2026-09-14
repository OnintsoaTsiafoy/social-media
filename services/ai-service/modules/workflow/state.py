"""État du graphe d'assistance (Sprint 10 Jour 1).

Un seul dictionnaire traverse tous les nœuds. Il est typé pour que l'ajout
d'un champ par un nœud reste explicite : LangGraph fusionne les dictionnaires
renvoyés par chaque nœud dans cet état, donc un champ non déclaré ici
passerait inaperçu jusqu'à ce qu'un nœud plus loin le lise.

Les entrées viennent d'Express (contexte de marque, publication, historique) :
le service reste sans état et ne va rien chercher en base lui-même, exactement
comme pour l'analyse du Sprint 09.
"""
from typing import Any, TypedDict


class BrandContext(TypedDict, total=False):
    """Sous-ensemble de `brand_ai_settings` utile à la génération.

    Volontairement pas le modèle Prisma complet : ce service n'a aucune raison
    de connaître les identifiants, les dates ou l'auteur d'une version de
    réglages.
    """
    name: str
    tone: str
    customTone: str | None
    formality: str
    language: str
    emojisAllowed: bool
    targetLength: str
    greeting: str | None
    closing: str | None
    forbiddenTerms: list[str]
    recommendedTerms: list[str]
    instructions: str | None
    complaintInstructions: str | None
    urgencyInstructions: str | None
    supportInstructions: str | None


class PublicationContext(TypedDict, total=False):
    content: str
    hashtags: list[str]


class AssistanceState(TypedDict, total=False):
    # --- Entrées ---
    commentId: str | None
    commentText: str
    authorName: str | None
    brand: BrandContext
    publication: PublicationContext | None
    # Échanges précédents sur CE commentaire uniquement, déjà tronqués par
    # l'appelant. Jamais l'historique du client sur d'autres publications :
    # inclure trop d'historique sensible est un risque explicite du sprint.
    history: list[dict[str, Any]]
    instruction: str | None
    requestedTone: str | None
    requestedLanguage: str | None
    documents: list[dict[str, Any]]
    examples: list[dict[str, Any]]
    strategy: str

    # --- Produits par les nœuds ---
    language: str
    analysis: dict[str, Any] | None
    priority: str
    context: str
    promptVersion: str
    generator: str
    draft: str
    warnings: list[dict[str, Any]]
    blocked: bool
    action: str
    errors: list[dict[str, str]]


def initial_state(**kwargs: Any) -> AssistanceState:
    """Valeurs par défaut des champs accumulés.

    Les listes sont créées ici et non comme valeurs par défaut de la classe :
    un `[]` partagé entre deux exécutions du graphe accumulerait les
    avertissements de la précédente.
    """
    state: AssistanceState = {
        "warnings": [],
        "errors": [],
        "blocked": False,
        "action": "propose",
        "analysis": None,
        "draft": "",
        "context": "",
    }
    state.update(kwargs)  # type: ignore[typeddict-item]
    return state

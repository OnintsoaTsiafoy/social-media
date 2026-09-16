"""Résumé en langage naturel d'une comparaison concurrentielle
(sprint_listing/PLUS/TODO_ANALYSE_CONCURRENTIELLE_MISE_A_JOUR.md, section 10).

Même architecture que `best_times_explainer.py` : le LLM est le second choix,
jamais le seul chemin, et sa sortie franchit un contrôle mécanique avant d'être
renvoyée. Ce contrôle est ici l'exigence centrale du TODO — « Interdire
l'invention de chiffres », « Interdire l'utilisation d'une donnée absente ».
Une relecture humaine ne verrait pas la différence entre un écart de 23 % réel
et un écart de 24 % halluciné ; `_validate_numbers` la voit.

L'IA ne calcule aucun KPI : tous les chiffres viennent d'Express, et le repli
local n'est pas un pis-aller mais un gabarit qui reformule exactement les mêmes
valeurs.
"""
import logging
import re

from core.config import settings

logger = logging.getLogger("ai_service.analytics.competitors")

GENERATOR_LOCAL = "local-template-1.0.0"
GENERATOR_LLM = "claude"

NUMBER_RE = re.compile(r"-?\d+(?:[.,]\d+)?")

MAX_TOKENS = 700
MAX_RECOMMENDATIONS = 3

SYSTEM_PROMPT = (
    "Tu rédiges, pour un community manager, une synthèse courte (3 à 5 phrases, en "
    "français) d'une comparaison déjà calculée entre sa marque et un ou plusieurs "
    "concurrents. Utilise UNIQUEMENT les chiffres fournis dans le message suivant : "
    "n'invente, ne recalcule et n'arrondis différemment aucun chiffre, et ne cite "
    "aucune statistique absente de cette liste. Ne commente jamais une métrique "
    "listée comme indisponible : dis qu'elle n'est pas disponible, sans l'estimer. "
    "Termine par une ligne 'RECOMMANDATIONS:' suivie d'au maximum trois "
    "recommandations, une par ligne, préfixées d'un tiret, chacune actionnable et "
    "appuyée sur un écart mentionné plus haut."
)


def _allowed_numbers(facts: dict) -> set[int]:
    """Chiffres que le modèle a le droit d'écrire.

    0 est toujours admis : une phrase correcte peut contenir « aucune
    publication » écrit « 0 », et une valeur nulle légitime existe dans les
    faits. Les arrondis à l'entier sont admis dans les deux sens, parce qu'un
    texte écrit naturellement dit « 6 % » là où les faits portent 6,2.
    """
    allowed: set[int] = {0}
    for competitor in facts.get("competitors", []):
        allowed.add(round(competitor.get("postsCount") or 0))
        allowed.add(round(competitor.get("brandPostsCount") or 0))
        for metric in competitor.get("metrics", []):
            for key in ("brand", "competitor", "differencePercent"):
                value = metric.get(key)
                if value is None:
                    continue
                allowed.add(round(value))
                allowed.add(round(abs(value)))
                # Une valeur à un chiffre après la virgule peut être reprise
                # telle quelle (« 6,2 % ») : son arrondi entier ne suffit pas.
                allowed.add(round(value * 10))
                allowed.add(round(abs(value) * 10))
    return allowed


def _validate_numbers(text: str, facts: dict) -> bool:
    allowed = _allowed_numbers(facts)
    for match in NUMBER_RE.findall(text):
        value = float(match.replace(",", "."))
        candidates = {round(value), round(abs(value)), round(value * 10), round(abs(value) * 10)}
        if not candidates & allowed:
            return False
    return True


def _metric_line(metric: dict) -> str:
    unit = " %" if metric.get("unit") == "percent" else ""
    difference = metric.get("differencePercent")
    difference_text = "" if difference is None else f" (écart marque/concurrent : {difference:+.1f} %)"
    return (
        f"  - {metric['label']} : marque {metric['brand']}{unit}, "
        f"concurrent {metric['competitor']}{unit}{difference_text}"
    )


def _facts_prompt(facts: dict) -> str:
    lines = [f"Période analysée : {facts['period']} (du {facts['periodStart'][:10]} au {facts['periodEnd'][:10]})"]
    for competitor in facts.get("competitors", []):
        lines.append(
            f"Concurrent « {competitor['name']} » sur {competitor['network']} — "
            f"{competitor['postsCount']} publications sur la période, "
            f"{competitor['brandPostsCount']} pour la marque."
        )
        components = ", ".join(competitor.get("interactionComponents") or []) or "aucune"
        lines.append(f"  Composantes d'interaction comparables : {components}.")
        lines.extend(_metric_line(metric) for metric in competitor.get("metrics", []))
        if competitor.get("unavailableMetrics"):
            lines.append(
                "  Métriques NON disponibles (ne pas les commenter chiffrées) : "
                + ", ".join(competitor["unavailableMetrics"])
            )
        for note in competitor.get("notes", []):
            lines.append(f"  Remarque : {note}")
    return "\n".join(lines)


def _format_value(metric: dict, key: str) -> str:
    value = metric[key]
    return f"{value} %" if metric.get("unit") == "percent" else f"{value}"


def _local_summary(facts: dict) -> tuple[str, list[str]]:
    competitors = facts.get("competitors", [])
    if not competitors:
        return "Aucun concurrent comparable sur cette période.", []

    sentences: list[str] = []
    recommendations: list[str] = []

    for competitor in competitors:
        metrics = competitor.get("metrics", [])
        if not metrics:
            sentences.append(
                f"Aucune métrique n'est comparable avec « {competitor['name']} » "
                f"sur {competitor['network']} pour cette période."
            )
            continue

        sentences.append(
            f"Sur {competitor['network']}, la marque a publié {competitor['brandPostsCount']} fois "
            f"contre {competitor['postsCount']} pour « {competitor['name']} »."
        )

        # L'écart le plus marqué, dans un sens comme dans l'autre : c'est celui
        # qui mérite une phrase, pas le premier de la liste.
        scored = [metric for metric in metrics if metric.get("differencePercent") is not None]
        if scored:
            widest = max(scored, key=lambda metric: abs(metric["differencePercent"]))
            direction = "au-dessus" if widest["differencePercent"] > 0 else "en dessous"
            sentences.append(
                f"L'écart le plus marqué porte sur « {widest['label'].lower()} » : "
                f"{_format_value(widest, 'brand')} pour la marque, "
                f"{_format_value(widest, 'competitor')} pour le concurrent, "
                f"soit {abs(widest['differencePercent'])} % {direction}."
            )
            if widest["differencePercent"] < 0 and len(recommendations) < MAX_RECOMMENDATIONS:
                recommendations.append(
                    f"Rapprocher « {widest['label'].lower()} » de « {competitor['name']} » "
                    f"({_format_value(widest, 'competitor')} contre {_format_value(widest, 'brand')})."
                )

        if competitor.get("unavailableMetrics") and len(recommendations) < MAX_RECOMMENDATIONS:
            recommendations.append(
                "Compléter les données manquantes avant de conclure : "
                + ", ".join(competitor["unavailableMetrics"])
                + "."
            )

    return " ".join(sentences), recommendations[:MAX_RECOMMENDATIONS]


def _split_recommendations(text: str) -> tuple[str, list[str]]:
    """Sépare la synthèse des recommandations produites par le modèle."""
    marker = re.search(r"RECOMMANDATIONS\s*:", text, flags=re.IGNORECASE)
    if not marker:
        return text.strip(), []
    summary = text[: marker.start()].strip()
    tail = text[marker.end() :]
    recommendations = [
        line.strip().lstrip("-•*").strip()
        for line in tail.splitlines()
        if line.strip().lstrip("-•*").strip()
    ]
    return summary, recommendations[:MAX_RECOMMENDATIONS]


def _llm_configured() -> bool:
    return settings.generation_mode_is_llm and bool(settings.anthropic_api_key)


def _llm_generate(facts: dict) -> str | None:
    # Import local, comme best_times_explainer.py : la dépendance n'est requise
    # que sur ce chemin, le service doit démarrer sans elle.
    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = client.messages.create(
            model=settings.generation_model,
            max_tokens=MAX_TOKENS,
            output_config={"effort": "low"},
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": _facts_prompt(facts)}],
        )
    except Exception as error:  # noqa: BLE001 — chemin distant non maîtrisé, voir provider.py.
        logger.warning("competitor_explain_llm_failed reason=%s", error)
        return None

    if response.stop_reason == "refusal":
        logger.warning("competitor_explain_llm_refused")
        return None

    text = "".join(block.text for block in response.content if block.type == "text").strip()
    return text or None


def _low_data_warnings(facts: dict) -> list[dict]:
    """Avertissements quand la comparaison repose sur peu de données.

    Produits ici et non côté Express parce qu'ils qualifient l'analyse
    elle-même : c'est le texte renvoyé qu'ils relativisent.
    """
    warnings: list[dict] = []
    for competitor in facts.get("competitors", []):
        if competitor["postsCount"] < 5 or competitor["brandPostsCount"] < 5:
            warnings.append(
                {
                    "code": "low_sample",
                    "severity": "warning",
                    "message": (
                        f"Comparaison avec « {competitor['name']} » fondée sur peu de publications "
                        f"({competitor['brandPostsCount']} pour la marque, {competitor['postsCount']} "
                        "pour le concurrent) : les écarts sont indicatifs."
                    ),
                }
            )
        if not competitor.get("metrics"):
            warnings.append(
                {
                    "code": "no_comparable_metric",
                    "severity": "warning",
                    "message": (
                        f"Aucune métrique comparable avec « {competitor['name']} » : "
                        "les données accessibles via Meta ne se recoupent pas."
                    ),
                }
            )
    return warnings


def generate(*, facts: dict) -> tuple[str, list[str], str, list[dict]]:
    """Retourne `(texte, recommandations, générateur, avertissements)`.

    Ne lève jamais : une comparaison sans explication reste affichable, une
    explication fausse ne l'est pas.
    """
    warnings = _low_data_warnings(facts)

    if _llm_configured():
        raw = _llm_generate(facts)
        if raw and _validate_numbers(raw, facts):
            summary, recommendations = _split_recommendations(raw)
            return summary, recommendations, GENERATOR_LLM, warnings
        if raw:
            logger.warning("competitor_explain_rejected reason=invented_number")
        summary, recommendations = _local_summary(facts)
        return (
            summary,
            recommendations,
            GENERATOR_LOCAL,
            [
                *warnings,
                {
                    "code": "llm_fallback",
                    "severity": "info",
                    "message": (
                        "Synthèse produite par un gabarit local : le modèle distant n'était pas "
                        "disponible ou a produit un chiffre non vérifiable."
                    ),
                },
            ],
        )

    summary, recommendations = _local_summary(facts)
    return summary, recommendations, GENERATOR_LOCAL, warnings

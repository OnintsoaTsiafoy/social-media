"""Explication IA du meilleur horaire de publication
(sprint_listing/PLUS/TODO_RECOMMANDATION_MEILLEUR_HORAIRE.md, section 6).

Même principe que `modules/generation/provider.py` : le LLM est le second
choix, jamais le seul chemin. Ici, en plus du repli habituel (modèle non
configuré ou en échec), un second garde-fou s'applique à la sortie du modèle
avant de la renvoyer : `_validate_numbers` rejette tout chiffre du texte qui
ne provient pas des faits envoyés. C'est la traduction directe de l'exigence
du TODO ("Interdire l'invention de chiffres") — un modèle qui écrit un
pourcentage plausible mais halluciné n'est pas détectable autrement que par ce
contrôle mécanique, une relecture humaine ne le verrait pas non plus.
"""
import logging
import re

from core.config import settings

logger = logging.getLogger("ai_service.analytics.best_times")

GENERATOR_LOCAL = "local-template-1.0.0"
GENERATOR_LLM = "claude"

NUMBER_RE = re.compile(r"-?\d+(?:[.,]\d+)?")
NETWORK_LABELS = {"facebook": "Facebook", "instagram": "Instagram"}

MAX_TOKENS = 300

SYSTEM_PROMPT = (
    "Tu rédiges, pour un community manager, une explication courte (2 à 3 phrases, en "
    "français) d'une recommandation d'horaire de publication déjà calculée. Utilise "
    "UNIQUEMENT les chiffres fournis dans le message suivant : n'invente, n'arrondis "
    "différemment et ne recalcule aucun chiffre, et ne cite aucune statistique absente "
    "de cette liste. Si la confiance du créneau recommandé est \"low\", dis explicitement "
    "que l'échantillon est encore limité. Ne mentionne jamais de créneau ni de réseau "
    "social autre que ceux listés."
)


def _allowed_numbers(facts: dict) -> set[int]:
    # 0 reste toujours autorisé : "18h00", "21h00"... chaque borne de créneau
    # s'écrit avec des minutes à zéro, qui ressortiraient sinon comme un
    # chiffre "inventé" dès que le modèle reprend cette notation.
    allowed: set[int] = {0, round(facts["analyzedCount"])}
    for slot in [facts["best"], *facts["alternatives"]]:
        allowed.add(round(slot["slotStartHour"]))
        allowed.add(round(slot["slotEndHour"]))
        allowed.add(round(slot["sampleSize"]))
        delta = slot.get("deltaVsAveragePercent")
        if delta is not None:
            allowed.add(round(delta))
            allowed.add(round(abs(delta)))
    return allowed


def _validate_numbers(text: str, facts: dict) -> bool:
    allowed = _allowed_numbers(facts)
    for match in NUMBER_RE.findall(text):
        value = round(float(match.replace(",", ".")))
        if value not in allowed and abs(value) not in allowed:
            return False
    return True


def _slot_line(label: str, slot: dict) -> str:
    delta = slot.get("deltaVsAveragePercent")
    delta_text = f", delta vs moyenne des créneaux analysés : {delta:+.0f} %" if delta is not None else ""
    return (
        f"- {label} : {slot['weekdayLabel']}, {slot['slotLabel']}, "
        f"{slot['sampleSize']} publications analysées, confiance {slot['confidence']}{delta_text}"
    )


def _facts_prompt(facts: dict) -> str:
    lines = [
        f"Réseau : {NETWORK_LABELS.get(facts['network'], facts['network'])}",
        f"Période analysée : {facts['period']}",
        f"Publications analysées au total : {facts['analyzedCount']}",
        _slot_line("Créneau recommandé", facts["best"]),
    ]
    lines.extend(_slot_line("Alternative", alternative) for alternative in facts["alternatives"])
    return "\n".join(lines)


def _local_template(facts: dict) -> str:
    best = facts["best"]
    network_label = NETWORK_LABELS.get(facts["network"], facts["network"])
    delta = best.get("deltaVsAveragePercent")
    delta_clause = f", soit {delta:+.0f} % par rapport à la moyenne des créneaux analysés" if delta is not None else ""
    confidence_clause = (
        " L'échantillon reste limité : à confirmer avec davantage de publications."
        if best["confidence"] == "low"
        else ""
    )
    return (
        f"Les publications du {best['weekdayLabel'].lower()} sur le créneau {best['slotLabel']} "
        f"génèrent actuellement le meilleur engagement sur {network_label}. Cette recommandation "
        f"repose sur {best['sampleSize']} publications analysées{delta_clause}.{confidence_clause}"
    )


def _llm_configured() -> bool:
    return settings.generation_mode_is_llm and bool(settings.anthropic_api_key)


def _llm_generate(facts: dict) -> str | None:
    # Import local, comme modules/generation/llm.py::_client : la dépendance
    # n'est requise que sur ce chemin, le service doit démarrer sans elle.
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
        logger.warning("best_times_explain_llm_failed reason=%s", error)
        return None

    if response.stop_reason == "refusal":
        logger.warning("best_times_explain_llm_refused")
        return None

    text = "".join(block.text for block in response.content if block.type == "text").strip()
    return text or None


def generate(*, facts: dict) -> tuple[str, str, list[dict]]:
    """Retourne `(texte, générateur, avertissements)`. Ne lève jamais."""
    if _llm_configured():
        text = _llm_generate(facts)
        if text and _validate_numbers(text, facts):
            return text, GENERATOR_LLM, []
        if text:
            logger.warning("best_times_explain_rejected reason=invented_number")
        return (
            _local_template(facts),
            GENERATOR_LOCAL,
            [
                {
                    "code": "llm_fallback",
                    "severity": "info",
                    "message": (
                        "Explication produite par un gabarit local : le modèle distant n'était pas "
                        "disponible ou a produit un chiffre non vérifiable."
                    ),
                }
            ],
        )

    return _local_template(facts), GENERATOR_LOCAL, []

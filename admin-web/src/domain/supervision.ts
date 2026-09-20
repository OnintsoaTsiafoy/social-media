import type { RejectReason, RuleKey, SentimentKey } from "@/api/types";
import type { Formatters, MessageKey, Translate } from "@/i18n";
import type { Tone } from "@/types";

export const RULE_KEYS: readonly RuleKey[] = ["negative", "volume", "vip", "lang"];

/** Motifs de rejet : les codes partent au serveur, les libellés viennent de la langue courante. */
export const REJECT_REASONS: readonly RejectReason[] = ["wrong_tone", "incorrect_facts", "policy_risk", "too_generic"];

export const RULE_LABEL: Record<RuleKey, { label: MessageKey; description: MessageKey }> = {
  negative: { label: "rules.negative.label", description: "rules.negative.desc" },
  volume: { label: "rules.volume.label", description: "rules.volume.desc" },
  vip: { label: "rules.vip.label", description: "rules.vip.desc" },
  lang: { label: "rules.lang.label", description: "rules.lang.desc" },
};

export const THRESHOLD_MIN = 50;
export const THRESHOLD_MAX = 99;

/** Sous cette confiance, un brouillon qui exige une relecture est en orange plutôt qu'en rouge. */
export const REVIEW_WARNING_CONFIDENCE = 70;

export const SENTIMENT_TONE: Record<SentimentKey, Tone> = {
  negative: "danger",
  positive: "success",
  neutral: "muted",
};

/** Part (0–1) des brouillons IA récents dont la confiance atteint `threshold` ; `null` sans données. */
export function shareAtOrAbove(distribution: readonly number[], threshold: number): number | null {
  const total = distribution.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const above = distribution.slice(threshold).reduce((sum, count) => sum + count, 0);
  return above / total;
}

/**
 * Ce que signifie un seuil, calculé sur la distribution réelle des confiances des 30 derniers
 * jours (et non sur une formule fixe) : « environ X % des brouillons passeraient sans relecture ».
 */
export function describeThreshold(
  threshold: number,
  distribution: readonly number[],
  t: Translate,
  format: Formatters,
): { tone: Tone; text: string } {
  const above = shareAtOrAbove(distribution, threshold);
  if (above === null) return { tone: "muted", text: t("autonomy.note.noData") };

  if (threshold >= 90) {
    return { tone: "info", text: t("autonomy.note.strict", { share: format.points(Math.round((1 - above) * 100)) }) };
  }
  if (threshold >= 75) {
    return { tone: "success", text: t("autonomy.note.balanced", { share: format.points(Math.round(above * 100)) }) };
  }
  return { tone: "warning", text: t("autonomy.note.permissive") };
}

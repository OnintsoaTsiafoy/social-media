import type { FeedTag, Overview, Period, Severity } from "@/api/types";
import type { Formatters, MessageKey, Translate } from "@/i18n";
import type { Tone } from "@/types";

export const PERIODS: readonly Period[] = ["7d", "30d", "90d"];

export const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "danger",
  high: "warning",
  medium: "muted",
};

export const FEED_TAG_TONE: Record<FeedTag, Tone> = {
  question: "info",
  positive: "success",
  negative: "danger",
  neutral: "muted",
  pending: "muted",
};

export type HealthTone = Extract<Tone, "success" | "warning" | "danger" | "muted">;

export interface HealthRow {
  id: "webhookFailures" | "webhookLatency" | "backlog" | "tokens";
  label: MessageKey;
  value: string;
  /** Remplissage de la barre, 0–100. */
  percent: number;
  tone: HealthTone;
}

/** Seuils d'affichage : la console décide des couleurs, l'API ne renvoie que des mesures. */
export const HEALTH_THRESHOLDS = {
  /** Taux d'échec des webhooks à partir duquel la ligne passe à l'orange / au rouge. */
  failureWarning: 0.01,
  failureDanger: 0.05,
  /** Un taux d'échec de 10 % remplit la barre. */
  failureFullBar: 0.1,
  latencyWarningMs: 750,
  latencyDangerMs: 1500,
  latencyFullBarMs: 2000,
  backlogWarning: 100,
  backlogDanger: 250,
  backlogFullBar: 300,
} as const;

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export function buildHealth(health: Overview["health"], format: Formatters, t: Translate): HealthRow[] {
  const limits = HEALTH_THRESHOLDS;
  const { webhooks, moderationBacklog, tokens } = health;

  const failureRate = webhooks.total24h > 0 ? webhooks.failed24h / webhooks.total24h : null;
  const latency = webhooks.averageLatencyMs;

  return [
    {
      id: "webhookFailures",
      label: "health.webhookFailures",
      value:
        failureRate === null
          ? t("health.webhookFailures.none")
          : `${format.int(webhooks.failed24h)} / ${format.int(webhooks.total24h)}`,
      percent: failureRate === null ? 0 : clampPercent((failureRate / limits.failureFullBar) * 100),
      tone:
        failureRate === null
          ? "muted"
          : failureRate >= limits.failureDanger
            ? "danger"
            : failureRate >= limits.failureWarning
              ? "warning"
              : "success",
    },
    {
      id: "webhookLatency",
      label: "health.webhookLatency",
      value: latency === null ? t("health.webhookLatency.none") : `${format.int(latency)} ms`,
      percent: latency === null ? 0 : clampPercent((latency / limits.latencyFullBarMs) * 100),
      tone:
        latency === null
          ? "muted"
          : latency >= limits.latencyDangerMs
            ? "danger"
            : latency >= limits.latencyWarningMs
              ? "warning"
              : "success",
    },
    {
      id: "backlog",
      label: "health.backlog",
      value: format.int(moderationBacklog),
      percent: clampPercent((moderationBacklog / limits.backlogFullBar) * 100),
      tone:
        moderationBacklog >= limits.backlogDanger ? "danger" : moderationBacklog >= limits.backlogWarning ? "warning" : "success",
    },
    {
      id: "tokens",
      label: "health.tokens",
      value: t("health.tokens.value", { count: tokens.expiringWithinSevenDays }),
      percent:
        tokens.connectedPages > 0 ? clampPercent((tokens.expiringWithinSevenDays / tokens.connectedPages) * 100) : 0,
      tone: tokens.expiringWithinSevenDays === 0 ? "success" : tokens.expiringWithinSevenDays === 1 ? "warning" : "danger",
    },
  ];
}

export function overallHealth(rows: HealthRow[]): "operational" | "attention" | "degraded" {
  if (rows.some((row) => row.tone === "danger")) return "degraded";
  if (rows.some((row) => row.tone === "warning")) return "attention";
  return "operational";
}

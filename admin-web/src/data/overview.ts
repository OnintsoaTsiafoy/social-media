import { formatDuration, formatInt, recentDays } from "@/lib/format";
import type { NetworkCode, Tone } from "@/types";

/** Positive / neutral / negative comment counts per day, oldest first (last 14 days). */
export const DAILY_COMMENTS: ReadonlyArray<{ positive: number; neutral: number; negative: number }> = [
  { positive: 720, neutral: 320, negative: 96 },
  { positive: 810, neutral: 360, negative: 104 },
  { positive: 680, neutral: 300, negative: 132 },
  { positive: 980, neutral: 402, negative: 100 },
  { positive: 890, neutral: 340, negative: 148 },
  { positive: 520, neutral: 230, negative: 70 },
  { positive: 470, neutral: 200, negative: 62 },
  { positive: 760, neutral: 330, negative: 118 },
  { positive: 830, neutral: 350, negative: 96 },
  { positive: 910, neutral: 380, negative: 126 },
  { positive: 1040, neutral: 420, negative: 142 },
  { positive: 940, neutral: 366, negative: 110 },
  { positive: 560, neutral: 240, negative: 74 },
  { positive: 503, neutral: 206, negative: 95 },
];

export interface DayColumn {
  /** "Thu 18" — tooltip title. */
  full: string;
  weekday: string;
  /** "T18" — axis label. */
  label: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
}

/** Dates the fixture counts: the fourteen days ending today. */
export function buildDayColumns(now: Date): DayColumn[] {
  const days = recentDays(DAILY_COMMENTS.length, now);
  return DAILY_COMMENTS.map((counts, i) => {
    const { weekday, day } = days[i] ?? { weekday: "", day: 0 };
    return {
      ...counts,
      weekday,
      full: `${weekday} ${day}`,
      label: `${weekday.slice(0, 1)}${day}`,
      total: counts.positive + counts.neutral + counts.negative,
    };
  });
}

/** Sentiment breakdown behind the donut; its total is the "comments processed" figure. */
export const SENTIMENT_SPLIT = { positive: 7613, neutral: 3444, negative: 1423 } as const;
export const TOTAL_PROCESSED =
  SENTIMENT_SPLIT.positive + SENTIMENT_SPLIT.neutral + SENTIMENT_SPLIT.negative;

export interface Kpi {
  id: string;
  label: string;
  /** Rendered from the count-up progress (0 → 1) so the figure animates in. */
  value: (progress: number) => string;
  delta: string;
  /** `success` for an improvement, `danger` for a worsening. */
  tone: Extract<Tone, "success" | "danger">;
  spark: number[];
  foot: string;
}

export const KPIS: Kpi[] = [
  {
    id: "processed",
    label: "Comments processed",
    value: (t) => formatInt(TOTAL_PROCESSED * t),
    delta: "+8.2%",
    tone: "success",
    spark: [42, 48, 44, 58, 62, 57, 71, 78],
    foot: `vs ${formatInt(11534)} last period`,
  },
  {
    id: "first-response",
    label: "Avg. first response",
    value: (t) => formatDuration(4 * 60 + 12 * t),
    delta: "−18%",
    tone: "success",
    spark: [80, 74, 71, 66, 60, 55, 52, 48],
    foot: "SLA target 15 min",
  },
  {
    id: "ai-resolved",
    label: "AI auto-resolved",
    value: (t) => `${(68.4 * t).toFixed(1)}%`,
    delta: "+5.1%",
    tone: "success",
    spark: [40, 45, 49, 52, 58, 61, 65, 68],
    foot: `${formatInt(8537)} replies sent by AI`,
  },
  {
    id: "escalations",
    label: "Open escalations",
    value: (t) => String(Math.round(23 * t)),
    delta: "+3",
    tone: "danger",
    spark: [12, 14, 11, 16, 18, 17, 21, 23],
    foot: "6 older than 2 hours",
  },
];

export interface HealthMetric {
  label: string;
  value: string;
  percent: number;
  tone: Extract<Tone, "success" | "warning" | "danger">;
}

export const HEALTH: HealthMetric[] = [
  { label: "Graph API quota", value: "41%", percent: 41, tone: "success" },
  { label: "Webhook latency", value: "212 ms", percent: 28, tone: "success" },
  { label: "Moderation backlog", value: "186", percent: 63, tone: "warning" },
  { label: "Token expiries (7 d)", value: "2 pages", percent: 22, tone: "danger" },
];

export interface FeedEvent {
  net: NetworkCode;
  text: string;
  tag: "Question" | "Positive" | "Negative";
}

/** Sample comments the live stream cycles through. */
export const FEED_POOL: FeedEvent[] = [
  { net: "FB", text: "“Quand arrive le réassort de la crème n°3 ?”", tag: "Question" },
  { net: "IG", text: "“Commande reçue en avance, merci !”", tag: "Positive" },
  { net: "FB", text: "“Toujours aucune réponse à mon mail…”", tag: "Negative" },
  { net: "IG", text: "“Vous livrez en Belgique ?”", tag: "Question" },
  { net: "FB", text: "“Le service client a été super réactif”", tag: "Positive" },
  { net: "IG", text: "“Prix affiché différent du site”", tag: "Negative" },
  { net: "FB", text: "“Offre valable pour les départs d'octobre ?”", tag: "Question" },
  { net: "IG", text: "“Photo magnifique, bravo à l'équipe”", tag: "Positive" },
];

export const FEED_TAG_TONE: Record<FeedEvent["tag"], Tone> = {
  Question: "info",
  Positive: "success",
  Negative: "danger",
};

export const NETWORK_PAGE_COUNTS = { all: 24, fb: 16, ig: 8 } as const;

export type Severity = "Critical" | "High" | "Medium";

export interface Escalation {
  net: NetworkCode;
  text: string;
  page: string;
  by: string;
  ago: string;
  severity: Severity;
}

export const ESCALATIONS: Escalation[] = [
  { net: "FB", text: "Product recall rumour spreading under the launch post", page: "Nova Cosmetics", by: "Nadia B.", ago: "6 min", severity: "Critical" },
  { net: "IG", text: "Repeated insults targeting a moderator in comments", page: "Nova Cosmetics IG", by: "Amel H.", ago: "22 min", severity: "High" },
  { net: "FB", text: "Refund dispute escalated after 3 replies", page: "Aurora Travel", by: "Yacine F.", ago: "48 min", severity: "High" },
  { net: "FB", text: "Press account asking for an official statement", page: "Helio Energy", by: "Lina M.", ago: "1 h", severity: "Medium" },
];

export const SEVERITY_TONE: Record<Severity, Tone> = {
  Critical: "danger",
  High: "warning",
  Medium: "muted",
};

export interface Leader {
  name: string;
  initials: string;
  replies: number;
}

/** Replies handled this week; bar widths are relative to the top handler. */
export const LEADERS: Leader[] = [
  { name: "Amel Haddad", initials: "AH", replies: 467 },
  { name: "Nadia Belhadj", initials: "NB", replies: 412 },
  { name: "Yacine Ferhat", initials: "YF", replies: 388 },
  { name: "Lina Moreau", initials: "LM", replies: 204 },
  { name: "Thomas Weber", initials: "TW", replies: 96 },
];

export const RANGES = ["Last 7 days", "Last 30 days", "This quarter"] as const;
export type Range = (typeof RANGES)[number];

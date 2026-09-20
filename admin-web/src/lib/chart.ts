import { clamp, formatDuration } from "@/lib/format";
import type { SentimentLabel } from "@/types";

export type AnalyticsTab = "Engagement" | "Response time" | "Sentiment" | "AI performance";
export type Period = "7 d" | "30 d" | "90 d";
export type SentimentFilter = "All" | SentimentLabel;
export type PageFilter = "All pages" | "Nova Cosmetics" | "Aurora Travel" | "Helio Energy";

/** The analytics chart is drawn in a fixed 800×240 viewBox; y grows downwards. */
export const CHART_WIDTH = 800;
export const CHART_HEIGHT = 240;
export const CHART_BASELINE = 220;
/** Number of weekly points (weeks 29 → 38). */
export const CHART_POINTS = 10;
export const FIRST_WEEK = 29;

const BASE_SERIES: Record<AnalyticsTab, number[]> = {
  Engagement: [140, 122, 150, 118, 96, 104, 82, 70, 62, 58],
  "Response time": [70, 84, 76, 96, 110, 104, 126, 138, 150, 162],
  Sentiment: [120, 112, 128, 100, 110, 88, 92, 74, 68, 60],
  "AI performance": [168, 150, 142, 128, 118, 100, 92, 78, 66, 52],
};

const PERIOD_FACTOR: Record<Period, number> = { "7 d": 0.84, "30 d": 1, "90 d": 1.14 };
const SENTIMENT_FACTOR: Record<SentimentFilter, number> = {
  All: 1,
  Positive: 0.8,
  Neutral: 1.05,
  Negative: 1.26,
};
const PAGE_FACTOR: Record<PageFilter, number> = {
  "All pages": 1,
  "Nova Cosmetics": 0.88,
  "Aurora Travel": 1.16,
  "Helio Energy": 1.3,
};

export interface SeriesFilters {
  tab: AnalyticsTab;
  period: Period;
  sentiment: SentimentFilter;
  page: PageFilter;
}

/** Chart y-values (SVG space) for the current tab and filters. */
export function computeSeries({ tab, period, sentiment, page }: SeriesFilters): number[] {
  const factor = PERIOD_FACTOR[period] * SENTIMENT_FACTOR[sentiment] * PAGE_FACTOR[page];
  return BASE_SERIES[tab].map((value, i) =>
    clamp(value * factor + Math.sin(i * 1.3) * 4, 20, 222),
  );
}

/** Dashed comparison line: the previous period, derived from the current one. */
export function previousPeriod(series: number[]): number[] {
  return series.map((value, i) => clamp(value + 26 * Math.cos(i * 0.9) + 14, 24, 218));
}

export function toPolyline(series: number[]): string {
  const last = Math.max(1, series.length - 1);
  return series.map((y, i) => `${(i / last) * CHART_WIDTH},${y.toFixed(1)}`).join(" ");
}

export function toAreaPolygon(series: number[]): string {
  return `${toPolyline(series)} ${CHART_WIDTH},${CHART_BASELINE} 0,${CHART_BASELINE}`;
}

/** Converts a y coordinate back to the metric it represents for the given tab. */
export function metricAt(tab: AnalyticsTab, y: number): number {
  if (tab === "Response time") return y / 22;
  if (tab === "Engagement") return (CHART_HEIGHT - y) / 22;
  return (CHART_HEIGHT - y) / 2.6;
}

export function formatMetric(tab: AnalyticsTab, y: number): string {
  const value = metricAt(tab, y);
  if (tab === "Response time") return formatDuration(value * 60);
  if (tab === "Engagement") return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

export interface Trend {
  /** True when the metric moved in the desirable direction. */
  improving: boolean;
  deltaPercent: number;
}

/** A shorter response time is an improvement; for every other tab, higher is better. */
export function trendOf(tab: AnalyticsTab, series: number[]): Trend {
  const first = metricAt(tab, series[0] ?? 0);
  const last = metricAt(tab, series[series.length - 1] ?? 0);
  const gain = tab === "Response time" ? first - last : last - first;
  return {
    improving: gain > 0,
    deltaPercent: Math.abs(Math.round((gain / Math.max(0.1, first)) * 100)),
  };
}

/** Maps a pointer x-position (0–1 across the chart) to the nearest weekly point. */
export function pointIndexAt(ratio: number): number {
  return Math.round(clamp(ratio, 0, 1) * (CHART_POINTS - 1));
}

/** Sparkline polyline in a 120×30 viewBox, scaled to the series' own min/max. */
export function sparkPoints(values: number[]): string {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const last = Math.max(1, values.length - 1);
  return values
    .map((v, i) => `${(i / last) * 120},${28 - ((v - min) / (max - min || 1)) * 26}`)
    .join(" ");
}

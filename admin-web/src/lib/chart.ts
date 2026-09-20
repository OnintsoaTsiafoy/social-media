import type { Metric, Trend } from "@/api/types";
import type { Formatters } from "@/i18n";
import { clamp } from "@/i18n/format";

/** The trend chart is drawn in a fixed 800×240 viewBox; y grows downwards. */
export const CHART_WIDTH = 800;
export const CHART_HEIGHT = 240;
export const CHART_BASELINE = 220;
/** Marge haute : la courbe ne touche jamais le bord du cadre. */
export const CHART_TOP = 24;

/** Une valeur par point de la période ; `null` = non disponible (jamais 0). */
export type Series = Array<number | null>;

export interface ChartPoint {
  index: number;
  /** Position dans le viewBox. */
  x: number;
  y: number;
  value: number;
}

export interface ChartLayout {
  current: Array<ChartPoint | null>;
  previous: Array<ChartPoint | null>;
}

export const hasData = (series: Series): boolean => series.some((value) => value !== null);

export function xAt(index: number, count: number): number {
  return count <= 1 ? CHART_WIDTH / 2 : (index / (count - 1)) * CHART_WIDTH;
}

/**
 * Place les deux courbes dans le viewBox. L'axe part de zéro et son plafond est le plus haut
 * relevé des deux périodes (+ 15 %), pour que la période précédente reste comparable.
 */
export function layoutSeries(current: Series, previous: Series): ChartLayout {
  const values = [...current, ...previous].filter((value): value is number => value !== null);
  const ceiling = Math.max(...values, 0) * 1.15 || 1;
  const usable = CHART_BASELINE - CHART_TOP;

  const place = (series: Series): Array<ChartPoint | null> =>
    series.map((value, index) =>
      value === null
        ? null
        : { index, value, x: xAt(index, series.length), y: CHART_BASELINE - clamp(value / ceiling, 0, 1) * usable },
    );
  return { current: place(current), previous: place(previous) };
}

const present = (points: Array<ChartPoint | null>): ChartPoint[] =>
  points.filter((point): point is ChartPoint => point !== null);

/** Points reliés d'un trait ; les périodes sans donnée sont sautées, pas mises à zéro. */
export function toPolyline(points: Array<ChartPoint | null>): string {
  return present(points)
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

export function toAreaPolygon(points: Array<ChartPoint | null>): string {
  const visible = present(points);
  const first = visible[0];
  const last = visible[visible.length - 1];
  if (!first || !last || visible.length < 2) return "";
  return `${toPolyline(points)} ${last.x.toFixed(1)},${CHART_BASELINE} ${first.x.toFixed(1)},${CHART_BASELINE}`;
}

/** Maps a pointer x-position (0–1 across the chart) to the nearest point. */
export function pointIndexAt(ratio: number, count: number): number {
  return Math.round(clamp(ratio, 0, 1) * Math.max(0, count - 1));
}

/** Sparkline polyline in a 120×30 viewBox, scaled to the series' own min/max; gaps are skipped. */
export function sparkPoints(values: Series): string {
  const known = values.flatMap((value, index) => (value === null ? [] : [{ value, index }]));
  if (known.length === 0) return "";
  const max = Math.max(...known.map((entry) => entry.value));
  const min = Math.min(...known.map((entry) => entry.value));
  const last = Math.max(1, values.length - 1);
  return known
    .map(({ value, index }) => `${(index / last) * 120},${28 - ((value - min) / (max - min || 1)) * 26}`)
    .join(" ");
}

/** Valeur d'un indicateur, dans la langue courante ; `null` n'est jamais rendu ici (voir l'appelant). */
export function formatMetric(metric: Metric, value: number, format: Formatters): string {
  if (metric === "response_time") return format.duration(value);
  return format.percent(value, metric === "engagement" ? 1 : 0);
}

export interface TrendDirection {
  /** Vrai quand l'indicateur évolue dans le bon sens (un délai plus court est une amélioration). */
  improving: boolean;
  deltaPercent: number;
}

/** Évolution de la période par rapport à la précédente ; `null` sans référence comparable. */
export function trendOf(metric: Metric, summary: Trend["summary"]): TrendDirection | null {
  if (summary.deltaPercent === null) return null;
  const delta = summary.deltaPercent;
  return {
    improving: metric === "response_time" ? delta <= 0 : delta >= 0,
    deltaPercent: Math.abs(Math.round(delta)),
  };
}

import { useMemo, useState, type MouseEvent } from "react";

import type { Metric, SentimentFilter, Trend } from "@/api/types";
import { useI18n, type MessageKey } from "@/i18n";
import { clamp } from "@/i18n/format";
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  formatMetric,
  hasData,
  layoutSeries,
  pointIndexAt,
  toAreaPolygon,
  toPolyline,
  trendOf,
  xAt,
} from "@/lib/chart";
import { useTweenedArray } from "@/lib/motion";

const DAY_MS = 86_400_000;

/** Le titre du sentiment dépend du filtre choisi (positif, neutre, négatif) : il est résolu à part. */
const TITLE_KEY: Partial<Record<Metric, MessageKey>> = {
  engagement: "chart.engagement.title",
  response_time: "chart.response_time.title",
  ai_performance: "chart.ai_performance.title",
};

interface TrendChartProps {
  metric: Metric;
  sentiment: SentimentFilter;
  trend: Trend;
}

export function TrendChart({ metric, sentiment, trend }: TrendChartProps) {
  const { t, format } = useI18n();
  const [cursor, setCursor] = useState<number | null>(null);

  const count = trend.points.length;
  // Les deux périodes sont animées d'un bloc : même forme, mêmes trous.
  const target = useMemo(
    () => [...trend.points.map((point) => point.value), ...trend.previous.map((point) => point.value)],
    [trend],
  );
  const shown = useTweenedArray(target);
  const layout = useMemo(() => layoutSeries(shown.slice(0, count), shown.slice(count)), [shown, count]);

  const direction = trendOf(metric, trend.summary);
  const unavailable = t("common.unavailable");
  const title = t(TITLE_KEY[metric] ?? `chart.sentiment.title.${sentiment}`);
  const dataAvailable = hasData(trend.points.map((point) => point.value));

  const first = trend.points[0];
  const last = trend.points[count - 1];
  const dateOf = (iso: string) => format.shortDate(new Date(iso));
  /** Un seau d'un jour s'étiquette par sa date ; au-delà, par sa plage. */
  const rangeLabel = (start: string, end: string) => {
    const spansDays = new Date(end).getTime() - new Date(start).getTime() > DAY_MS * 1.5;
    return spansDays ? `${dateOf(start)} – ${dateOf(new Date(new Date(end).getTime() - 1).toISOString())}` : dateOf(start);
  };

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setCursor(pointIndexAt((event.clientX - box.left) / box.width, count));
  };

  const cursorPoint = cursor === null ? null : (trend.points[cursor] ?? null);
  const cursorLayout = cursor === null ? null : (layout.current[cursor] ?? null);
  const previousValue = cursor === null ? null : (trend.previous[cursor]?.value ?? null);
  const readout =
    cursorPoint && cursor !== null
      ? {
          x: (xAt(cursor, count) / CHART_WIDTH) * 100,
          y: cursorLayout ? (cursorLayout.y / CHART_HEIGHT) * 100 : null,
          label: rangeLabel(cursorPoint.start, cursorPoint.end),
          value: cursorPoint.value === null ? unavailable : formatMetric(metric, cursorPoint.value, format),
          previous:
            previousValue === null
              ? t("chart.tip.previousNone")
              : t("chart.tip.previous", { value: formatMetric(metric, previousValue, format) }),
        }
      : null;

  // Une valeur isolée (voisins sans donnée) ne forme pas de segment : on la marque d'un point.
  const isolated = layout.current.filter(
    (point) => point !== null && layout.current[point.index - 1] == null && layout.current[point.index + 1] == null,
  );

  // Quatre repères sur l'axe, du premier au dernier point.
  const axisIndexes = [...new Set([0, Math.round((count - 1) / 3), Math.round(((count - 1) * 2) / 3), count - 1])].filter(
    (index) => index >= 0 && index < count,
  );

  return (
    <div className="card chart">
      <div className="chart__head">
        <div>
          <div className="card__title">{title}</div>
          <div className="card__sub">{t(`chart.${metric}.subtitle`)}</div>
        </div>
        <div className="chart__big">
          <span className="chart__value">
            {trend.summary.value === null ? unavailable : formatMetric(metric, trend.summary.value, format)}
          </span>
          {direction ? (
            <span className="trend" data-tone={direction.improving ? "success" : "danger"}>
              <span className="trend__arrow" data-down={!direction.improving} aria-hidden="true">
                ▲
              </span>
              {direction.improving ? "+" : "−"}
              {format.points(direction.deltaPercent)}
            </span>
          ) : (
            <span className="trend" data-tone="muted">
              {t("chart.noDelta")}
            </span>
          )}
        </div>
      </div>

      <div className="chart__plot" onMouseMove={onMove} onMouseLeave={() => setCursor(null)}>
        <svg
          className="chart__svg"
          viewBox="0 0 800 240"
          preserveAspectRatio="none"
          role="img"
          aria-label={first && last ? t("chart.aria", { title, start: dateOf(first.start), end: dateOf(last.end) }) : title}
        >
          <line x1="0" y1="40" x2="800" y2="40" stroke="var(--chip)" strokeWidth="1" />
          <line x1="0" y1="100" x2="800" y2="100" stroke="var(--chip)" strokeWidth="1" />
          <line x1="0" y1="160" x2="800" y2="160" stroke="var(--chip)" strokeWidth="1" />
          <line x1="0" y1="220" x2="800" y2="220" stroke="var(--border)" strokeWidth="1" />
          {dataAvailable && (
            <>
              <polygon className="chart__area" points={toAreaPolygon(layout.current)} />
              <polyline className="chart__prev" points={toPolyline(layout.previous)} />
              <polyline className="chart__line" points={toPolyline(layout.current)} />
            </>
          )}
        </svg>
        {!dataAvailable && <div className="chart__empty">{t("chart.empty")}</div>}
        {isolated.map(
          (point) =>
            point && (
              <div
                key={point.index}
                className="chart__point"
                style={{ left: `${(point.x / CHART_WIDTH) * 100}%`, top: `${(point.y / CHART_HEIGHT) * 100}%` }}
              />
            ),
        )}
        {readout && dataAvailable && (
          <>
            <div className="chart__cursor" style={{ left: `${readout.x}%` }}>
              {readout.y !== null && <div className="chart__dot" style={{ top: `${readout.y}%` }} />}
            </div>
            <div className="chart__tip" style={{ left: `${clamp(readout.x, 10, 90)}%` }}>
              <div className="chart__tip-week">{readout.label}</div>
              <div className="chart__tip-value">{readout.value}</div>
              <div className="chart__tip-prev">{readout.previous}</div>
            </div>
          </>
        )}
      </div>

      <div className="chart__axis">
        {axisIndexes.map((index) => {
          const point = trend.points[index];
          return point ? <span key={index}>{dateOf(point.start)}</span> : null;
        })}
      </div>
    </div>
  );
}

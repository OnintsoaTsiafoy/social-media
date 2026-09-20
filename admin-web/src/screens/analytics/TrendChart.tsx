import { useMemo, useState, type MouseEvent } from "react";

import { CHART_META } from "@/data/analytics";
import {
  CHART_HEIGHT,
  CHART_POINTS,
  FIRST_WEEK,
  formatMetric,
  pointIndexAt,
  previousPeriod,
  toAreaPolygon,
  toPolyline,
  trendOf,
  type AnalyticsTab,
} from "@/lib/chart";
import { clamp } from "@/lib/format";

/** Weekly points that get an axis label (every third one). */
const AXIS_STEPS = [0, 3, 6, 9];

interface TrendChartProps {
  tab: AnalyticsTab;
  /** Y-values currently on screen (already eased towards the filtered series). */
  series: number[];
}

export function TrendChart({ tab, series }: TrendChartProps) {
  const [cursor, setCursor] = useState<number | null>(null);

  const previous = useMemo(() => previousPeriod(series), [series]);
  const trend = trendOf(tab, series);
  const meta = CHART_META[tab];
  const last = series[series.length - 1] ?? 0;

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setCursor(pointIndexAt((event.clientX - box.left) / box.width));
  };

  const at = cursor === null ? null : (series[cursor] ?? null);
  const readout =
    cursor !== null && at !== null
      ? {
          x: (cursor / (CHART_POINTS - 1)) * 100,
          y: (at / CHART_HEIGHT) * 100,
          week: `WEEK ${FIRST_WEEK + cursor}`,
          value: formatMetric(tab, at),
          previous: formatMetric(tab, previous[cursor] ?? at),
        }
      : null;

  return (
    <div className="card chart">
      <div className="chart__head">
        <div>
          <div className="card__title">{meta.title}</div>
          <div className="card__sub">{meta.subtitle}</div>
        </div>
        <div className="chart__big">
          <span className="chart__value">{formatMetric(tab, last)}</span>
          <span className="trend" data-tone={trend.improving ? "success" : "danger"}>
            <span className="trend__arrow" data-down={!trend.improving} aria-hidden="true">
              ▲
            </span>
            {trend.improving ? "+" : "−"}
            {trend.deltaPercent}%
          </span>
        </div>
      </div>

      <div className="chart__plot" onMouseMove={onMove} onMouseLeave={() => setCursor(null)}>
        <svg className="chart__svg" viewBox="0 0 800 240" preserveAspectRatio="none" role="img" aria-label={`${meta.title}, weeks ${FIRST_WEEK} to ${FIRST_WEEK + CHART_POINTS - 1}`}>
          <line x1="0" y1="40" x2="800" y2="40" stroke="#F4F5F6" strokeWidth="1" />
          <line x1="0" y1="100" x2="800" y2="100" stroke="#F4F5F6" strokeWidth="1" />
          <line x1="0" y1="160" x2="800" y2="160" stroke="#F4F5F6" strokeWidth="1" />
          <line x1="0" y1="220" x2="800" y2="220" stroke="#ECEDEF" strokeWidth="1" />
          <polygon className="chart__area" points={toAreaPolygon(series)} />
          <polyline className="chart__prev" points={toPolyline(previous)} />
          <polyline className="chart__line" points={toPolyline(series)} />
        </svg>
        {readout && (
          <>
            <div className="chart__cursor" style={{ left: `${readout.x}%` }}>
              <div className="chart__dot" style={{ top: `${readout.y}%` }} />
            </div>
            <div className="chart__tip" style={{ left: `${clamp(readout.x, 10, 90)}%` }}>
              <div className="chart__tip-week">{readout.week}</div>
              <div className="chart__tip-value">{readout.value}</div>
              <div className="chart__tip-prev">previous period {readout.previous}</div>
            </div>
          </>
        )}
      </div>

      <div className="chart__axis">
        {AXIS_STEPS.map((step) => (
          <span key={step}>Week {FIRST_WEEK + step}</span>
        ))}
      </div>
    </div>
  );
}

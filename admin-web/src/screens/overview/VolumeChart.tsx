import { useMemo, useState, type CSSProperties } from "react";

import { buildDayColumns, SENTIMENT_SPLIT, TOTAL_PROCESSED } from "@/data/overview";
import { delay } from "@/lib/css";
import { formatInt } from "@/lib/format";

/** Height in px of the tallest stacked bar. */
const BAR_AREA = 168;

const swatch = (color: string) => ({ "--swatch": color }) as CSSProperties;

export function VolumeChart({ progress }: { progress: number }) {
  const [active, setActive] = useState<number | null>(null);
  const columns = useMemo(() => buildDayColumns(new Date()), []);

  const scale = BAR_AREA / Math.max(...columns.map((column) => column.total));
  const peak = columns.reduce((best, column) => (column.total > best.total ? column : best));
  const negativeShare = (SENTIMENT_SPLIT.negative / TOTAL_PROCESSED) * 100;
  const hovered = active === null ? null : (columns[active] ?? null);

  return (
    <div className="card card--pad span-2 rise" style={delay(60)}>
      <div className="volume__head">
        <div>
          <div className="card__title">Comment volume &amp; sentiment</div>
          <div className="card__sub">Aggregated across all connected pages</div>
        </div>
        <div className="legend">
          <span className="legend__item"><i className="swatch" style={swatch("var(--lime)")} />Positive</span>
          <span className="legend__item"><i className="swatch" style={swatch("var(--border-strong)")} />Neutral</span>
          <span className="legend__item"><i className="swatch" style={swatch("var(--danger)")} />Negative</span>
        </div>
      </div>

      <div className="bars" onMouseLeave={() => setActive(null)}>
        {columns.map((column, i) => (
          <div
            key={column.full}
            className="bars__col"
            data-dim={active !== null && active !== i}
            style={delay(i * 35)}
            tabIndex={0}
            aria-label={`${column.full}: ${column.positive} positive, ${column.neutral} neutral, ${column.negative} negative`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            <div className="bars__seg bars__seg--neg" style={{ height: Math.round(column.negative * scale) }} />
            <div className="bars__seg bars__seg--neu" style={{ height: Math.round(column.neutral * scale) }} />
            <div className="bars__seg bars__seg--pos" style={{ height: Math.round(column.positive * scale) }} />
            <div className="bars__label">{column.label}</div>
          </div>
        ))}
        {hovered && active !== null && (
          <div className="tip" style={{ left: `${((active + 0.5) / columns.length) * 100}%` }}>
            <div className="tip__title">{hovered.full}</div>
            <div>
              Positive <b>{hovered.positive}</b> · Neutral <b>{hovered.neutral}</b> · Negative <b>{hovered.negative}</b>
            </div>
          </div>
        )}
      </div>

      <div className="totals">
        <div>
          <div className="totals__label">Total processed</div>
          <div className="totals__value">{formatInt(TOTAL_PROCESSED * progress)}</div>
        </div>
        <div>
          <div className="totals__label">Peak day</div>
          <div className="totals__value">
            {peak.weekday} · {formatInt(peak.total)}
          </div>
        </div>
        <div>
          <div className="totals__label">Negative share</div>
          <div className="totals__value" style={{ color: "var(--danger-text)" }}>
            {negativeShare.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}

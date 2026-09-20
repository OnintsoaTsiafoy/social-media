import type { CSSProperties } from "react";

import { HEALTH, SENTIMENT_SPLIT, TOTAL_PROCESSED } from "@/data/overview";
import { delay } from "@/lib/css";
import { formatInt } from "@/lib/format";

const swatch = (color: string) => ({ "--swatch": color }) as CSSProperties;

export function SentimentSplit() {
  const { positive, neutral, negative } = SENTIMENT_SPLIT;
  const upToPositive = positive / TOTAL_PROCESSED;
  const upToNeutral = (positive + neutral) / TOTAL_PROCESSED;
  const rows = [
    { label: "Positive", count: positive, color: "var(--lime)" },
    { label: "Neutral", count: neutral, color: "var(--border-strong)" },
    { label: "Negative", count: negative, color: "var(--danger)" },
  ];

  return (
    <div className="card card--pad rise" style={delay(120)}>
      <div className="card__title">Sentiment split</div>
      <div className="donut-row">
        <div
          className="donut"
          role="img"
          aria-label={`${Math.round(upToPositive * 100)}% positive`}
          style={{
            background: `conic-gradient(var(--lime) 0turn ${upToPositive}turn, var(--border-strong) ${upToPositive}turn ${upToNeutral}turn, var(--danger) ${upToNeutral}turn 1turn)`,
          }}
        >
          <div className="donut__hole">
            <div className="donut__value">{Math.round(upToPositive * 100)}%</div>
            <div className="donut__caption">positive</div>
          </div>
        </div>
        <div className="split">
          {rows.map((row) => (
            <div className="split__row" key={row.label}>
              <span className="split__name">
                <i className="swatch" style={swatch(row.color)} />
                {row.label}
              </span>
              <b>{formatInt(row.count)}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SystemHealth() {
  return (
    <div className="card card--pad rise" style={delay(180)}>
      <div className="health__head">
        <div className="card__title">System health</div>
        <span className="health__status">OPERATIONAL</span>
      </div>
      <div className="health__list">
        {HEALTH.map((metric) => (
          <div className="health__row" key={metric.label} data-tone={metric.tone}>
            <div className="health__line">
              <span>{metric.label}</span>
              <b>{metric.value}</b>
            </div>
            <div className="health__track">
              <div className="health__fill" style={{ width: `${metric.percent}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

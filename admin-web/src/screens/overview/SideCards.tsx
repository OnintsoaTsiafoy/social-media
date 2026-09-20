import { useMemo, type CSSProperties } from "react";

import type { Overview, SentimentKey } from "@/api/types";
import { buildHealth, overallHealth } from "@/domain/overview";
import { useI18n } from "@/i18n";
import { delay } from "@/lib/css";

const swatch = (color: string) => ({ "--swatch": color }) as CSSProperties;

const ROWS: Array<{ key: SentimentKey; color: string }> = [
  { key: "positive", color: "var(--lime)" },
  { key: "neutral", color: "var(--border-strong)" },
  { key: "negative", color: "var(--danger)" },
];

export function SentimentSplit({ split }: { split: Overview["sentiment"] }) {
  const { t, format } = useI18n();
  const total = split.positive + split.neutral + split.negative;
  const upToPositive = total > 0 ? split.positive / total : 0;
  const upToNeutral = total > 0 ? (split.positive + split.neutral) / total : 0;
  const percent = format.points(Math.round(upToPositive * 100));

  return (
    <div className="card card--pad rise" style={delay(120)}>
      <div className="card__title">{t("sentiment.title")}</div>
      <div className="donut-row">
        <div
          className="donut"
          role="img"
          aria-label={t("sentiment.aria", { percent })}
          style={{
            background:
              total > 0
                ? `conic-gradient(var(--lime) 0turn ${upToPositive}turn, var(--border-strong) ${upToPositive}turn ${upToNeutral}turn, var(--danger) ${upToNeutral}turn 1turn)`
                : "var(--chip)",
          }}
        >
          <div className="donut__hole">
            <div className="donut__value">{total > 0 ? percent : "—"}</div>
            <div className="donut__caption">{t("sentiment.positiveCaption")}</div>
          </div>
        </div>
        <div className="split">
          {ROWS.map((row) => (
            <div className="split__row" key={row.key}>
              <span className="split__name">
                <i className="swatch" style={swatch(row.color)} />
                {t(`sentiment.${row.key}`)}
              </span>
              <b>{format.int(split[row.key])}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SystemHealth({ health }: { health: Overview["health"] }) {
  const { t, format } = useI18n();
  const rows = useMemo(() => buildHealth(health, format, t), [health, format, t]);
  const status = overallHealth(rows);

  return (
    <div className="card card--pad rise" style={delay(180)}>
      <div className="health__head">
        <div className="card__title">{t("health.title")}</div>
        <span className="health__status" data-status={status}>
          {t(`health.status.${status}`)}
        </span>
      </div>
      <div className="health__list">
        {rows.map((row) => (
          <div className="health__row" key={row.id} data-tone={row.tone}>
            <div className="health__line">
              <span>{t(row.label)}</span>
              <b>{row.value}</b>
            </div>
            <div className="health__track">
              <div className="health__fill" style={{ width: `${row.percent}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

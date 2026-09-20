import { useMemo, type CSSProperties } from "react";

import { ErrorState } from "@/components/ErrorState";
import { NetBadge } from "@/components/Network";
import {
  FIRST_HOUR,
  HEALTHY_SENTIMENT,
  LAST_HOUR,
  METRICS,
  METRICS_WITHOUT_SENTIMENT,
  SENTIMENT_FILTERS,
  SLOW_REPLY_SECONDS,
} from "@/domain/analytics";
import { PERIODS } from "@/domain/overview";
import { useI18n } from "@/i18n";
import { columns, cx, delay } from "@/lib/css";
import { NET_CODE, NET_LABEL } from "@/lib/network";
import { useAdmin } from "@/state/AdminContext";
import { useAnalytics } from "@/state/useAnalytics";

import { TrendChart } from "./TrendChart";
import "./analytics.css";

const SENTIMENT_SWATCH = {
  all: "var(--disabled)",
  positive: "var(--lime)",
  neutral: "var(--border-strong)",
  negative: "var(--danger)",
} as const;

const hourColor = (average: number, peak: number) =>
  average >= peak * 0.8 ? "var(--lime-deep)" : average >= peak * 0.4 ? "var(--lime)" : "var(--border)";

export function AnalyticsScreen() {
  const { t, format } = useI18n();
  const { analytics, net, setNet } = useAdmin();
  const { trend, pages } = useAnalytics();
  const { metric, period, sentiment, pageId } = analytics;
  const sentimentDisabled = METRICS_WITHOUT_SENTIMENT.includes(metric);

  const unavailable = t("common.unavailable");
  const hours = useMemo(
    () => (pages.data?.hourly ?? []).filter((entry) => entry.hour >= FIRST_HOUR && entry.hour <= LAST_HOUR),
    [pages.data],
  );
  const peakHour = hours.reduce((best, entry) => (entry.average > best.average ? entry : best), { hour: FIRST_HOUR, average: 0 });

  return (
    <div className="screen">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">{t("screen.analytics")}</h1>
          <p className="page-head__sub">{t("analytics.subtitle")}</p>
        </div>
      </div>

      <div className="an-controls">
        <div className="segmented" style={{ gap: 6 }} role="group" aria-label={t("analytics.metric.aria")}>
          {METRICS.map((name) => (
            <button
              type="button"
              className="tab"
              key={name}
              aria-pressed={metric === name}
              onClick={() => analytics.setMetric(name)}
            >
              {t(`analytics.metric.${name}`)}
            </button>
          ))}
        </div>

        <div className="segmented" role="group" aria-label={t("analytics.period.aria")}>
          {PERIODS.map((name) => (
            <button
              type="button"
              className="period"
              key={name}
              aria-pressed={period === name}
              onClick={() => analytics.setPeriod(name)}
            >
              {t(`analytics.period.${name}`)}
            </button>
          ))}
        </div>

        <div className="filters" role="group" aria-label={t("analytics.sentiment.aria")}>
          {SENTIMENT_FILTERS.map((name) => (
            <button
              type="button"
              className="sent-filter"
              key={name}
              aria-pressed={sentiment === name}
              disabled={sentimentDisabled}
              title={sentimentDisabled ? t("analytics.sentiment.disabledHint") : undefined}
              onClick={() => analytics.setSentiment(name)}
            >
              <i style={{ "--swatch": SENTIMENT_SWATCH[name] } as CSSProperties} />
              {t(`analytics.sentiment.${name}`)}
            </button>
          ))}
        </div>

        <select
          className="page-filter"
          aria-label={t("analytics.page.aria")}
          value={pageId ?? ""}
          onChange={(event) => analytics.setPageId(event.target.value || undefined)}
        >
          <option value="">{t("analytics.page.all")}</option>
          {(pages.data?.options ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} ({NET_CODE[option.network]})
            </option>
          ))}
        </select>
      </div>

      {trend.data ? (
        <TrendChart metric={metric} sentiment={sentiment} trend={trend.data} />
      ) : trend.error && !trend.loading ? (
        <ErrorState error={trend.error} onRetry={trend.reload} inline />
      ) : (
        <div className="skeleton skeleton--card" style={{ height: 340, borderRadius: 18 }} role="status" aria-busy="true" aria-label={t("common.loading")} />
      )}

      <div className="grid-auto grid-auto--top" style={columns(310)}>
        <div className="card card--flush span-2 rise" style={delay(60)}>
          <div className="card__head">
            <div className="card__title">{t("perfTable.title")}</div>
            {net !== "all" && (
              <button type="button" className="link-btn" onClick={() => setNet("all")}>
                {t("perfTable.clear", { network: t(NET_LABEL[net]).charAt(0) + t(NET_LABEL[net]).slice(1).toLowerCase() })}
              </button>
            )}
          </div>
          {pages.data ? (
            <div role="table" aria-label={t("perfTable.title")}>
              <div className="table-head perf-cols" role="row">
                <span role="columnheader">{t("perfTable.columns.page")}</span>
                <span role="columnheader">{t("perfTable.columns.comments")}</span>
                <span role="columnheader">{t("perfTable.columns.firstReply")}</span>
                <span role="columnheader">{t("perfTable.columns.aiShare")}</span>
                <span role="columnheader">{t("perfTable.columns.sentiment")}</span>
              </div>
              {pages.data.pages.map((row) => {
                const healthy = row.sentimentScore !== null && row.sentimentScore >= HEALTHY_SENTIMENT;
                return (
                  <div className="perf-row" role="row" key={row.id}>
                    <div className="perf-row__page" role="cell">
                      <NetBadge net={row.network} size="sm" />
                      <span className="perf-row__name">{row.name}</span>
                    </div>
                    <span className="perf-row__num perf-row__comments" role="cell">
                      {format.int(row.comments)}
                      {row.sentimentScore !== null && (
                        <i className="trend-mark" data-down={!healthy} aria-hidden="true">
                          ▲
                        </i>
                      )}
                    </span>
                    <span
                      className={cx(
                        "perf-row__num",
                        row.firstReplySeconds !== null &&
                          (row.firstReplySeconds >= SLOW_REPLY_SECONDS ? "perf-row__num--slow" : "perf-row__num--ok"),
                      )}
                      role="cell"
                    >
                      {row.firstReplySeconds === null ? unavailable : format.duration(row.firstReplySeconds)}
                    </span>
                    <span className="perf-row__num" role="cell">
                      {row.aiShare === null ? unavailable : format.percent(row.aiShare, 0)}
                    </span>
                    <div className="sent-cell" role="cell">
                      {row.sentimentScore === null ? (
                        <span className="perf-row__num">{unavailable}</span>
                      ) : (
                        <>
                          <div className="sent-cell__track">
                            <div className="sent-cell__fill" style={{ width: `${row.sentimentScore}%` }} />
                          </div>
                          <b>{row.sentimentScore}</b>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {pages.data.pages.length === 0 && <div className="empty">{t("perfTable.empty")}</div>}
            </div>
          ) : pages.error && !pages.loading ? (
            <ErrorState error={pages.error} onRetry={pages.reload} inline />
          ) : (
            <div className="skeleton" style={{ height: 200, margin: 20 }} role="status" aria-busy="true" aria-label={t("common.loading")} />
          )}
        </div>

        <div className="card card--pad rise" style={delay(100)}>
          <div className="card__title">{t("peak.title")}</div>
          <div className="card__sub">{t("peak.subtitle")}</div>
          <div className="hours">
            {hours.map((entry, i) => (
              <div
                key={entry.hour}
                className="hours__bar"
                title={`${String(entry.hour).padStart(2, "0")} h · ${format.decimal(entry.average, 1)}`}
                style={
                  {
                    height: peakHour.average > 0 ? Math.max(entry.average > 0 ? 3 : 0, Math.round((entry.average / peakHour.average) * 120)) : 0,
                    "--bar": hourColor(entry.average, peakHour.average),
                    ...delay(i * 30),
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className="hours__axis">
            <span>06h</span>
            <span>12h</span>
            <span>18h</span>
            <span>24h</span>
          </div>
          <div className="hours__note">
            {peakHour.average > 0
              ? t("peak.note", { hour: `${String(peakHour.hour).padStart(2, "0")} h`, count: Math.round(peakHour.average * 10) / 10 })
              : t("peak.none")}
          </div>
        </div>
      </div>
    </div>
  );
}

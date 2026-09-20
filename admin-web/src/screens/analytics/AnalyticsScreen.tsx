import { useMemo, type CSSProperties } from "react";

import { ChevronDownIcon } from "@/components/icons";
import { NetBadge } from "@/components/Network";
import {
  ANALYTICS_TABS,
  HEALTHY_SENTIMENT,
  HOURLY_VOLUME,
  PAGE_STATS,
  PERIODS,
  SENTIMENT_FILTERS,
  SLOW_REPLY_SECONDS,
} from "@/data/analytics";
import { computeSeries } from "@/lib/chart";
import { columns, cx, delay } from "@/lib/css";
import { formatDuration } from "@/lib/format";
import { useTweenedArray } from "@/lib/motion";
import { matchesNet, NET_LABEL } from "@/lib/network";
import { useAdmin } from "@/state/AdminContext";

import { TrendChart } from "./TrendChart";
import "./analytics.css";

const SENTIMENT_SWATCH = {
  All: "var(--disabled)",
  Positive: "var(--lime)",
  Neutral: "var(--border-strong)",
  Negative: "var(--danger)",
} as const;

const hourColor = (volume: number) =>
  volume > 110 ? "var(--lime-deep)" : volume > 60 ? "var(--lime)" : "var(--border)";

export function AnalyticsScreen() {
  const { analytics, net, setNet } = useAdmin();
  const { tab, period, sentiment, page } = analytics;

  const target = useMemo(() => computeSeries({ tab, period, sentiment, page }), [tab, period, sentiment, page]);
  const series = useTweenedArray(target);

  const rows = PAGE_STATS.filter((row) => matchesNet(net, row.net)).filter(
    (row) => page === "All pages" || row.name === page,
  );

  return (
    <div className="screen">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Analytics</h1>
          <p className="page-head__sub">Response performance and community health, page by page</p>
        </div>
      </div>

      <div className="an-controls">
        <div className="segmented" style={{ gap: 6 }} role="group" aria-label="Metric">
          {ANALYTICS_TABS.map((name) => (
            <button
              type="button"
              className="tab"
              key={name}
              aria-pressed={tab === name}
              onClick={() => analytics.setTab(name)}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="segmented" role="group" aria-label="Period">
          {PERIODS.map((name) => (
            <button
              type="button"
              className="period"
              key={name}
              aria-pressed={period === name}
              onClick={() => analytics.setPeriod(name)}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="filters" role="group" aria-label="Sentiment">
          {SENTIMENT_FILTERS.map((name) => (
            <button
              type="button"
              className="sent-filter"
              key={name}
              aria-pressed={sentiment === name}
              onClick={() => analytics.setSentiment(name)}
            >
              <i style={{ "--swatch": SENTIMENT_SWATCH[name] } as CSSProperties} />
              {name}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={cx("btn", "btn--outline", "btn--select", "page-filter")}
          aria-label={`Page: ${page}. Activate to change.`}
          onClick={analytics.cyclePage}
        >
          {page}
          <ChevronDownIcon />
        </button>
      </div>

      <TrendChart tab={tab} series={series} />

      <div className="grid-auto grid-auto--top" style={columns(310)}>
        <div className="card card--flush span-2 rise" style={delay(60)}>
          <div className="card__head">
            <div className="card__title">Performance by page</div>
            {net !== "all" && (
              <button type="button" className="link-btn" onClick={() => setNet("all")}>
                {NET_LABEL[net].charAt(0) + NET_LABEL[net].slice(1).toLowerCase()} only · Clear
              </button>
            )}
          </div>
          <div role="table" aria-label="Performance by page">
            <div className="table-head perf-cols" role="row">
              <span role="columnheader">PAGE</span>
              <span role="columnheader">COMMENTS</span>
              <span role="columnheader">1ST REPLY</span>
              <span role="columnheader">AI SHARE</span>
              <span role="columnheader">SENTIMENT</span>
            </div>
            {rows.map((row) => {
              const healthy = row.sentiment >= HEALTHY_SENTIMENT;
              return (
                <div className="perf-row" role="row" key={`${row.net}-${row.name}`}>
                  <div className="perf-row__page" role="cell">
                    <NetBadge net={row.net} size="sm" />
                    <span className="perf-row__name">{row.name}</span>
                  </div>
                  <span className="perf-row__num perf-row__comments" role="cell">
                    {row.comments}
                    <i className="trend-mark" data-down={!healthy} aria-hidden="true">
                      ▲
                    </i>
                  </span>
                  <span
                    className={cx("perf-row__num", row.firstReplySeconds >= SLOW_REPLY_SECONDS ? "perf-row__num--slow" : "perf-row__num--ok")}
                    role="cell"
                  >
                    {formatDuration(row.firstReplySeconds)}
                  </span>
                  <span className="perf-row__num" role="cell">
                    {row.aiShare}
                  </span>
                  <div className="sent-cell" role="cell">
                    <div className="sent-cell__track">
                      <div className="sent-cell__fill" style={{ width: `${row.sentiment}%` }} />
                    </div>
                    <b>{row.sentiment}</b>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && <div className="empty">No page matches these filters.</div>}
          </div>
        </div>

        <div className="card card--pad rise" style={delay(100)}>
          <div className="card__title">Peak activity</div>
          <div className="card__sub">Comments per hour, weekly average</div>
          <div className="hours">
            {HOURLY_VOLUME.map((volume, i) => (
              <div
                key={i}
                className="hours__bar"
                style={{ height: Math.round(volume * 0.95), "--bar": hourColor(volume), ...delay(i * 40) } as CSSProperties}
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
            Coverage gap detected between 21h and 23h — 2 managers scheduled for 640 comments/h.
          </div>
        </div>
      </div>
    </div>
  );
}

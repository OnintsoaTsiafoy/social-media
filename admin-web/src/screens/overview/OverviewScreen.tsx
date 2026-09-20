import { useEffect, useMemo } from "react";

import type { Overview } from "@/api/types";
import { ChevronDownIcon } from "@/components/icons";
import { NetBadge } from "@/components/Network";
import { ScreenState } from "@/components/shell/ScreenState";
import { PERIODS, SEVERITY_TONE } from "@/domain/overview";
import { useI18n } from "@/i18n";
import { sparkPoints } from "@/lib/chart";
import { columns, cx, delay } from "@/lib/css";
import { signedDelta, NO_DELTA, type Delta } from "@/lib/delta";
import { useCountUp } from "@/lib/motion";
import { downloadCsv, buildReportCsv, reportFileName } from "@/lib/report";
import { useAdmin } from "@/state/AdminContext";
import { useOverview } from "@/state/useOverview";
import { hrefFor } from "@/state/useRoute";
import { initialsOf } from "@/i18n/format";

import { LiveHero } from "./LiveHero";
import { SentimentSplit, SystemHealth } from "./SideCards";
import { VolumeChart } from "./VolumeChart";
import "./overview.css";

interface KpiView {
  id: string;
  label: string;
  value: string;
  delta: Delta;
  spark: Array<number | null>;
  foot: string;
}

export function OverviewScreen() {
  const { t, format } = useI18n();
  const { period, setPeriod, say } = useAdmin();
  const { overview, live, resolving, resolveEscalation } = useOverview();
  const [progress, replay] = useCountUp();
  const today = useMemo(() => new Date(), []);
  const data = overview.data;

  // Les chiffres repartent de zéro quand on change de période ou de réseau (pas à chaque rafraîchissement).
  const dataKey = data ? `${data.period}:${data.network}` : null;
  useEffect(() => {
    if (dataKey) replay(900);
  }, [dataKey, replay]);

  const cycleRange = () => setPeriod(PERIODS[(PERIODS.indexOf(period) + 1) % PERIODS.length] ?? PERIODS[0] ?? "7d");

  const exportReport = () => {
    if (!data) return;
    const file = reportFileName(t);
    downloadCsv(file, buildReportCsv(data, t, format));
    say(t("overview.exported", { file }));
  };

  return (
    <ScreenState ready={data !== null} loading={overview.loading} error={overview.error} onRetry={overview.reload}>
      {data && (
        <div className="screen">
          <div className="page-head">
            <div>
              <h1 className="page-head__title">{t("screen.overview")}</h1>
              <p className="page-head__sub">
                {t("overview.subtitle", { date: format.longDate(today), count: data.pages.all })}
              </p>
            </div>
            <div className="page-head__actions">
              <button
                type="button"
                className={cx("btn", "btn--outline", "btn--select")}
                aria-label={t("overview.range.aria", { range: t(`overview.range.${period}`) })}
                onClick={cycleRange}
              >
                {t(`overview.range.${period}`)}
                <ChevronDownIcon />
              </button>
              <button type="button" className={cx("btn", "btn--outline")} onClick={exportReport}>
                {t("overview.export")}
              </button>
            </div>
          </div>

          <LiveHero live={live.data} pages={data.pages} />

          <div className="grid-auto" style={columns(215)}>
            {kpiViews(data, progress, t, format).map((kpi) => (
              <div className="kpi" key={kpi.id}>
                <div className="kpi__head">
                  <span className="kpi__label">{kpi.label}</span>
                  <span className="kpi__delta" data-tone={kpi.delta.tone}>
                    {kpi.delta.text}
                  </span>
                </div>
                <div className="kpi__value">{kpi.value}</div>
                <svg className="kpi__spark" data-tone={kpi.delta.tone} viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true">
                  <polyline points={sparkPoints(kpi.spark)} />
                </svg>
                <div className="kpi__foot">{kpi.foot}</div>
              </div>
            ))}
          </div>

          <div className="grid-auto grid-auto--top">
            <VolumeChart daily={data.daily} progress={progress} />
            <div className="stack">
              <SentimentSplit split={data.sentiment} />
              <SystemHealth health={data.health} />
            </div>
          </div>

          <div className="grid-auto grid-auto--top">
            <div className="card card--flush span-2 rise" style={delay(220)}>
              <div className="card__head">
                <div>
                  <div className="card__title">{t("escalations.title")}</div>
                  <div className="card__sub">{t("escalations.subtitle")}</div>
                </div>
                <a className="link-btn" href={hrefFor("supervision")}>
                  {t("escalations.open")}
                </a>
              </div>
              {data.escalations.map((escalation) => (
                <div className="esc-row" key={escalation.id}>
                  <NetBadge net={escalation.network} />
                  <div className="esc-row__body">
                    <div className="esc-row__text">{escalation.text}</div>
                    <div className="esc-row__meta">
                      {escalation.raisedBy
                        ? t("escalations.meta", {
                            page: escalation.page,
                            by: escalation.raisedBy,
                            ago: format.relative(new Date(escalation.raisedAt)),
                          })
                        : t("escalations.metaAnonymous", {
                            page: escalation.page,
                            ago: format.relative(new Date(escalation.raisedAt)),
                          })}
                    </div>
                  </div>
                  <span className="chip" data-tone={SEVERITY_TONE[escalation.severity]}>
                    {t(`severity.${escalation.severity}`)}
                  </span>
                  <button
                    type="button"
                    className="esc-row__take"
                    disabled={resolving === escalation.id}
                    onClick={() => void resolveEscalation(escalation)}
                  >
                    {t("escalations.resolve")}
                  </button>
                </div>
              ))}
              {data.escalations.length === 0 && (
                <div className="empty">{t(data.network === "all" ? "escalations.empty" : "escalations.emptyNetwork")}</div>
              )}
            </div>

            <div className="card card--pad rise" style={delay(260)}>
              <div className="card__title">{t("leaders.title")}</div>
              <div className="card__sub">{t("leaders.subtitle")}</div>
              <div className="leaders">
                {data.leaderboard.map((leader) => (
                  <div className="leader" key={leader.userId}>
                    <div className="leader__avatar">{initialsOf(leader.name)}</div>
                    <div className="leader__body">
                      <div className="leader__name">{leader.name}</div>
                      <div className="leader__track">
                        <div
                          className="leader__fill"
                          style={{ width: `${Math.round((leader.replies / (data.leaderboard[0]?.replies || 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <b className="leader__count">{format.int(leader.replies)}</b>
                  </div>
                ))}
                {data.leaderboard.length === 0 && <div className="empty">{t("leaders.empty")}</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </ScreenState>
  );
}

/** Les quatre indicateurs, prêts à afficher (valeur animée par `progress`, « Non disponible » sans donnée). */
function kpiViews(
  data: Overview,
  progress: number,
  t: ReturnType<typeof useI18n>["t"],
  format: ReturnType<typeof useI18n>["format"],
): KpiView[] {
  const { processed, firstResponse, aiResolved, escalations } = data.kpis;
  const unavailable = t("common.unavailable");

  return [
    {
      id: "processed",
      label: t("kpi.processed.label"),
      value: format.int(processed.value * progress),
      delta: signedDelta(processed.deltaPercent, "percent", "up", format),
      spark: processed.spark,
      foot: processed.previous > 0 ? t("kpi.processed.foot", { previous: processed.previous }) : t("kpi.processed.footNone"),
    },
    {
      id: "first-response",
      label: t("kpi.firstResponse.label"),
      value: firstResponse.medianSeconds === null ? unavailable : format.duration(firstResponse.medianSeconds * progress),
      delta: signedDelta(firstResponse.deltaPercent, "percent", "down", format),
      spark: firstResponse.spark,
      foot: t("kpi.firstResponse.foot", { minutes: firstResponse.targetMinutes }),
    },
    {
      id: "ai-resolved",
      label: t("kpi.aiResolved.label"),
      value: aiResolved.rate === null ? unavailable : format.percent(aiResolved.rate * progress, 1),
      delta: signedDelta(aiResolved.deltaPoints, "percent", "up", format),
      spark: aiResolved.spark,
      foot:
        aiResolved.totalReplies > 0
          ? t("kpi.aiResolved.foot", { count: aiResolved.sentByAi, total: aiResolved.totalReplies })
          : t("kpi.aiResolved.footNone"),
    },
    {
      id: "escalations",
      label: t("kpi.escalations.label"),
      value: format.int(escalations.open * progress),
      delta: escalations.raised === 0 && escalations.raisedPrevious === 0 ? NO_DELTA : signedDelta(escalations.raised - escalations.raisedPrevious, "count", "down", format),
      spark: escalations.spark,
      foot:
        escalations.olderThanTwoHours > 0
          ? t("kpi.escalations.foot", { count: escalations.olderThanTwoHours })
          : t("kpi.escalations.footNone"),
    },
  ];
}

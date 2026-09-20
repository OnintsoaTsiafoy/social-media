import { useMemo } from "react";

import { ChevronDownIcon } from "@/components/icons";
import { NetBadge } from "@/components/Network";
import { ESCALATIONS, KPIS, LEADERS, NETWORK_PAGE_COUNTS, RANGES, SEVERITY_TONE } from "@/data/overview";
import { columns, cx, delay } from "@/lib/css";
import { formatLongDate } from "@/lib/format";
import { useCountUp } from "@/lib/motion";
import { matchesNet } from "@/lib/network";
import { sparkPoints } from "@/lib/chart";
import { useAdmin } from "@/state/AdminContext";
import { hrefFor } from "@/state/useRoute";

import { LiveHero } from "./LiveHero";
import { SentimentSplit, SystemHealth } from "./SideCards";
import { VolumeChart } from "./VolumeChart";
import "./overview.css";

export function OverviewScreen() {
  const { net, range, setRange, say } = useAdmin();
  const [progress, replay] = useCountUp();
  const today = useMemo(() => new Date(), []);

  const cycleRange = () => {
    const next = RANGES[(RANGES.indexOf(range) + 1) % RANGES.length] ?? RANGES[0];
    setRange(next);
    replay(900);
  };

  const escalations = ESCALATIONS.filter((escalation) => matchesNet(net, escalation.net));
  const topReplies = Math.max(...LEADERS.map((leader) => leader.replies));

  return (
    <div className="screen">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Platform overview</h1>
          <p className="page-head__sub">
            {formatLongDate(today)} · live across {NETWORK_PAGE_COUNTS.all} connected pages
          </p>
        </div>
        <div className="page-head__actions">
          <button
            type="button"
            className={cx("btn", "btn--outline", "btn--select")}
            aria-label={`Date range: ${range}. Activate to change.`}
            onClick={cycleRange}
          >
            {range}
            <ChevronDownIcon />
          </button>
          <button
            type="button"
            className={cx("btn", "btn--outline")}
            onClick={() => say("Report queued · you will receive it by email")}
          >
            Export report
          </button>
          <button
            type="button"
            className={cx("btn", "btn--primary")}
            onClick={() => say("Invitation link copied to clipboard")}
          >
            Invite manager
          </button>
        </div>
      </div>

      <LiveHero />

      <div className="grid-auto" style={columns(215)}>
        {KPIS.map((kpi) => (
          <div className="kpi" key={kpi.id}>
            <div className="kpi__head">
              <span className="kpi__label">{kpi.label}</span>
              <span className="kpi__delta" data-tone={kpi.tone}>
                {kpi.delta}
              </span>
            </div>
            <div className="kpi__value">{kpi.value(progress)}</div>
            <svg className="kpi__spark" data-tone={kpi.tone} viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true">
              <polyline points={sparkPoints(kpi.spark)} />
            </svg>
            <div className="kpi__foot">{kpi.foot}</div>
          </div>
        ))}
      </div>

      <div className="grid-auto grid-auto--top">
        <VolumeChart progress={progress} />
        <div className="stack">
          <SentimentSplit />
          <SystemHealth />
        </div>
      </div>

      <div className="grid-auto grid-auto--top">
        <div className="card card--flush span-2 rise" style={delay(220)}>
          <div className="card__head">
            <div>
              <div className="card__title">Escalations needing an admin</div>
              <div className="card__sub">Raised from the mobile app by community managers</div>
            </div>
            <a className="link-btn" href={hrefFor("supervision")}>
              Open supervision →
            </a>
          </div>
          {escalations.map((escalation) => (
            <div className="esc-row" key={escalation.text}>
              <NetBadge net={escalation.net} />
              <div className="esc-row__body">
                <div className="esc-row__text">{escalation.text}</div>
                <div className="esc-row__meta">
                  {escalation.page} · raised by {escalation.by} · {escalation.ago}
                </div>
              </div>
              <span className="chip" data-tone={SEVERITY_TONE[escalation.severity]}>
                {escalation.severity}
              </span>
              <button
                type="button"
                className="esc-row__take"
                onClick={() => say(`Escalation assigned to you · ${escalation.page}`)}
              >
                Take over
              </button>
            </div>
          ))}
          {escalations.length === 0 && <div className="empty">No escalation on this network.</div>}
        </div>

        <div className="card card--pad rise" style={delay(260)}>
          <div className="card__title">Manager leaderboard</div>
          <div className="card__sub">Replies handled this week</div>
          <div className="leaders">
            {LEADERS.map((leader) => (
              <div className="leader" key={leader.name}>
                <div className="leader__avatar">{leader.initials}</div>
                <div className="leader__body">
                  <div className="leader__name">{leader.name}</div>
                  <div className="leader__track">
                    <div className="leader__fill" style={{ width: `${Math.round((leader.replies / topReplies) * 100)}%` }} />
                  </div>
                </div>
                <b className="leader__count">{leader.replies}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

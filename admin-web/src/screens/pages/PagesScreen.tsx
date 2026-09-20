import { NetBadge } from "@/components/Network";
import { Toggle } from "@/components/Toggle";
import { BACKLOG_CRITICAL, BACKLOG_WARNING, CONNECTED_PAGES, PAGE_STATUS_TONE } from "@/data/pages";
import { cx } from "@/lib/css";
import { formatInt } from "@/lib/format";
import { useAdmin } from "@/state/AdminContext";
import type { Tone } from "@/types";

import "./pages.css";

const backlogTone = (backlog: number): Tone | undefined =>
  backlog > BACKLOG_CRITICAL ? "danger" : backlog > BACKLOG_WARNING ? "warning" : undefined;

export function PagesScreen() {
  const { pages, say } = useAdmin();
  const connect = () => say("Opening Meta Business Manager…");

  return (
    <div className="screen">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Connected pages</h1>
          <p className="page-head__sub">Tokens, assignments and automation per page</p>
        </div>
        <button type="button" className={cx("btn", "btn--dark")} onClick={connect}>
          Connect a page
        </button>
      </div>

      <div className="pg-grid">
        {CONNECTED_PAGES.map((page) => {
          const statusTone = PAGE_STATUS_TONE[page.status];
          return (
            <article className="pg-card" key={page.id}>
              <div className="pg-card__head">
                <NetBadge net={page.net} size="tile" />
                <div className="pg-card__id">
                  <div className="pg-card__name">{page.name}</div>
                  <div className="pg-card__handle">
                    {page.handle} · {page.followers} followers
                  </div>
                </div>
                <span className="chip" data-tone={statusTone}>
                  {page.status}
                </span>
              </div>

              <div className="pg-stats">
                <div className="pg-stat">
                  <div className="pg-stat__label">Comments 24h</div>
                  <div className="pg-stat__value">{formatInt(page.comments24h)}</div>
                </div>
                <div className="pg-stat">
                  <div className="pg-stat__label">Backlog</div>
                  <div className="pg-stat__value" data-tone={backlogTone(page.backlog)}>
                    {page.backlog}
                  </div>
                </div>
              </div>

              <div className="pg-card__foot">
                <div className="team">
                  {page.team.map((initials) => (
                    <div className="team__avatar" key={initials}>
                      {initials}
                    </div>
                  ))}
                  <span className="team__label">{page.teamLabel}</span>
                </div>
                <Toggle
                  checked={Boolean(pages.autoReply[page.id])}
                  label={`Auto-reply on ${page.name} (${page.net === "FB" ? "Facebook" : "Instagram"})`}
                  onChange={() => pages.toggleAutoReply(page.id)}
                />
              </div>

              <div className="pg-card__token" data-tone={page.status === "Healthy" ? undefined : statusTone}>
                {page.token}
              </div>
            </article>
          );
        })}

        <button type="button" className="pg-add" onClick={connect}>
          <span className="pg-add__plus" aria-hidden="true">
            +
          </span>
          <span className="pg-add__title">Connect a page</span>
          <span className="pg-add__text">Facebook or Instagram business account</span>
        </button>
      </div>
    </div>
  );
}

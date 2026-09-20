import { NetBadge } from "@/components/Network";
import { ScreenState } from "@/components/shell/ScreenState";
import { Toggle } from "@/components/Toggle";
import { BACKLOG_CRITICAL, BACKLOG_WARNING, describeToken, PAGE_STATUS_TONE } from "@/domain/pages";
import { useI18n } from "@/i18n";
import { NET_NAME } from "@/lib/network";
import { usePages } from "@/state/usePages";
import type { Tone } from "@/types";

import "./pages.css";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const backlogTone = (backlog: number): Tone | undefined =>
  backlog > BACKLOG_CRITICAL ? "danger" : backlog > BACKLOG_WARNING ? "warning" : undefined;

export function PagesScreen() {
  const { t, format } = useI18n();
  const { resource, toggleAutoReply } = usePages();
  const data = resource.data;

  return (
    <ScreenState ready={data !== null} loading={resource.loading} error={resource.error} onRetry={resource.reload}>
      {data && (
        <div className="screen">
          <div className="page-head">
            <div>
              <h1 className="page-head__title">{t("screen.pages")}</h1>
              <p className="page-head__sub">{t("pages.subtitle")}</p>
            </div>
          </div>

          <div className="pg-grid">
            {data.items.map((page) => {
              const statusTone = PAGE_STATUS_TONE[page.status];
              return (
                <article className="pg-card" key={page.id}>
                  <div className="pg-card__head">
                    <NetBadge net={page.network} size="tile" />
                    <div className="pg-card__id">
                      <div className="pg-card__name">{page.name}</div>
                      <div className="pg-card__handle">
                        {page.handle ? `${page.handle} · ` : ""}
                        {page.followers === null
                          ? page.handle
                            ? t("pages.followers.unknown")
                            : capitalize(t("pages.followers.unknown"))
                          : t("pages.followers", { count: format.int(page.followers) })}
                      </div>
                    </div>
                    <span className="chip" data-tone={statusTone}>
                      {t(`pages.status.${page.status}`)}
                    </span>
                  </div>

                  <div className="pg-stats">
                    <div className="pg-stat">
                      <div className="pg-stat__label">{t("pages.comments24h")}</div>
                      <div className="pg-stat__value">{format.int(page.comments24h)}</div>
                    </div>
                    <div className="pg-stat">
                      <div className="pg-stat__label">{t("pages.backlog")}</div>
                      <div className="pg-stat__value" data-tone={backlogTone(page.backlog)}>
                        {format.int(page.backlog)}
                      </div>
                    </div>
                  </div>

                  <div className="pg-card__foot">
                    <div className="team">
                      {page.team.map((member) => (
                        <div className="team__avatar" key={member.id} title={member.name}>
                          {member.initials}
                        </div>
                      ))}
                      <span className="team__label">
                        {page.teamCount > 0 ? t("pages.team", { count: page.teamCount }) : t("pages.team.none")}
                      </span>
                    </div>
                    <Toggle
                      checked={page.autoReply}
                      label={t("pages.autoReply", { name: page.name, network: t(NET_NAME[page.network]) })}
                      onChange={() => void toggleAutoReply(page)}
                    />
                  </div>

                  <div className="pg-card__brand">{t("pages.brand", { name: page.brand.name })}</div>
                  <div className="pg-card__token" data-tone={page.status === "healthy" ? undefined : statusTone}>
                    {describeToken(page.token, t, format)}
                  </div>
                </article>
              );
            })}
          </div>

          {data.items.length === 0 ? <div className="empty">{t("pages.empty")}</div> : <p className="pg-hint">{t("pages.hint")}</p>}
        </div>
      )}
    </ScreenState>
  );
}

import { useState } from "react";

import type { PageLinkResult } from "@/api/types";
import { NetBadge } from "@/components/Network";
import { ScreenState } from "@/components/shell/ScreenState";
import { Toggle } from "@/components/Toggle";
import { BACKLOG_CRITICAL, BACKLOG_WARNING, describePostsSync, describeToken, PAGE_STATUS_TONE } from "@/domain/pages";
import { useI18n, type MessageKey } from "@/i18n";
import { cx } from "@/lib/css";
import { NET_NAME } from "@/lib/network";
import { useAdmin } from "@/state/AdminContext";
import { useOAuthReturn } from "@/state/usePageConnection";
import { usePages } from "@/state/usePages";
import type { Tone } from "@/types";

import { ConnectPageDialog } from "./ConnectPageDialog";
import { SelectPagesDialog } from "./SelectPagesDialog";
import "./pages.css";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const backlogTone = (backlog: number): Tone | undefined =>
  backlog > BACKLOG_CRITICAL ? "danger" : backlog > BACKLOG_WARNING ? "warning" : undefined;

export function PagesScreen() {
  const { t, format } = useI18n();
  const { say, summary } = useAdmin();
  const { resource, toggleAutoReply, syncPage, syncing } = usePages();
  const data = resource.data;

  // Retour de Facebook : soit les pages à choisir, soit la raison de l'échec.
  const returned = useOAuthReturn();
  const [connecting, setConnecting] = useState(false);
  const [selectionId, setSelectionId] = useState<string | null>(returned?.kind === "select" ? returned.selectionId : null);
  const [failure, setFailure] = useState<string | null>(returned?.kind === "error" ? returned.reason : null);

  const linked = (result: PageLinkResult) => {
    setSelectionId(null);
    say(t("pages.connect.linked", { count: result.accounts.length, brand: result.brand.name }));
    resource.reload();
    summary.reload();
  };

  return (
    <ScreenState ready={data !== null} loading={resource.loading} error={resource.error} onRetry={resource.reload}>
      {data && (
        <div className="screen">
          <div className="page-head">
            <div>
              <h1 className="page-head__title">{t("screen.pages")}</h1>
              <p className="page-head__sub">{t("pages.subtitle")}</p>
            </div>
            <button type="button" className={cx("btn", "btn--dark")} onClick={() => setConnecting(true)}>
              {t("pages.connect.button")}
            </button>
          </div>

          {failure && (
            <div className="pg-banner" role="alert">
              <span>{t(`pages.connect.error.${failure}` as MessageKey)}</span>
              <button type="button" className="pg-banner__close" onClick={() => setFailure(null)} aria-label={t("common.close")}>
                ×
              </button>
            </div>
          )}

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

                  <div className="pg-card__brand">
                    {t("pages.brand", { name: page.brand.name })}
                    {page.connectedBy && ` · ${t("pages.connectedBy", { name: page.connectedBy.name })}`}
                  </div>
                  <div className="pg-card__token" data-tone={page.status === "healthy" ? undefined : statusTone}>
                    {describeToken(page.token, t, format)}
                  </div>
                  {/* Instagram : pas encore d'import de son fil (graph-api le refuse). */}
                  {page.network === "facebook" && (
                    <div className="pg-card__sync">
                      <span className="pg-card__sync-text">{describePostsSync(page, t, format)}</span>
                      <button
                        type="button"
                        className={cx("btn", "btn--outline", "btn--sm")}
                        // Une page à reconnecter n'est pas synchronisable : le serveur répondrait 409.
                        disabled={syncing.has(page.id) || page.status === "action_required"}
                        aria-label={t("pages.sync.aria", { name: page.name })}
                        onClick={() => void syncPage(page)}
                      >
                        {t("pages.sync.button")}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}

            <button type="button" className="pg-add" onClick={() => setConnecting(true)}>
              <span className="pg-add__plus" aria-hidden="true">
                +
              </span>
              <span className="pg-add__title">{t("pages.connect.tile.title")}</span>
              <span className="pg-add__text">{t("pages.connect.tile.text")}</span>
            </button>
          </div>

          {data.items.length === 0 ? <div className="empty">{t("pages.empty")}</div> : <p className="pg-hint">{t("pages.hint")}</p>}

          {connecting && <ConnectPageDialog onClose={() => setConnecting(false)} />}
          {selectionId && <SelectPagesDialog selectionId={selectionId} onClose={() => setSelectionId(null)} onLinked={linked} />}
        </div>
      )}
    </ScreenState>
  );
}

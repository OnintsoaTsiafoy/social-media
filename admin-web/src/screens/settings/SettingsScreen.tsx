import type { FormEvent } from "react";

import { ErrorState } from "@/components/ErrorState";
import { ScreenState } from "@/components/shell/ScreenState";
import { AUDIT_KIND_LABEL, AUDIT_TONE, describeAudit, SLA_DEFS } from "@/domain/configuration";
import { useI18n } from "@/i18n";
import { columns, cx, delay } from "@/lib/css";
import { useConfiguration } from "@/state/useConfiguration";

import "./settings.css";

export function SettingsScreen() {
  const { t, format } = useI18n();
  const config = useConfiguration();
  const { settings, audit } = config;
  const data = settings.data;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void config.addKeyword();
  };

  return (
    <ScreenState ready={data !== null} loading={settings.loading} error={settings.error} onRetry={settings.reload}>
      {data && (
        <div className="screen">
          <div className="page-head">
            <div>
              <h1 className="page-head__title">{t("screen.configuration")}</h1>
              <p className="page-head__sub">{t("config.subtitle")}</p>
            </div>
          </div>

          <div className="grid-auto grid-auto--top" style={columns(300)}>
            <section className="card card--pad rise">
              <div className="card__title">{t("keywords.title")}</div>
              <div className="card__sub">{t("keywords.subtitle")}</div>
              {data.keywords.length > 0 ? (
                <ul className="kw-list">
                  {data.keywords.map((word) => (
                    <li className="kw" key={word}>
                      <span>{word}</span>
                      <button
                        type="button"
                        className="kw__remove"
                        aria-label={t("keywords.remove", { word })}
                        onClick={() => void config.removeKeyword(word)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="kw-empty">{t("keywords.empty")}</p>
              )}
              <form className="kw-add" onSubmit={submit}>
                <input
                  type="text"
                  value={config.draftKeyword}
                  maxLength={40}
                  placeholder={t("keywords.placeholder")}
                  aria-label={t("keywords.new.aria")}
                  onChange={(event) => config.setDraftKeyword(event.target.value)}
                />
                <button type="submit" className={cx("btn", "btn--dark")}>
                  {t("keywords.add")}
                </button>
              </form>
            </section>

            <section className="card card--pad rise" style={delay(60)}>
              <div className="card__title">{t("sla.title")}</div>
              <div className="sla-list">
                {SLA_DEFS.map((sla) => (
                  <div className="sla-row" key={sla.key}>
                    <div className="sla-row__body">
                      <div className="sla-row__label">{t(sla.label)}</div>
                      <div className="sla-row__desc">{t(sla.description)}</div>
                    </div>
                    <div className="stepper">
                      <button
                        type="button"
                        aria-label={t("sla.decrease", { label: t(sla.label) })}
                        onClick={() => config.stepServiceLevel(sla.key, -1)}
                      >
                        −
                      </button>
                      <b>{t("sla.minutes", { count: data.serviceLevels[sla.key] })}</b>
                      <button
                        type="button"
                        aria-label={t("sla.increase", { label: t(sla.label) })}
                        onClick={() => config.stepServiceLevel(sla.key, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="card card--flush rise" style={delay(100)}>
            <div className="card__head">
              <div className="card__title">{t("audit.title")}</div>
              {audit.total > 0 && <span className="retention">{t("audit.count", { count: audit.total })}</span>}
            </div>
            {config.auditResource.error && audit.items.length === 0 ? (
              <ErrorState error={config.auditResource.error} onRetry={config.auditResource.reload} inline />
            ) : (
              audit.items.map((entry) => (
                <div className="audit-row" key={entry.id}>
                  <span className="audit-row__time">{format.dateTime(new Date(entry.at))}</span>
                  {entry.kind && (
                    <span className="chip" data-tone={AUDIT_TONE[entry.kind]}>
                      {t(AUDIT_KIND_LABEL[entry.kind])}
                    </span>
                  )}
                  <span className="audit-row__text">{describeAudit(entry, t)}</span>
                  <span className="audit-row__who">{entry.actor?.name ?? t("audit.system")}</span>
                </div>
              ))
            )}
            {!config.auditResource.loading && !config.auditResource.error && audit.items.length === 0 && (
              <div className="empty">{t("audit.empty")}</div>
            )}
            {audit.items.length < audit.total && (
              <div className="audit-more">
                <button
                  type="button"
                  className={cx("btn", "btn--outline", "btn--sm")}
                  disabled={config.auditLoadingMore}
                  onClick={() => void config.loadMoreAudit()}
                >
                  {t("audit.more")}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </ScreenState>
  );
}

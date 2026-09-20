import type { FormEvent } from "react";

import { AUDIT_TONE, AUDIT_TRAIL, SLA_DEFS } from "@/data/settings";
import { columns, cx, delay } from "@/lib/css";
import { useAdmin } from "@/state/AdminContext";

import "./settings.css";

export function SettingsScreen() {
  const { settings } = useAdmin();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    settings.addKeyword();
  };

  return (
    <div className="screen">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Configuration</h1>
          <p className="page-head__sub">Workspace rules, moderation filters and audit trail</p>
        </div>
      </div>

      <div className="grid-auto grid-auto--top" style={columns(300)}>
        <section className="card card--pad rise">
          <div className="card__title">Moderation keywords</div>
          <div className="card__sub">Comments containing these are hidden and escalated automatically.</div>
          <ul className="kw-list">
            {settings.keywords.map((word) => (
              <li className="kw" key={word}>
                <span>{word}</span>
                <button
                  type="button"
                  className="kw__remove"
                  aria-label={`Remove keyword ${word}`}
                  onClick={() => settings.removeKeyword(word)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <form className="kw-add" onSubmit={submit}>
            <input
              type="text"
              value={settings.draftKeyword}
              placeholder="Add a keyword…"
              aria-label="New moderation keyword"
              onChange={(event) => settings.setDraftKeyword(event.target.value)}
            />
            <button type="submit" className={cx("btn", "btn--dark")}>
              Add
            </button>
          </form>
        </section>

        <section className="card card--pad rise" style={delay(60)}>
          <div className="card__title">Service levels</div>
          <div className="sla-list">
            {SLA_DEFS.map((sla) => (
              <div className="sla-row" key={sla.key}>
                <div className="sla-row__body">
                  <div className="sla-row__label">{sla.label}</div>
                  <div className="sla-row__desc">{sla.description}</div>
                </div>
                <div className="stepper">
                  <button type="button" aria-label={`Decrease ${sla.label}`} onClick={() => settings.stepSla(sla.key, -1)}>
                    −
                  </button>
                  <b>{settings.sla[sla.key]} min</b>
                  <button type="button" aria-label={`Increase ${sla.label}`} onClick={() => settings.stepSla(sla.key, 1)}>
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
          <div className="card__title">Audit trail</div>
          <span className="retention">RETENTION · 180 DAYS</span>
        </div>
        {AUDIT_TRAIL.map((entry) => (
          <div className="audit-row" key={`${entry.time}-${entry.text}`}>
            <span className="audit-row__time">{entry.time}</span>
            <span className="chip" data-tone={AUDIT_TONE[entry.kind]}>
              {entry.kind}
            </span>
            <span className="audit-row__text">{entry.text}</span>
            <span className="audit-row__who">{entry.who}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

import type { Supervision } from "@/api/types";
import { ScreenState } from "@/components/shell/ScreenState";
import { Toggle } from "@/components/Toggle";
import { useI18n } from "@/i18n";
import { columns, delay } from "@/lib/css";
import { useSupervision } from "@/state/useSupervision";

import { AutonomyPanel } from "./AutonomyPanel";
import { QueueCard } from "./QueueCard";
import "./supervision.css";

export function SupervisionScreen() {
  const { t, format } = useI18n();
  const supervision = useSupervision();
  const { resource } = supervision;
  const data = resource.data;

  return (
    <ScreenState ready={data !== null} loading={resource.loading} error={resource.error} onRetry={resource.reload}>
      {data && (
        <div className="screen">
          <div className="page-head">
            <div>
              <h1 className="page-head__title">{t("screen.supervision")}</h1>
              <p className="page-head__sub">{t("supervision.subtitle")}</p>
            </div>
            <div className="auto-toggle">
              <span className="auto-toggle__label">{t("supervision.autoReply")}</span>
              <Toggle
                size="lg"
                checked={data.settings.autoReply}
                label={t("supervision.autoReply")}
                onChange={supervision.toggleAutoReply}
              />
              <span className="auto-toggle__state">
                {t(data.settings.autoReply ? "supervision.autoReply.on" : "supervision.autoReply.paused")}
              </span>
            </div>
          </div>

          <div className="grid-auto grid-auto--top" style={columns(300)}>
            <div className="stack span-2">
              <PipelineCard pipeline={data.pipeline} />

              <div className="ai-status" role="status">
                <svg className="ai-status__spinner" width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
                  <circle cx="17" cy="17" r="14" fill="none" stroke="#F4F5F6" strokeWidth="3" />
                  <circle
                    cx="17"
                    cy="17"
                    r="14"
                    fill="none"
                    stroke="#C4F04A"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray="26 62"
                  />
                </svg>
                <div className="ai-status__body">
                  <div className="ai-status__line">
                    {t(data.analysis.waiting > 0 ? "aiStatus.working" : "aiStatus.idle")}
                    {data.analysis.waiting > 0 && (
                      <span className="dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </div>
                </div>
                {data.analysis.waiting > 0 && (
                  <span className="ai-status__count">{t("aiStatus.count", { count: data.analysis.waiting })}</span>
                )}
              </div>

              {data.queue.items.map((item) => (
                <QueueCard
                  key={item.id}
                  item={item}
                  threshold={data.settings.threshold}
                  sending={Boolean(supervision.sending[item.id])}
                  askingReason={supervision.feedbackFor === item.id}
                  editText={supervision.editing[item.id] ?? null}
                  onApprove={() => void supervision.approve(item)}
                  onEdit={() => supervision.startEdit(item)}
                  onEditChange={(text) => supervision.changeEdit(item.id, text)}
                  onEditCancel={() => supervision.cancelEdit(item.id)}
                  onReject={() => supervision.askRejectReason(item.id)}
                  onPickReason={(reason) => void supervision.reject(item.id, reason)}
                  onEscalate={() => void supervision.escalate(item.id)}
                />
              ))}

              {data.queue.items.length === 0 && (
                <div className="q-empty">
                  <div className="q-empty__icon" />
                  <div className="q-empty__title">{t("queue.empty.title")}</div>
                  <div className="q-empty__text">{t("queue.empty.text")}</div>
                </div>
              )}

              {data.queue.total > data.queue.items.length && (
                <p className="q-more">
                  {t("queue.truncated", { shown: format.int(data.queue.items.length), total: format.int(data.queue.total) })}
                </p>
              )}
            </div>

            <AutonomyPanel
              settings={data.settings}
              distribution={data.confidenceDistribution}
              performance={data.performance}
              onThreshold={supervision.setThreshold}
              onRule={supervision.toggleRule}
            />
          </div>
        </div>
      )}
    </ScreenState>
  );
}

function PipelineCard({ pipeline }: { pipeline: Supervision["pipeline"] }) {
  const { t, format } = useI18n();
  const steps = [
    { id: "detected", label: t("pipeline.detected"), value: pipeline.detected, active: false },
    { id: "drafted", label: t("pipeline.drafted"), value: pipeline.drafted, active: false },
    { id: "review", label: t("pipeline.review"), value: pipeline.inReview, active: true },
    { id: "published", label: t("pipeline.published"), value: pipeline.published, active: false },
  ];
  const widest = Math.max(1, ...steps.map((step) => step.value));

  return (
    <section className="card rise" style={{ padding: "18px 20px", ...delay(0) }}>
      <div className="pipeline__head">
        <div className="pipeline__title">{t("pipeline.title")}</div>
        <span className="pipeline__span">{t("pipeline.span")}</span>
      </div>
      <ol className="pipeline__steps">
        {steps.map((step, i) => (
          <li className="step" key={step.id} data-active={step.active}>
            <div className="step__track">
              <div className="step__dot">{i + 1}</div>
              <div className="step__line">
                <div className="step__fill" style={{ width: `${Math.round((step.value / widest) * 100)}%`, ...delay(i * 110) }} />
              </div>
            </div>
            <div>
              <div className="step__label">{step.label}</div>
              <div className="step__value">{format.int(step.value)}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

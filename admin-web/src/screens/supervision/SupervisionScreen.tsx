import { Toggle } from "@/components/Toggle";
import { AI_STATUSES, PIPELINE } from "@/data/supervision";
import { columns, delay } from "@/lib/css";
import { useAdmin } from "@/state/AdminContext";

import { AutonomyPanel } from "./AutonomyPanel";
import { QueueCard } from "./QueueCard";
import "./supervision.css";

export function SupervisionScreen() {
  const { supervision, ticker } = useAdmin();
  const { queue, threshold } = supervision;

  const status = AI_STATUSES[ticker.tick % AI_STATUSES.length];
  const analysing = 9 + (ticker.tick % 7);

  return (
    <div className="screen">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">AI supervision</h1>
          <p className="page-head__sub">Review what the assistant sends on behalf of your community managers</p>
        </div>
        <div className="auto-toggle">
          <span className="auto-toggle__label">Auto-reply</span>
          <Toggle
            size="lg"
            checked={supervision.autoReply}
            label="Auto-reply"
            onChange={supervision.toggleAutoReply}
          />
          <span className="auto-toggle__state">{supervision.autoReply ? "ON" : "PAUSED"}</span>
        </div>
      </div>

      <div className="grid-auto grid-auto--top" style={columns(300)}>
        <div className="stack span-2">
          <section className="card rise" style={{ padding: "18px 20px", ...delay(0) }}>
            <div className="pipeline__head">
              <div className="pipeline__title">Human-in-the-loop pipeline</div>
              <span className="pipeline__span">LAST 24 H</span>
            </div>
            <ol className="pipeline__steps">
              {PIPELINE.map((step, i) => (
                <li className="step" key={step.label} data-active={step.active}>
                  <div className="step__track">
                    <div className="step__dot">{i + 1}</div>
                    <div className="step__line">
                      <div className="step__fill" style={{ width: `${step.fill}%`, ...delay(i * 110) }} />
                    </div>
                  </div>
                  <div>
                    <div className="step__label">{step.label}</div>
                    <div className="step__value">{step.value ?? queue.length}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

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
                {status}
                <span className="dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
              <div className="ai-status__bars" aria-hidden="true">
                <div className="ai-status__bar" style={{ width: "78%" }} />
                <div className="ai-status__bar" style={{ width: "54%", animationDelay: "0.2s" }} />
              </div>
            </div>
            <span className="ai-status__count">{analysing} in queue</span>
          </div>

          {queue.map((item) => (
            <QueueCard
              key={item.id}
              item={item}
              threshold={threshold}
              sending={Boolean(supervision.sending[item.id])}
              askingReason={supervision.feedbackFor === item.id}
              onApprove={() => supervision.approve(item)}
              onEdit={supervision.editDraft}
              onReject={() => supervision.askRejectReason(item.id)}
              onPickReason={(reason) => supervision.reject(item.id, reason)}
              onEscalate={() => supervision.escalate(item.id)}
            />
          ))}

          {queue.length === 0 && (
            <div className="q-empty">
              <div className="q-empty__icon" />
              <div className="q-empty__title">Queue cleared</div>
              <div className="q-empty__text">
                Every AI draft has been reviewed. New items appear in real time.
              </div>
            </div>
          )}
        </div>

        <AutonomyPanel />
      </div>
    </div>
  );
}

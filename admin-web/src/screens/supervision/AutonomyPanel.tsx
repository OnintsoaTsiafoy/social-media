import { Toggle } from "@/components/Toggle";
import {
  describeThreshold,
  ESCALATION_RULES,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
} from "@/data/supervision";
import { delay } from "@/lib/css";
import { useAdmin } from "@/state/AdminContext";

/** Circumference of the ring (r = 62), rounded as in the design. */
const RING_LENGTH = 390;

export function AutonomyPanel() {
  const { supervision } = useAdmin();
  const { threshold, rules, taught } = supervision;
  const note = describeThreshold(threshold);

  return (
    <div className="stack">
      <div className="card card--pad rise" style={delay(80)}>
        <div className="card__title">Autonomy threshold</div>
        <div className="threshold__desc">Drafts above this confidence are sent without human review.</div>

        <div className="ring" aria-hidden="true">
          <div className="ring__glow" />
          <svg width="146" height="146" viewBox="0 0 146 146">
            <circle cx="73" cy="73" r="62" fill="none" stroke="#F4F5F6" strokeWidth="11" />
            <circle
              className="ring__progress"
              cx="73"
              cy="73"
              r="62"
              fill="none"
              stroke="#C4F04A"
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH - (threshold / 100) * RING_LENGTH}
            />
            <circle cx="73" cy="73" r="50" fill="none" stroke="#ECEDEF" strokeWidth="1" strokeDasharray="3 7" />
          </svg>
          <div className="ring__value">
            <div className="ring__number">
              {threshold}
              <span>%</span>
            </div>
            <div className="ring__label">AUTONOMY</div>
          </div>
        </div>

        <input
          className="slider"
          type="range"
          min={THRESHOLD_MIN}
          max={THRESHOLD_MAX}
          value={threshold}
          aria-label="Autonomy threshold"
          aria-valuetext={`${threshold} percent`}
          onChange={(event) => supervision.setThreshold(Number(event.target.value))}
        />
        <div className="slider-scale">
          <span>{THRESHOLD_MIN} · permissive</span>
          <span>{THRESHOLD_MAX} · strict</span>
        </div>
        <div className="threshold__note" data-tone={note.tone}>
          {note.text}
        </div>
      </div>

      <div className="card card--pad rise" style={delay(140)}>
        <div className="card__title" style={{ marginBottom: 14 }}>
          Escalation rules
        </div>
        <div className="switch-list">
          {ESCALATION_RULES.map((rule) => (
            <div className="switch-row" key={rule.key}>
              <Toggle checked={rules[rule.key]} label={rule.label} onChange={() => supervision.toggleRule(rule.key)} />
              <div className="switch-row__body">
                <div className="switch-row__label">{rule.label}</div>
                <div className="switch-row__desc">{rule.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card card--pad card--dark rise" style={delay(200)}>
        <div className="card__title">Model performance</div>
        <div className="perf-grid">
          <div>
            <div className="perf__label">Approval rate</div>
            <div className="perf__value perf__value--good">92.6%</div>
          </div>
          <div>
            <div className="perf__label">Edited before send</div>
            <div className="perf__value">5.1%</div>
          </div>
          <div>
            <div className="perf__label">Avg. draft time</div>
            <div className="perf__value">1.2s</div>
          </div>
          <div>
            <div className="perf__label">Rejected</div>
            <div className="perf__value perf__value--bad">2.3%</div>
          </div>
        </div>
        <div className="perf__feedback">
          <div className="perf__feedback-head">
            <span>Human feedback this session</span>
            <b>{taught}</b>
          </div>
          <div className="perf__track">
            <div className="perf__fill" style={{ width: `${Math.min(100, 8 + taught * 14)}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

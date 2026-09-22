import type { RuleKey, Supervision, SupervisionSettings } from "@/api/types";
import { Toggle } from "@/components/Toggle";
import { describeThreshold, RULE_KEYS, RULE_LABEL, THRESHOLD_MAX, THRESHOLD_MIN } from "@/domain/supervision";
import { useI18n } from "@/i18n";
import { delay } from "@/lib/css";

/** Circumference of the ring (r = 62), rounded as in the design. */
const RING_LENGTH = 390;

interface AutonomyPanelProps {
  settings: SupervisionSettings;
  distribution: number[];
  performance: Supervision["performance"];
  onThreshold: (value: number) => void;
  onRule: (key: RuleKey) => void;
}

export function AutonomyPanel({ settings, distribution, performance, onThreshold, onRule }: AutonomyPanelProps) {
  const { t, format } = useI18n();
  const { threshold, rules } = settings;
  const note = describeThreshold(threshold, distribution, t, format);
  const unavailable = t("common.unavailable");

  const rate = (value: number | null) => (value === null ? unavailable : format.percent(value, 1));
  // Part des décisions des 30 jours prises ces dernières 24 h : ce que « aujourd'hui » pèse dans l'apprentissage.
  const todayShare = performance.decided > 0 ? Math.min(100, (performance.feedbackLast24h / performance.decided) * 100) : 0;

  return (
    <div className="stack">
      <div className="card card--pad rise" style={delay(80)}>
        <div className="card__title">{t("autonomy.title")}</div>
        <div className="threshold__desc">{t("autonomy.desc")}</div>

        <div className="ring" aria-hidden="true">
          <div className="ring__glow" />
          <svg width="146" height="146" viewBox="0 0 146 146">
            <circle cx="73" cy="73" r="62" fill="none" stroke="var(--chip)" strokeWidth="11" />
            <circle
              className="ring__progress"
              cx="73"
              cy="73"
              r="62"
              fill="none"
              stroke="var(--lime)"
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH - (threshold / 100) * RING_LENGTH}
            />
            <circle cx="73" cy="73" r="50" fill="none" stroke="var(--border)" strokeWidth="1" strokeDasharray="3 7" />
          </svg>
          <div className="ring__value">
            <div className="ring__number">
              {threshold}
              <span>%</span>
            </div>
            <div className="ring__label">{t("autonomy.label")}</div>
          </div>
        </div>

        <input
          className="slider"
          type="range"
          min={THRESHOLD_MIN}
          max={THRESHOLD_MAX}
          value={threshold}
          aria-label={t("autonomy.aria")}
          aria-valuetext={t("autonomy.valueText", { value: threshold })}
          onChange={(event) => onThreshold(Number(event.target.value))}
        />
        <div className="slider-scale">
          <span>{t("autonomy.permissive", { value: THRESHOLD_MIN })}</span>
          <span>{t("autonomy.strict", { value: THRESHOLD_MAX })}</span>
        </div>
        <div className="threshold__note" data-tone={note.tone}>
          {note.text}
        </div>
        <div className="threshold__caveat">{t("autonomy.notEnforced")}</div>
      </div>

      <div className="card card--pad rise" style={delay(140)}>
        <div className="card__title" style={{ marginBottom: 14 }}>
          {t("rules.title")}
        </div>
        <div className="switch-list">
          {RULE_KEYS.map((key) => (
            <div className="switch-row" key={key}>
              <Toggle checked={rules[key]} label={t(RULE_LABEL[key].label)} onChange={() => onRule(key)} />
              <div className="switch-row__body">
                <div className="switch-row__label">{t(RULE_LABEL[key].label)}</div>
                <div className="switch-row__desc">{t(RULE_LABEL[key].description)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card card--pad card--dark rise" style={delay(200)}>
        <div className="card__title">{t("perf.title")}</div>
        <div className="perf__period">{t("perf.period", { days: performance.periodDays, decisions: performance.decided })}</div>
        <div className="perf-grid">
          <div>
            <div className="perf__label">{t("perf.approval")}</div>
            <div className="perf__value perf__value--good">{rate(performance.approvalRate)}</div>
          </div>
          <div>
            <div className="perf__label">{t("perf.edited")}</div>
            <div className="perf__value">{rate(performance.editedRate)}</div>
          </div>
          <div>
            <div className="perf__label">{t("perf.draftTime")}</div>
            <div className="perf__value">
              {performance.averageDraftMs === null ? unavailable : `${format.decimal(performance.averageDraftMs / 1000, 1)} s`}
            </div>
          </div>
          <div>
            <div className="perf__label">{t("perf.rejected")}</div>
            <div className="perf__value perf__value--bad">{rate(performance.rejectedRate)}</div>
          </div>
        </div>
        <div className="perf__feedback">
          <div className="perf__feedback-head">
            <span>{t("perf.feedback")}</span>
            <b>{format.int(performance.feedbackLast24h)}</b>
          </div>
          <div className="perf__track">
            <div className="perf__fill" style={{ width: `${todayShare}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

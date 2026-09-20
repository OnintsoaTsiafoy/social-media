import { NetBadge } from "@/components/Network";
import { REJECT_REASONS, REVIEW_WARNING_CONFIDENCE, SENTIMENT_TONE, type QueueItem } from "@/data/supervision";

interface QueueCardProps {
  item: QueueItem;
  threshold: number;
  sending: boolean;
  /** The reviewer pressed "Reject" and is being asked why. */
  askingReason: boolean;
  onApprove: () => void;
  onEdit: () => void;
  onReject: () => void;
  onPickReason: (reason: string) => void;
  onEscalate: () => void;
}

export function confidenceColor(confidence: number, threshold: number): string {
  if (confidence >= threshold) return "var(--lime-deep)";
  return confidence >= REVIEW_WARNING_CONFIDENCE ? "var(--warning)" : "var(--danger)";
}

export function QueueCard({
  item,
  threshold,
  sending,
  askingReason,
  onApprove,
  onEdit,
  onReject,
  onPickReason,
  onEscalate,
}: QueueCardProps) {
  const autoSend = item.confidence >= threshold;
  const color = confidenceColor(item.confidence, threshold);
  const locked = sending || askingReason;

  return (
    <article className="q-card" data-state={askingReason ? "feedback" : sending ? "sending" : undefined}>
      <div className="q-card__meta">
        <NetBadge net={item.net} />
        <span className="q-card__page">{item.page}</span>
        <span className="q-card__ago">{item.ago}</span>
        <span className="q-card__sentiment" data-tone={SENTIMENT_TONE[item.sentiment]}>
          <i />
          {item.sentiment}
        </span>
      </div>

      <div className="q-comment">
        “{item.comment}”<div className="q-comment__author">— {item.author}</div>
      </div>

      <div className="q-draft">
        <div className="q-draft__head">
          <span className="q-draft__tag">AI DRAFT</span>
          <span className="q-draft__conf-label">confidence</span>
          <div className="conf" role="img" aria-label={`Confidence ${item.confidence}%`}>
            <div className="conf__fill" style={{ width: `${item.confidence}%`, background: color }} />
            <div className="conf__sheen" />
          </div>
          <b className="conf__value" style={{ color }}>
            {item.confidence}%
          </b>
          <span className="gate" data-tone={autoSend ? "success" : "warning"}>
            {autoSend ? "AUTO-SEND" : "NEEDS REVIEW"}
          </span>
        </div>
        <div className="q-draft__text">{item.draft}</div>
      </div>

      {sending && (
        <div className="q-sending" role="status">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.4" fill="none" stroke="rgba(77,100,20,.2)" strokeWidth="2" />
            <circle
              cx="8"
              cy="8"
              r="6.4"
              fill="none"
              stroke="#4D6414"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="12 30"
            />
          </svg>
          Publishing the reply to {item.page}…
        </div>
      )}

      {askingReason && (
        <div className="q-feedback">
          <div className="q-feedback__title">What was wrong with this draft? Your answer retrains the model.</div>
          <div className="q-feedback__reasons">
            {REJECT_REASONS.map((reason) => (
              <button type="button" className="reason" key={reason} onClick={() => onPickReason(reason)}>
                {reason}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="q-actions" data-locked={locked}>
        <button type="button" className="q-btn q-btn--approve" disabled={locked} onClick={onApprove}>
          Approve &amp; send
        </button>
        <button type="button" className="q-btn q-btn--edit" disabled={locked} onClick={onEdit}>
          Edit draft
        </button>
        <button type="button" className="q-btn q-btn--reject" disabled={locked} onClick={onReject}>
          Reject
        </button>
        <button type="button" className="q-btn q-btn--escalate" disabled={locked} onClick={onEscalate}>
          Escalate to manager
        </button>
      </div>
    </article>
  );
}

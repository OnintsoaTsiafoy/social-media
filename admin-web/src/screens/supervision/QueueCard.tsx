import type { QueueDraft, RejectReason } from "@/api/types";
import { NetBadge } from "@/components/Network";
import { REJECT_REASONS, REVIEW_WARNING_CONFIDENCE, SENTIMENT_TONE } from "@/domain/supervision";
import { useI18n } from "@/i18n";

/** Même plafond que l'API (`MAX_RESPONSE_LENGTH`) et que l'éditeur de réponse mobile. */
const MAX_REPLY_LENGTH = 500;

interface QueueCardProps {
  item: QueueDraft;
  threshold: number;
  sending: boolean;
  /** The reviewer pressed "Reject" and is being asked why. */
  askingReason: boolean;
  /** Texte en cours de modification, ou `null` quand le brouillon n'est pas en édition. */
  editText: string | null;
  onApprove: () => void;
  onEdit: () => void;
  onEditChange: (text: string) => void;
  onEditCancel: () => void;
  onReject: () => void;
  onPickReason: (reason: RejectReason) => void;
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
  editText,
  onApprove,
  onEdit,
  onEditChange,
  onEditCancel,
  onReject,
  onPickReason,
  onEscalate,
}: QueueCardProps) {
  const { t, format } = useI18n();
  const confidence = item.confidence;
  const aboveThreshold = confidence !== null && confidence >= threshold;
  const color = confidence !== null ? confidenceColor(confidence, threshold) : "var(--disabled)";
  const locked = sending || askingReason;
  const editing = editText !== null;
  // Un brouillon bloqué par le contrôle de sécurité ne s'approuve qu'après modification.
  const cannotApprove = locked || (item.blocked && !editing) || (editing && editText.trim() === "");

  return (
    <article className="q-card" data-state={askingReason ? "feedback" : sending ? "sending" : undefined}>
      <div className="q-card__meta">
        <NetBadge net={item.network} />
        <span className="q-card__page">{item.page}</span>
        <span className="q-card__ago">{format.relative(new Date(item.commentedAt))}</span>
        {item.sentiment && (
          <span className="q-card__sentiment" data-tone={SENTIMENT_TONE[item.sentiment]}>
            <i />
            {t(`sentiment.${item.sentiment}`)}
          </span>
        )}
      </div>

      <div className="q-comment">
        “{item.comment}”<div className="q-comment__author">— {item.author ?? t("card.unknownAuthor")}</div>
      </div>

      <div className="q-draft">
        <div className="q-draft__head">
          <span className="q-draft__tag">{t("card.draftTag")}</span>
          <span className="q-draft__conf-label">{t("card.confidenceLabel")}</span>
          {confidence !== null ? (
            <>
              <div className="conf" role="img" aria-label={t("card.confidence.aria", { value: confidence })}>
                <div className="conf__fill" style={{ width: `${confidence}%`, background: color }} />
                <div className="conf__sheen" />
              </div>
              <b className="conf__value" style={{ color }}>
                {format.points(confidence)}
              </b>
            </>
          ) : (
            <b className="conf__value conf__value--none">{t("card.confidence.none")}</b>
          )}
          <span className="gate" data-tone={confidence === null ? "muted" : aboveThreshold ? "success" : "warning"}>
            {t(confidence === null ? "card.gate.none" : aboveThreshold ? "card.gate.above" : "card.gate.below")}
          </span>
          {item.status === "failed" && (
            <span className="gate" data-tone="danger">
              {t("card.failed")}
            </span>
          )}
        </div>

        {editing ? (
          <textarea
            className="q-draft__edit"
            value={editText}
            maxLength={MAX_REPLY_LENGTH}
            rows={4}
            aria-label={t("card.editLabel")}
            disabled={sending}
            onChange={(event) => onEditChange(event.target.value)}
          />
        ) : (
          <div className="q-draft__text">{item.draft}</div>
        )}

        {(item.blocked || item.warnings.length > 0) && (
          <div className="q-draft__warnings" role="note">
            {item.blocked && <div className="q-draft__blocked">{t("card.blocked")}</div>}
            {item.warnings.length > 0 && (
              <>
                <div className="q-draft__warnings-title">{t("card.warnings")}</div>
                <ul>
                  {item.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
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
          {t("card.sending", { page: item.page })}
        </div>
      )}

      {askingReason && (
        <div className="q-feedback">
          <div className="q-feedback__title">{t("card.feedback.title")}</div>
          <div className="q-feedback__reasons">
            {REJECT_REASONS.map((reason) => (
              <button type="button" className="reason" key={reason} onClick={() => onPickReason(reason)}>
                {t(`reason.${reason}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="q-actions" data-locked={locked}>
        <button type="button" className="q-btn q-btn--approve" disabled={cannotApprove} onClick={onApprove}>
          {t(item.status === "failed" ? "card.approveRetry" : "card.approve")}
        </button>
        <button type="button" className="q-btn q-btn--edit" disabled={locked} onClick={editing ? onEditCancel : onEdit}>
          {t(editing ? "card.editCancel" : "card.edit")}
        </button>
        <button type="button" className="q-btn q-btn--reject" disabled={locked} onClick={onReject}>
          {t("card.reject")}
        </button>
        <button type="button" className="q-btn q-btn--escalate" disabled={locked} onClick={onEscalate}>
          {t("card.escalate")}
        </button>
      </div>
    </article>
  );
}

import { toUserMessage } from "@/api/errors";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/css";

interface ErrorStateProps {
  error: unknown;
  onRetry: () => void;
  /** Encart compact dans une carte (par défaut : bloc plein écran d'un écran entier). */
  inline?: boolean;
}

/** Erreur de chargement : message traduit (jamais technique) et bouton pour réessayer. */
export function ErrorState({ error, onRetry, inline = false }: ErrorStateProps) {
  const { t } = useI18n();

  return (
    <div className={cx("error-state", inline && "error-state--inline")} role="alert">
      <div className="error-state__title">{t("common.loadError")}</div>
      <div className="error-state__text">{toUserMessage(error, t)}</div>
      <button type="button" className={cx("btn", "btn--outline")} onClick={onRetry}>
        {t("common.retry")}
      </button>
    </div>
  );
}

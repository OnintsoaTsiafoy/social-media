import { useEffect, useRef, type ReactNode } from "react";

import { useI18n } from "@/i18n";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Une action est en cours : Échap et le fond ne ferment plus la fenêtre. */
  busy?: boolean;
}

/** Fenêtre modale : fond assombri, Échap pour fermer, le focus entre dans la fenêtre à l'ouverture. */
export function Modal({ title, onClose, children, footer, busy = false }: ModalProps) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  useEffect(() => {
    if (busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <>
      <div className="overlay" onClick={busy ? undefined : onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
        <header className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <button type="button" className="drawer__close" onClick={onClose} disabled={busy} aria-label={t("common.close")}>
            ×
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </>
  );
}

import { useState } from "react";

import { adminApi } from "@/api/endpoints";
import { toUserMessage } from "@/api/errors";
import { ApiError } from "@/api/transport";
import type { PageLinkResult } from "@/api/types";
import { ErrorState } from "@/components/ErrorState";
import { Modal } from "@/components/Modal";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/css";
import { useResource } from "@/state/useResource";

interface SelectPagesDialogProps {
  selectionId: string;
  onClose: () => void;
  onLinked: (result: PageLinkResult) => void;
}

/** Les URL d'images de Facebook expirent : une image qui ne charge pas retombe sur la pastille « f ». */
function PageAvatar({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <span className="sel-row__avatar sel-row__avatar--none" aria-hidden="true">
        f
      </span>
    );
  }
  return <img className="sel-row__avatar" src={url} alt="" onError={() => setFailed(true)} />;
}

/**
 * Second temps de la liaison, au retour de Facebook : les pages que le compte autorisé peut gérer.
 * Rien n'est lié d'office — ce compte gère souvent les pages de plusieurs clients — seules les pages
 * cochées le sont, et une page déjà liée à une AUTRE marque ne peut pas l'être.
 */
export function SelectPagesDialog({ selectionId, onClose, onLinked }: SelectPagesDialogProps) {
  const { t } = useI18n();
  const selection = useResource((signal) => adminApi.pageSelection(selectionId, { signal }), `selection:${selectionId}`);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const data = selection.data;
  // 404 : sélection expirée (15 minutes), déjà utilisée, ou lancée par un autre administrateur.
  const expired = selection.error instanceof ApiError && selection.error.status === 404;

  const toggle = (externalId: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });

  const submit = async () => {
    if (chosen.size === 0) return;
    setPending(true);
    setError(null);
    try {
      onLinked(await adminApi.linkPageSelection(selectionId, [...chosen]));
    } catch (failure) {
      setError(failure);
      setPending(false);
    }
  };

  return (
    <Modal
      title={t("pages.connect.select.title")}
      onClose={onClose}
      busy={pending}
      footer={
        data && (
          <>
            <button type="button" className={cx("btn", "btn--outline")} onClick={onClose} disabled={pending}>
              {t("pages.connect.cancel")}
            </button>
            <button
              type="button"
              className={cx("btn", "btn--primary")}
              disabled={chosen.size === 0 || pending}
              title={chosen.size === 0 ? t("pages.connect.select.pickOne") : undefined}
              onClick={() => void submit()}
            >
              {pending
                ? t("pages.connect.select.submitting")
                : chosen.size === 0
                  ? t("pages.connect.select.submitNone")
                  : t("pages.connect.select.submit", { count: chosen.size })}
            </button>
          </>
        )
      }
    >
      {expired ? (
        <div className="modal__error" role="alert">
          {t("pages.connect.select.expired")}
        </div>
      ) : selection.error && !data ? (
        <ErrorState error={selection.error} onRetry={selection.reload} inline />
      ) : !data ? (
        <p className="modal__intro" role="status" aria-busy="true">
          {t("pages.connect.select.loading")}
        </p>
      ) : (
        <>
          <p className="modal__intro">
            {t("pages.connect.select.intro", { brand: data.brand.name, user: data.user.name })}
          </p>

          <ul className="sel-list">
            {data.pages.map((page) => {
              const blocked = page.linkedElsewhere !== null;
              return (
                <li key={page.externalId}>
                  <label className="sel-row" data-blocked={blocked}>
                    <input
                      type="checkbox"
                      checked={chosen.has(page.externalId)}
                      disabled={blocked || pending}
                      onChange={() => toggle(page.externalId)}
                    />
                    <PageAvatar url={page.pictureUrl} />
                    <span className="sel-row__body">
                      <span className="sel-row__name">{page.name}</span>
                      {page.instagram && (
                        <span className="sel-row__meta">
                          {page.instagram.username
                            ? t("pages.connect.select.instagram", { username: page.instagram.username })
                            : t("pages.connect.select.instagramUnnamed")}
                        </span>
                      )}
                      {page.alreadyLinked && <span className="sel-row__note">{t("pages.connect.select.alreadyLinked")}</span>}
                      {page.linkedElsewhere && (
                        <span className="sel-row__note sel-row__note--blocked">
                          {t("pages.connect.select.elsewhere", { brand: page.linkedElsewhere.brandName })}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {error !== null && (
            <div className="modal__error" role="alert">
              {toUserMessage(error, t)}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

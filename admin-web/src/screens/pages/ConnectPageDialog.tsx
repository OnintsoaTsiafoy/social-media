import { useMemo, useState } from "react";

import { adminApi } from "@/api/endpoints";
import { toUserMessage } from "@/api/errors";
import type { AdminUser } from "@/api/types";
import { ErrorState } from "@/components/ErrorState";
import { Modal } from "@/components/Modal";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/css";
import { redirectTo } from "@/lib/navigation";
import { useDebounced } from "@/state/useDebounced";
import { useResource } from "@/state/useResource";

type BrandChoice = AdminUser["memberships"][number];
interface Candidate {
  user: AdminUser;
  /** Marques où ce compte est propriétaire ou administrateur : les seules où il peut lier une page. */
  brands: BrandChoice[];
}

/**
 * Premier temps de la liaison : l'administrateur choisit le compte utilisateur et la marque, puis
 * est redirigé vers Facebook. Le retour (choix des pages) est traité par `SelectPagesDialog`.
 */
export function ConnectPageDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim());
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [brandId, setBrandId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const users = useResource(
    (signal) => adminApi.users({ status: "active", q: search, page: 1, pageSize: 20 }, { signal }),
    `connect-users:${search}`,
  );

  // Un compte qui n'est ni propriétaire ni administrateur d'une marque ne peut y lier aucune page.
  const candidates = useMemo<Candidate[]>(
    () =>
      (users.data?.items ?? [])
        .map((user) => ({ user, brands: user.memberships.filter((entry) => entry.role === "owner" || entry.role === "admin") }))
        .filter((candidate) => candidate.brands.length > 0),
    [users.data],
  );

  const choose = (candidate: Candidate) => {
    setSelected(candidate);
    // Une seule marque possible : inutile de la faire choisir.
    setBrandId(candidate.brands.length === 1 ? (candidate.brands[0]?.brandId ?? "") : "");
    setError(null);
  };

  const submit = async () => {
    if (!selected || !brandId) return;
    setPending(true);
    setError(null);
    try {
      const { authorizationUrl } = await adminApi.startPageConnection(selected.user.id, brandId);
      // La page quitte la console : `pending` reste vrai jusqu'au déchargement.
      redirectTo(authorizationUrl);
    } catch (failure) {
      setError(failure);
      setPending(false);
    }
  };

  return (
    <Modal
      title={t("pages.connect.title")}
      onClose={onClose}
      busy={pending}
      footer={
        <>
          <button type="button" className={cx("btn", "btn--outline")} onClick={onClose} disabled={pending}>
            {t("pages.connect.cancel")}
          </button>
          <button type="button" className={cx("btn", "btn--primary")} disabled={!selected || !brandId || pending} onClick={() => void submit()}>
            {pending ? t("pages.connect.submitting") : t("pages.connect.submit")}
          </button>
        </>
      }
    >
      <p className="modal__intro">{t("pages.connect.intro")}</p>

      <div className="field">
        <label className="field__label" htmlFor="connect-user-search">
          {t("pages.connect.user.label")}
        </label>
        <input
          id="connect-user-search"
          className="field__input"
          type="search"
          value={query}
          placeholder={t("pages.connect.user.search")}
          aria-label={t("pages.connect.user.aria")}
          onChange={(event) => setQuery(event.target.value)}
        />

        {users.error && !users.data ? (
          <ErrorState error={users.error} onRetry={users.reload} inline />
        ) : (
          <ul className="pick-list" role="radiogroup" aria-label={t("pages.connect.user.label")} aria-busy={users.loading}>
            {candidates.map((candidate) => (
              <li key={candidate.user.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected?.user.id === candidate.user.id}
                  className="pick"
                  onClick={() => choose(candidate)}
                >
                  <span className="pick__name">{candidate.user.name}</span>
                  <span className="pick__meta">{candidate.user.email}</span>
                </button>
              </li>
            ))}
            {!users.loading && candidates.length === 0 && <li className="pick-empty">{t("pages.connect.user.empty")}</li>}
          </ul>
        )}
      </div>

      {selected && (
        <div className="field">
          <label className="field__label" htmlFor="connect-brand">
            {t("pages.connect.brand.label")}
          </label>
          <select id="connect-brand" className="field__input" value={brandId} onChange={(event) => setBrandId(event.target.value)}>
            {selected.brands.length > 1 && <option value="" />}
            {selected.brands.map((brand) => (
              <option key={brand.brandId} value={brand.brandId}>
                {brand.brandName} · {t(`role.${brand.role}`)}
              </option>
            ))}
          </select>
          <p className="field__hint">{t("pages.connect.brand.hint")}</p>
        </div>
      )}

      {error !== null && (
        <div className="modal__error" role="alert">
          {toUserMessage(error, t)}
        </div>
      )}
    </Modal>
  );
}

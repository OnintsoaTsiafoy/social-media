import { useEffect, useRef } from "react";

import { Toggle } from "@/components/Toggle";
import { EDITABLE_ROLES } from "@/domain/users";
import { useI18n } from "@/i18n";
import { initialsOf } from "@/i18n/format";
import { cx } from "@/lib/css";
import type { useUsers } from "@/state/useUsers";

/** Tiroir d'un compte : rôles par marque, accès plateforme, suspension. Rendu par l'écran des utilisateurs. */
export function UserDrawer({ users }: { users: ReturnType<typeof useUsers> }) {
  const { t, format } = useI18n();
  const { openUser, draft, close, saving, isSelf } = users;
  const closeButton = useRef<HTMLButtonElement>(null);
  const isOpen = openUser !== null;

  useEffect(() => {
    if (!isOpen) return;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  if (!openUser || !draft) return null;
  const suspended = openUser.status === "suspended";

  return (
    <>
      <div className="overlay" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t("drawer.aria", { name: openUser.name })}>
        <div className="drawer__head">
          <div className="drawer__avatar">{initialsOf(openUser.name)}</div>
          <div className="drawer__id">
            <div className="drawer__name">{openUser.name}</div>
            <div className="drawer__email">{openUser.email}</div>
          </div>
          <button type="button" ref={closeButton} className="drawer__close" onClick={close} aria-label={t("common.close")}>
            ×
          </button>
        </div>

        <div className="drawer__body">
          <div className="drawer__stats">
            <div className="drawer__stat">
              <div className="drawer__stat-label">{t("drawer.stat.replies")}</div>
              <div className="drawer__stat-value">{format.int(openUser.replies30d)}</div>
            </div>
            <div className="drawer__stat">
              <div className="drawer__stat-label">{t("drawer.stat.average")}</div>
              <div className="drawer__stat-value">
                {openUser.averageResponseSeconds === null ? "—" : format.duration(openUser.averageResponseSeconds)}
              </div>
            </div>
          </div>

          <div>
            <div className="drawer__label">{t("drawer.roles.label")}</div>
            {openUser.memberships.length === 0 ? (
              <div className="drawer__hint">{t("drawer.roles.none")}</div>
            ) : (
              <div className="brand-roles">
                {openUser.memberships.map((membership) => (
                  <div className="brand-role" key={membership.brandId}>
                    <div className="brand-role__name">{membership.brandName}</div>
                    {membership.role === "owner" ? (
                      <div className="drawer__hint">{t("drawer.roles.owner")}</div>
                    ) : (
                      <>
                        <div className="role-options" role="group" aria-label={membership.brandName}>
                          {EDITABLE_ROLES.map((role) => (
                            <button
                              type="button"
                              key={role}
                              className="role-option"
                              aria-pressed={draft.roles[membership.brandId] === role}
                              onClick={() => users.setDraftRole(membership.brandId, role)}
                            >
                              {t(`role.${role}`)}
                            </button>
                          ))}
                        </div>
                        <div className="drawer__hint">
                          {draft.roles[membership.brandId] ? t(`drawer.roles.${draft.roles[membership.brandId] as "admin" | "community_manager" | "viewer"}`) : ""}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="drawer__label">{t("drawer.platform.label")}</div>
            <div className="switch-row">
              <Toggle
                checked={draft.platformAdmin}
                label={t("drawer.platform.title")}
                onChange={users.toggleDraftPlatformAdmin}
              />
              <div className="switch-row__body">
                <div className="switch-row__label">{t("drawer.platform.title")}</div>
                <div className="switch-row__desc">{t("drawer.platform.desc")}</div>
              </div>
            </div>
          </div>

          {isSelf && <div className="drawer__hint drawer__hint--note">{t("drawer.self")}</div>}
        </div>

        <div className="drawer__foot">
          <button type="button" className={cx("btn", "btn--primary", "drawer__save")} disabled={saving} onClick={users.save}>
            {saving ? t("common.saving") : t("drawer.save")}
          </button>
          <button type="button" className={cx("btn", "drawer__suspend")} disabled={saving || isSelf} onClick={users.toggleSuspension}>
            {t(suspended ? "drawer.reactivate" : "drawer.suspend")}
          </button>
        </div>
      </aside>
    </>
  );
}

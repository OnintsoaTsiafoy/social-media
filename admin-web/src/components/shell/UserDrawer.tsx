import { useEffect, useRef } from "react";

import { Toggle } from "@/components/Toggle";
import { PERMISSIONS, ROLES } from "@/data/users";
import { initialsOf } from "@/lib/format";
import { cx } from "@/lib/css";
import { useAdmin } from "@/state/AdminContext";

export function UserDrawer() {
  const { users } = useAdmin();
  const { openUser, draft, close } = users;
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

  return (
    <>
      <div className="overlay" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${openUser.name} — role and permissions`}>
        <div className="drawer__head">
          <div className="drawer__avatar">{initialsOf(openUser.name)}</div>
          <div className="drawer__id">
            <div className="drawer__name">{openUser.name}</div>
            <div className="drawer__email">{openUser.email}</div>
          </div>
          <button type="button" ref={closeButton} className="drawer__close" onClick={close} aria-label="Close">
            ×
          </button>
        </div>

        <div className="drawer__body">
          <div className="drawer__stats">
            <div className="drawer__stat">
              <div className="drawer__stat-label">Replies this week</div>
              <div className="drawer__stat-value">{openUser.replies}</div>
            </div>
            <div className="drawer__stat">
              <div className="drawer__stat-label">Avg. response</div>
              <div className="drawer__stat-value">{openUser.avgResponse}</div>
            </div>
          </div>

          <div>
            <div className="drawer__label">ROLE</div>
            <div className="role-options">
              {ROLES.map((role) => (
                <button
                  type="button"
                  key={role}
                  className="role-option"
                  aria-pressed={draft.role === role}
                  onClick={() => users.setDraftRole(role)}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="drawer__label">PERMISSIONS</div>
            <div className="drawer__perms">
              {PERMISSIONS.map((permission) => (
                <div className="switch-row" key={permission.key}>
                  <Toggle
                    checked={draft.permissions[permission.key]}
                    label={permission.label}
                    onChange={() => users.toggleDraftPermission(permission.key)}
                  />
                  <div className="switch-row__body">
                    <div className="switch-row__label">{permission.label}</div>
                    <div className="switch-row__desc">{permission.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="drawer__foot">
          <button type="button" className={cx("btn", "btn--primary", "drawer__save")} onClick={users.save}>
            Save changes
          </button>
          <button type="button" className={cx("btn", "drawer__suspend")} onClick={users.suspend}>
            Suspend
          </button>
        </div>
      </aside>
    </>
  );
}

import type { ReactNode } from "react";

import { BrandMark } from "@/components/BrandMark";
import {
  AnalyticsIcon,
  OverviewIcon,
  PagesIcon,
  SettingsIcon,
  SupervisionIcon,
  UsersIcon,
} from "@/components/icons";
import { PRODUCT_NAME } from "@/config";
import { useI18n, type MessageKey } from "@/i18n";
import { useAdmin } from "@/state/AdminContext";
import { useAuth } from "@/state/AuthContext";
import { hrefFor } from "@/state/useRoute";
import type { ScreenId } from "@/types";

interface NavLinkProps {
  id: ScreenId;
  label: MessageKey;
  icon: ReactNode;
  trailing?: ReactNode;
}

function NavLink({ id, label, icon, trailing }: NavLinkProps) {
  const { screen } = useAdmin();
  const { t } = useI18n();
  return (
    <a className="nav__item" href={hrefFor(id)} aria-current={screen === id ? "page" : undefined}>
      {icon}
      <span className="nav__label">{t(label)}</span>
      {trailing}
    </a>
  );
}

export function Sidebar() {
  const { t, format } = useI18n();
  const { summary, profile } = useAdmin();
  const { signOut } = useAuth();
  const data = summary.data;

  const syncText = data
    ? data.lastEventAt
      ? t("sync.text", {
          online: data.users.online,
          total: data.users.total,
          ago: format.relative(new Date(data.lastEventAt)),
        })
      : t("sync.textNoEvent", { online: data.users.online, total: data.users.total })
    : t("common.loading");

  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark />
        <div>
          <div className="brand__name">{PRODUCT_NAME}</div>
          <div className="brand__tag">{t("brand.tag")}</div>
        </div>
      </div>

      <nav className="nav" aria-label={t("nav.aria")}>
        <div className="nav__section">{t("nav.section.supervision")}</div>
        <NavLink id="overview" label="nav.overview" icon={<OverviewIcon />} trailing={<span className="nav__dot" />} />
        <NavLink
          id="supervision"
          label="nav.supervision"
          icon={<SupervisionIcon />}
          trailing={
            data && (
              <span className="nav__badge">
                {data.supervision.pendingDrafts}
                <span className="sr-only"> {t("nav.queue", { count: data.supervision.pendingDrafts })}</span>
              </span>
            )
          }
        />
        <NavLink id="analytics" label="nav.analytics" icon={<AnalyticsIcon />} />

        <div className="nav__section">{t("nav.section.administration")}</div>
        <NavLink
          id="users"
          label="nav.users"
          icon={<UsersIcon />}
          trailing={data && <span className="nav__count">{format.int(data.users.total)}</span>}
        />
        <NavLink
          id="pages"
          label="nav.pages"
          icon={<PagesIcon />}
          trailing={data && <span className="nav__count">{format.int(data.pages.all)}</span>}
        />
        <NavLink id="configuration" label="nav.configuration" icon={<SettingsIcon />} />
      </nav>

      <div className="sidebar__foot">
        <div className="sync-card">
          <div className="sync-card__head">
            <span className="sync-card__dot" />
            <span className="sync-card__title">{t("sync.title")}</span>
          </div>
          <div className="sync-card__text">{syncText}</div>
        </div>
        <div className="profile">
          <div className="profile__avatar">{profile.avatarInitials}</div>
          <div className="profile__body">
            <div className="profile__name">{profile.displayName}</div>
            <div className="profile__role">{t("profile.role")}</div>
          </div>
          <button type="button" className="profile__signout" onClick={() => void signOut()}>
            {t("common.signOut")}
          </button>
        </div>
      </div>
    </aside>
  );
}

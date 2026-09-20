import type { ReactNode } from "react";

import {
  AnalyticsIcon,
  OverviewIcon,
  PagesIcon,
  SettingsIcon,
  SupervisionIcon,
  UsersIcon,
} from "@/components/icons";
import { CURRENT_ADMIN, PRODUCT_NAME } from "@/config";
import { NETWORK_PAGE_COUNTS } from "@/data/overview";
import { TOTAL_ACCOUNTS } from "@/data/users";
import { useAdmin } from "@/state/AdminContext";
import { hrefFor } from "@/state/useRoute";
import type { ScreenId } from "@/types";

interface NavLinkProps {
  id: ScreenId;
  label: string;
  icon: ReactNode;
  trailing?: ReactNode;
}

function NavLink({ id, label, icon, trailing }: NavLinkProps) {
  const { screen } = useAdmin();
  return (
    <a className="nav__item" href={hrefFor(id)} aria-current={screen === id ? "page" : undefined}>
      {icon}
      <span className="nav__label">{label}</span>
      {trailing}
    </a>
  );
}

export function Sidebar() {
  const { supervision } = useAdmin();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand__mark" />
        <div>
          <div className="brand__name">{PRODUCT_NAME}</div>
          <div className="brand__tag">ADMIN CONSOLE</div>
        </div>
      </div>

      <nav className="nav" aria-label="Main">
        <div className="nav__section">SUPERVISION</div>
        <NavLink id="overview" label="Overview" icon={<OverviewIcon />} trailing={<span className="nav__dot" />} />
        <NavLink
          id="supervision"
          label="AI supervision"
          icon={<SupervisionIcon />}
          trailing={
            <span className="nav__badge">
              {supervision.queue.length}
              <span className="sr-only"> drafts to review</span>
            </span>
          }
        />
        <NavLink id="analytics" label="Analytics" icon={<AnalyticsIcon />} />

        <div className="nav__section">ADMINISTRATION</div>
        <NavLink
          id="users"
          label="Users & roles"
          icon={<UsersIcon />}
          trailing={<span className="nav__count">{TOTAL_ACCOUNTS}</span>}
        />
        <NavLink
          id="pages"
          label="Pages"
          icon={<PagesIcon />}
          trailing={<span className="nav__count">{NETWORK_PAGE_COUNTS.all}</span>}
        />
        <NavLink id="configuration" label="Configuration" icon={<SettingsIcon />} />
      </nav>

      <div className="sidebar__foot">
        <div className="sync-card">
          <div className="sync-card__head">
            <span className="sync-card__dot" />
            <span className="sync-card__title">Mobile app sync</span>
          </div>
          <div className="sync-card__text">{TOTAL_ACCOUNTS} managers connected · last event 12s ago</div>
        </div>
        <div className="profile">
          <div className="profile__avatar">{CURRENT_ADMIN.initials}</div>
          <div className="profile__body">
            <div className="profile__name">{CURRENT_ADMIN.name}</div>
            <div className="profile__role">{CURRENT_ADMIN.role}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

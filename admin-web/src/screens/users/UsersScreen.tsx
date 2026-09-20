import { ErrorState } from "@/components/ErrorState";
import { SearchIcon } from "@/components/icons";
import { ROLE_TONE, STATUS_TONE, USER_FILTERS, USERS_PAGE_SIZE } from "@/domain/users";
import { useI18n } from "@/i18n";
import { initialsOf } from "@/i18n/format";
import { cx, delay } from "@/lib/css";
import { useAdmin } from "@/state/AdminContext";
import { useUsers } from "@/state/useUsers";

import { UserDrawer } from "./UserDrawer";
import "./users.css";

export function UsersScreen() {
  const { t, format } = useI18n();
  const { summary } = useAdmin();
  const users = useUsers();
  const { resource } = users;
  const data = resource.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / USERS_PAGE_SIZE)) : 1;

  return (
    <div className="screen">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">{t("screen.users")}</h1>
          <p className="page-head__sub">
            {t("users.subtitle", {
              accounts: format.int(data?.counts.all ?? summary.data?.users.total ?? 0),
              online: format.int(summary.data?.users.online ?? 0),
            })}
          </p>
        </div>
      </div>

      <div className="us-toolbar">
        <div className="segmented" role="group" aria-label={t("users.filter.aria")}>
          {USER_FILTERS.map((name) => (
            <button
              type="button"
              className="user-filter"
              key={name}
              aria-pressed={users.filter === name}
              onClick={() => users.setFilter(name)}
            >
              {t(`users.filter.${name}`)}
              {data && <span className="user-filter__count">{data.counts[name]}</span>}
            </button>
          ))}
        </div>
        <label className="user-search">
          <SearchIcon />
          <input
            type="text"
            value={users.query}
            placeholder={t("users.search.placeholder")}
            aria-label={t("users.search.aria")}
            onChange={(event) => users.setQuery(event.target.value)}
          />
        </label>
      </div>

      {data ? (
        <div className="card card--flush rise" style={delay(50)} role="table" aria-label={t("users.table.aria")} aria-busy={resource.loading}>
          <div className="table-head user-cols" role="row">
            <span role="columnheader">{t("users.columns.member")}</span>
            <span role="columnheader">{t("users.columns.role")}</span>
            <span role="columnheader">{t("users.columns.pages")}</span>
            <span role="columnheader">{t("users.columns.lastSeen")}</span>
            <span role="columnheader" />
          </div>
          {data.items.map((user) => {
            const roleKey = user.role ?? "none";
            return (
              <button
                type="button"
                className="user-row"
                key={user.id}
                aria-label={t("users.row.open", { name: user.name })}
                onClick={() => users.open(user)}
              >
                <span className="user-row__member">
                  <span className="user-avatar" data-suspended={user.status === "suspended"}>
                    {initialsOf(user.name)}
                  </span>
                  <span className="user-row__id">
                    <span className="user-row__name">
                      <span>{user.name}</span>
                      <span className="status-dot" data-tone={STATUS_TONE[user.status]} title={t(`users.status.${user.status}`)} />
                    </span>
                    <span className="user-row__email">{user.email}</span>
                  </span>
                </span>
                <span className="role-chip" data-tone={user.platformRole === "platform_admin" ? "warning" : ROLE_TONE[roleKey]}>
                  {t(user.platformRole === "platform_admin" ? "role.platform_admin" : `role.${roleKey}`)}
                </span>
                <span className="user-row__pages">
                  {user.pagesCount > 0 ? t("users.pages", { count: user.pagesCount }) : t("users.pages.none")}
                </span>
                <span className="user-row__seen">
                  {user.lastSeenAt ? format.relative(new Date(user.lastSeenAt)) : t("users.lastSeen.never")}
                </span>
                <span className="user-row__more" aria-hidden="true">
                  ⋯
                </span>
              </button>
            );
          })}
          {data.items.length === 0 && <div className="empty">{t("users.empty")}</div>}
          {pageCount > 1 && (
            <nav className="pager" aria-label={t("users.table.aria")}>
              <button type="button" className={cx("btn", "btn--outline", "btn--sm")} disabled={users.page <= 1} onClick={() => users.setPage(users.page - 1)}>
                {t("common.previous")}
              </button>
              <span className="pager__label">{t("users.pagination", { page: users.page, pages: pageCount })}</span>
              <button type="button" className={cx("btn", "btn--outline", "btn--sm")} disabled={users.page >= pageCount} onClick={() => users.setPage(users.page + 1)}>
                {t("common.next")}
              </button>
            </nav>
          )}
        </div>
      ) : resource.error && !resource.loading ? (
        <ErrorState error={resource.error} onRetry={resource.reload} />
      ) : (
        <div className="skeleton skeleton--card" style={{ height: 360, borderRadius: 18 }} role="status" aria-busy="true" aria-label={t("common.loading")} />
      )}

      <UserDrawer users={users} />
    </div>
  );
}

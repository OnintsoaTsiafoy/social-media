import { SearchIcon } from "@/components/icons";
import { ROLE_TONE, STATUS_TONE, TOTAL_ACCOUNTS, USER_FILTERS } from "@/data/users";
import { cx, delay } from "@/lib/css";
import { initialsOf } from "@/lib/format";
import { useAdmin } from "@/state/AdminContext";

import "./users.css";

export function UsersScreen() {
  const { users, say } = useAdmin();

  return (
    <div className="screen">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Users &amp; roles</h1>
          <p className="page-head__sub">
            {TOTAL_ACCOUNTS} accounts · 6 roles · permissions apply to the mobile app instantly
          </p>
        </div>
        <button
          type="button"
          className={cx("btn", "btn--primary")}
          onClick={() => say("Invitation link copied to clipboard")}
        >
          Invite manager
        </button>
      </div>

      <div className="us-toolbar">
        <div className="segmented" role="group" aria-label="Filter by status">
          {USER_FILTERS.map((name) => (
            <button
              type="button"
              className="user-filter"
              key={name}
              aria-pressed={users.filter === name}
              onClick={() => users.setFilter(name)}
            >
              {name}
              <span className="user-filter__count">{users.counts[name]}</span>
            </button>
          ))}
        </div>
        <label className="user-search">
          <SearchIcon />
          <input
            type="text"
            value={users.query}
            placeholder="Filter by name or email"
            aria-label="Filter members by name or email"
            onChange={(event) => users.setQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="card card--flush rise" style={delay(50)} role="table" aria-label="Members">
        <div className="table-head user-cols" role="row">
          <span role="columnheader">MEMBER</span>
          <span role="columnheader">ROLE</span>
          <span role="columnheader">PAGES</span>
          <span role="columnheader">LAST ACTIVE</span>
          <span role="columnheader" />
        </div>
        {users.visible.map((user) => (
          <button
            type="button"
            className="user-row"
            key={user.id}
            aria-label={`Open ${user.name}`}
            onClick={() => users.open(user.id)}
          >
            <span className="user-row__member">
              <span className="user-avatar" data-suspended={user.status === "Suspended"}>
                {initialsOf(user.name)}
              </span>
              <span className="user-row__id">
                <span className="user-row__name">
                  <span>{user.name}</span>
                  <span className="status-dot" data-tone={STATUS_TONE[user.status]} title={user.status} />
                </span>
                <span className="user-row__email">{user.email}</span>
              </span>
            </span>
            <span className="role-chip" data-tone={ROLE_TONE[user.role]}>
              {user.role}
            </span>
            <span className="user-row__pages">{user.pages}</span>
            <span className="user-row__seen">{user.seen}</span>
            <span className="user-row__more" aria-hidden="true">
              ⋯
            </span>
          </button>
        ))}
        {users.visible.length === 0 && <div className="empty">No member matches this filter.</div>}
      </div>
    </div>
  );
}

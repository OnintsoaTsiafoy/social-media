import { BellIcon, SearchIcon } from "@/components/icons";
import { NETWORK_PAGE_COUNTS } from "@/data/overview";
import { TOTAL_ACCOUNTS } from "@/data/users";
import { useAdmin } from "@/state/AdminContext";

const UNREAD_NOTIFICATIONS = 7;

export function Topbar() {
  const { say } = useAdmin();
  const stats: Array<[string, string]> = [
    ["Pages", String(NETWORK_PAGE_COUNTS.all)],
    ["Managers online", `41/${TOTAL_ACCOUNTS}`],
    ["SLA", "94.2%"],
    ["AI autonomy", "68.4%"],
  ];

  return (
    <header className="topbar">
      <div className="topbar__stats">
        {stats.map(([label, value]) => (
          <div className="stat-pill" key={label}>
            {label} <b>{value}</b>
          </div>
        ))}
      </div>
      <div className="topbar__tools">
        <label className="search">
          <SearchIcon />
          <input type="search" placeholder="Search users, pages, rules…" aria-label="Search users, pages and rules" />
          <kbd aria-hidden="true">⌘K</kbd>
        </label>
        <button
          type="button"
          className="bell"
          aria-label={`${UNREAD_NOTIFICATIONS} unread notifications`}
          onClick={() => say(`${UNREAD_NOTIFICATIONS} unread admin notifications`)}
        >
          <BellIcon />
          <span className="bell__badge" aria-hidden="true">
            {UNREAD_NOTIFICATIONS}
          </span>
        </button>
      </div>
    </header>
  );
}

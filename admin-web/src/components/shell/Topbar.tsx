import { useEffect, useRef, useState, type FormEvent } from "react";

import { BellIcon, SearchIcon } from "@/components/icons";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { useI18n } from "@/i18n";
import { useAdmin } from "@/state/AdminContext";
import { hrefFor } from "@/state/useRoute";

export function Topbar() {
  const { t, format } = useI18n();
  const { summary, say, setMemberQuery } = useAdmin();
  const data = summary.data;
  const [draft, setDraft] = useState("");
  const search = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K met le curseur dans la recherche.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const unavailable = "—";
  const stats: Array<[string, string]> = [
    [t("topbar.stats.pages"), data ? format.int(data.pages.all) : unavailable],
    [t("topbar.stats.online"), data ? `${format.int(data.users.online)}/${format.int(data.users.total)}` : unavailable],
    [t("topbar.stats.sla"), data?.sla.complianceRate == null ? unavailable : format.percent(data.sla.complianceRate, 1)],
    [t("topbar.stats.autonomy"), data?.ai.autonomyRate == null ? unavailable : format.percent(data.ai.autonomyRate, 1)],
  ];

  const alerts = data ? data.alerts.escalations + data.alerts.pagesNeedingAction : 0;

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setMemberQuery(draft.trim());
    window.location.hash = hrefFor("users");
  };

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
        <form className="search" role="search" onSubmit={submitSearch}>
          <SearchIcon />
          <input
            ref={search}
            type="search"
            value={draft}
            placeholder={t("topbar.search.placeholder")}
            aria-label={t("topbar.search.label")}
            onChange={(event) => setDraft(event.target.value)}
          />
          <kbd aria-hidden="true">⌘K</kbd>
        </form>
        <LocaleSwitch />
        <button
          type="button"
          className="bell"
          aria-label={alerts > 0 ? t("topbar.alerts", { count: alerts }) : t("topbar.alerts.none")}
          onClick={() =>
            say(
              data && alerts > 0
                ? t("topbar.alerts.toast", { escalations: data.alerts.escalations, pages: data.alerts.pagesNeedingAction })
                : t("topbar.alerts.none"),
            )
          }
        >
          <BellIcon />
          {alerts > 0 && (
            <span className="bell__badge" aria-hidden="true">
              {alerts}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}

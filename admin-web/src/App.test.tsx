import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { FEED_POOL } from "@/data/overview";
import { computeSeries, formatMetric } from "@/lib/chart";
import { SKELETON_MS } from "@/state/useRoute";

const FAKE = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "Date",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "performance",
] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE] });
});
afterEach(() => {
  vi.useRealTimers();
});

const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

function renderApp(hash = "") {
  window.location.hash = hash;
  return render(<App />);
}

/** Navigates the way the sidebar does and waits out the loading skeleton. */
function openScreen(id: string) {
  act(() => {
    window.location.hash = `#/${id}`;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  tick(SKELETON_MS + 20);
}

const toastShown = (message: string) => screen.queryAllByText(message).length > 0;

describe("navigation", () => {
  it("opens on the overview and marks it as the current page", () => {
    renderApp();
    expect(screen.getByRole("heading", { level: 1, name: "Platform overview" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Overview/ }).getAttribute("aria-current")).toBe("page");
  });

  it("honours the URL hash on first load", () => {
    renderApp("#/analytics");
    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeTruthy();
  });

  it("falls back to the overview for an unknown hash", () => {
    renderApp("#/nope");
    expect(screen.getByRole("heading", { level: 1, name: "Platform overview" })).toBeTruthy();
  });

  it("shows a skeleton while switching screens, then the new screen", () => {
    renderApp();
    act(() => {
      window.location.hash = "#/users";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();

    tick(SKELETON_MS + 20);
    expect(screen.queryByLabelText("Loading")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Users & roles" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Users & roles/ }).getAttribute("aria-current")).toBe("page");
  });

  it("links every sidebar entry to a hash route", () => {
    renderApp();
    const hrefs = within(screen.getByRole("navigation", { name: "Main" }))
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["#/overview", "#/supervision", "#/analytics", "#/users", "#/pages", "#/configuration"]);
  });
});

describe("overview", () => {
  it("counts the headline figures up to their final values", () => {
    renderApp();
    tick(1300);
    expect(screen.getByText("23")).toBeTruthy();
    expect(screen.getByText("68.4%", { selector: ".kpi__value" })).toBeTruthy();
    expect(screen.getByText("4m 12s")).toBeTruthy();
  });

  it("filters escalations by network and restores them", () => {
    renderApp();
    const igOnly = "Repeated insults targeting a moderator in comments";
    const fbOnly = "Product recall rumour spreading under the launch post";
    expect(screen.getByText(igOnly)).toBeTruthy();

    const facebook = screen.getByText("Facebook");
    fireEvent.click(facebook);
    expect(facebook.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(igOnly)).toBeNull();
    expect(screen.getByText(fbOnly)).toBeTruthy();

    fireEvent.click(screen.getByText("All networks"));
    expect(screen.getByText(igOnly)).toBeTruthy();
  });

  it("toggles a network off when its pill is pressed twice", () => {
    renderApp();
    const instagram = screen.getByText("Instagram");
    fireEvent.click(instagram);
    expect(instagram.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(instagram);
    expect(instagram.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("All networks").getAttribute("aria-pressed")).toBe("true");
  });

  it("cycles the date range", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Date range: Last 7 days. Activate to change." }));
    expect(screen.getByRole("button", { name: "Date range: Last 30 days. Activate to change." })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Last 30 days/ }));
    fireEvent.click(screen.getByRole("button", { name: /This quarter/ }));
    expect(screen.getByRole("button", { name: /Last 7 days/ })).toBeTruthy();
  });

  it("keeps four items in the live stream and rotates a new one in", () => {
    renderApp();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    tick(3400);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    // Newest first: the fifth pool entry lands on top and the last one (the fourth) drops off.
    expect(items[0]?.textContent).toContain(FEED_POOL[4]?.text);
    expect(screen.queryByText(FEED_POOL[0]?.text ?? "")).not.toBeNull();
    expect(screen.queryByText(FEED_POOL[3]?.text ?? "")).toBeNull();
  });

  it("confirms an escalation takeover with a toast that then disappears", () => {
    renderApp();
    fireEvent.click(screen.getAllByRole("button", { name: "Take over" })[0]!);
    expect(toastShown("Escalation assigned to you · Nova Cosmetics")).toBe(true);
    tick(2700);
    expect(toastShown("Escalation assigned to you · Nova Cosmetics")).toBe(false);
  });
});

describe("AI supervision", () => {
  beforeEach(() => {
    renderApp("#/supervision");
  });

  it("lists the drafts waiting for review and counts them in the sidebar", () => {
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.getByRole("link", { name: /AI supervision 4 drafts to review/ })).toBeTruthy();
  });

  it("publishes an approved draft after a delay, then drops it", () => {
    const first = screen.getAllByRole("article")[0]!;
    fireEvent.click(within(first).getByRole("button", { name: "Approve & send" }));

    expect(screen.getByText("Publishing the reply to Nova Cosmetics…")).toBeTruthy();
    expect(within(first).getByRole("button", { name: "Reject" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("article")).toHaveLength(4);

    tick(1200);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(toastShown("Reply published on Nova Cosmetics")).toBe(true);
    expect(screen.getByRole("link", { name: /AI supervision 3 drafts to review/ })).toBeTruthy();
  });

  it("asks why a draft was rejected before dropping it, and counts the feedback", () => {
    const first = screen.getAllByRole("article")[0]!;
    fireEvent.click(within(first).getByRole("button", { name: "Reject" }));
    expect(screen.getByText(/What was wrong with this draft/)).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Wrong tone" }));
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(toastShown("“Wrong tone” recorded · model updated")).toBe(true);
    expect(screen.getByText("Human feedback this session").nextElementSibling?.textContent).toBe("1");
  });

  it("lets the autonomy threshold decide which drafts send without review", () => {
    expect(screen.getAllByText("AUTO-SEND")).toHaveLength(2); // 94% and 88% clear the default 82%
    fireEvent.change(screen.getByRole("slider", { name: "Autonomy threshold" }), { target: { value: "95" } });

    expect(screen.queryAllByText("AUTO-SEND")).toHaveLength(0);
    expect(screen.getAllByText("NEEDS REVIEW")).toHaveLength(4);
    expect(screen.getByText(/Very strict/)).toBeTruthy();
  });

  it("shows the empty state once every draft has been handled", () => {
    for (let i = 0; i < 4; i += 1) {
      const card = screen.getAllByRole("article")[0]!;
      fireEvent.click(within(card).getByRole("button", { name: "Escalate to manager" }));
    }
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText("Queue cleared")).toBeTruthy();
  });

  it("remembers the queue when you navigate away and back", () => {
    const first = screen.getAllByRole("article")[0]!;
    fireEvent.click(within(first).getByRole("button", { name: "Escalate to manager" }));
    openScreen("overview");
    openScreen("supervision");
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("reflects the auto-reply switch", () => {
    const toggle = screen.getByRole("switch", { name: "Auto-reply" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("PAUSED")).toBeTruthy();
    expect(toastShown("Auto-reply paused platform-wide")).toBe(true);
  });
});

describe("analytics", () => {
  beforeEach(() => {
    renderApp("#/analytics");
  });

  const dataRows = () => screen.getAllByRole("row").length - 1; // minus the header row

  it("narrows the performance table when the page filter cycles", () => {
    expect(dataRows()).toBe(6);
    fireEvent.click(screen.getByRole("button", { name: "Page: All pages. Activate to change." }));
    expect(dataRows()).toBe(2); // Nova Cosmetics has a Facebook and an Instagram page
    fireEvent.click(screen.getByRole("button", { name: "Page: Nova Cosmetics. Activate to change." }));
    fireEvent.click(screen.getByRole("button", { name: "Page: Aurora Travel. Activate to change." }));
    // "Helio Energy" is now both the filter label and the only table row.
    expect(within(screen.getByRole("table")).getByText("Helio Energy")).toBeTruthy();
    expect(dataRows()).toBe(1);
  });

  it("applies the network picked on the overview and offers a way to clear it", () => {
    openScreen("overview");
    fireEvent.click(screen.getByText("Instagram"));
    openScreen("analytics");

    expect(dataRows()).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /Instagram only · Clear/ }));
    expect(dataRows()).toBe(6);
    expect(screen.queryByRole("button", { name: /Clear/ })).toBeNull();
  });

  it("explains an empty table instead of leaving it blank", () => {
    openScreen("overview");
    fireEvent.click(screen.getByText("Instagram"));
    openScreen("analytics");
    // Helio Energy only has a Facebook page.
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: /^Page: / }));
    }
    expect(screen.getByText("No page matches these filters.")).toBeTruthy();
  });

  it("switches metric and headline, easing to the new value", () => {
    const tab = screen.getByRole("button", { name: "Response time" });
    fireEvent.click(tab);
    expect(tab.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("First response time")).toBeTruthy();

    tick(700);
    const series = computeSeries({ tab: "Response time", period: "30 d", sentiment: "All", page: "All pages" });
    expect(screen.getByText(formatMetric("Response time", series.at(-1) ?? 0))).toBeTruthy();
  });

  it("shows a tooltip for the week nearest the pointer", () => {
    const plot = document.querySelector<HTMLElement>(".chart__plot")!;
    plot.getBoundingClientRect = () => ({ left: 0, width: 800, top: 0, height: 240, right: 800, bottom: 240, x: 0, y: 0, toJSON: () => ({}) });

    expect(screen.queryByText(/previous period/)).toBeNull();
    fireEvent.mouseMove(plot, { clientX: 400 });
    expect(screen.getByText("WEEK 34")).toBeTruthy();
    expect(screen.getByText(/previous period/)).toBeTruthy();

    fireEvent.mouseLeave(plot);
    expect(screen.queryByText(/previous period/)).toBeNull();
  });
});

describe("users & roles", () => {
  beforeEach(() => {
    renderApp("#/users");
  });

  const rows = () => screen.queryAllByRole("button", { name: /^Open / });

  it("filters members by status and by name or email", () => {
    expect(rows()).toHaveLength(8);

    fireEvent.click(screen.getByRole("button", { name: /^Invited/ }));
    expect(rows()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));

    fireEvent.change(screen.getByLabelText("Filter members by name or email"), { target: { value: "amel" } });
    expect(rows().map((row) => row.getAttribute("aria-label"))).toEqual(["Open Amel Haddad"]);

    fireEvent.change(screen.getByLabelText("Filter members by name or email"), { target: { value: "zzz" } });
    expect(screen.getByText("No member matches this filter.")).toBeTruthy();
  });

  it("edits a member's role and permissions, applying them on save", () => {
    fireEvent.click(screen.getByRole("button", { name: "Open Amel Haddad" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Senior CM" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(dialog).getByRole("button", { name: "Analyst" }));
    const exportSwitch = within(dialog).getByRole("switch", { name: "Export data" });
    expect(exportSwitch.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(exportSwitch);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toastShown("Permissions updated · synced to mobile app")).toBe(true);
    expect(screen.getByRole("button", { name: "Open Amel Haddad" }).textContent).toContain("Analyst");

    // The saved permission is remembered for that member only.
    fireEvent.click(screen.getByRole("button", { name: "Open Amel Haddad" }));
    expect(screen.getByRole("switch", { name: "Export data" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Nadia Belhadj" }));
    expect(screen.getByRole("switch", { name: "Export data" }).getAttribute("aria-checked")).toBe("false");
  });

  it("discards drawer edits that were not saved", () => {
    fireEvent.click(screen.getByRole("button", { name: "Open Lina Moreau" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Analyst" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.getByRole("button", { name: "Open Lina Moreau" }).textContent).toContain("Moderator");
    fireEvent.click(screen.getByRole("button", { name: "Open Lina Moreau" }));
    expect(screen.getByRole("button", { name: "Moderator" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("closes the drawer with Escape and when leaving the screen", () => {
    fireEvent.click(screen.getByRole("button", { name: "Open Sofia Ricci" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Sofia Ricci" }));
    openScreen("pages");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves a suspended member into the Suspended filter", () => {
    fireEvent.click(screen.getByRole("button", { name: "Open Nadia Belhadj" }));
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(toastShown("Account suspended")).toBe(true);

    const suspended = screen.getByRole("button", { name: /^Suspended/ });
    expect(suspended.textContent).toContain("2");
    fireEvent.click(suspended);
    expect(rows().map((row) => row.getAttribute("aria-label"))).toEqual(["Open Nadia Belhadj", "Open Thomas Weber"]);
  });
});

describe("connected pages", () => {
  beforeEach(() => {
    renderApp("#/pages");
  });

  it("toggles auto-reply per page, and keeps it after navigating", () => {
    const aurora = screen.getByRole("switch", { name: "Auto-reply on Aurora Travel (Facebook)" });
    expect(aurora.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(aurora);
    expect(aurora.getAttribute("aria-checked")).toBe("true");

    openScreen("overview");
    openScreen("pages");
    expect(screen.getByRole("switch", { name: "Auto-reply on Aurora Travel (Facebook)" }).getAttribute("aria-checked")).toBe("true");
  });

  it("flags pages that need attention", () => {
    expect(screen.getByText("Rate limited")).toBeTruthy();
    expect(screen.getByText("Attention")).toBeTruthy();
    expect(screen.getByText("Token expires in 6 days — renew")).toBeTruthy();
  });
});

describe("configuration", () => {
  beforeEach(() => {
    renderApp("#/configuration");
  });

  const keywordInput = () => screen.getByLabelText<HTMLInputElement>("New moderation keyword");

  it("adds a keyword, trimmed and lower-cased, and clears the field", () => {
    fireEvent.change(keywordInput(), { target: { value: "  Fraude " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("fraude")).toBeTruthy();
    expect(keywordInput().value).toBe("");
    expect(toastShown("Keyword “fraude” added to the filter")).toBe(true);
  });

  it("ignores blank and duplicate keywords", () => {
    fireEvent.change(keywordInput(), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(keywordInput(), { target: { value: "ARNAQUE" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getAllByText("arnaque")).toHaveLength(1);
    expect(screen.queryAllByRole("status").some((el) => el.textContent?.includes("added to the filter"))).toBe(false);
  });

  it("removes a keyword", () => {
    fireEvent.click(screen.getByRole("button", { name: "Remove keyword boycott" }));
    expect(screen.queryByText("boycott")).toBeNull();
  });

  it("steps service levels by five minutes with a five-minute floor", () => {
    const value = () => screen.getAllByText(/ min$/).map((el) => el.textContent);
    expect(value()).toEqual(["15 min", "45 min", "30 min"]);

    fireEvent.click(screen.getByRole("button", { name: "Increase First response target" }));
    expect(value()[0]).toBe("20 min");

    const decrease = screen.getByRole("button", { name: "Decrease First response target" });
    for (let i = 0; i < 6; i += 1) fireEvent.click(decrease);
    expect(value()[0]).toBe("5 min");
  });
});

describe("shell", () => {
  it("announces the unread notification count", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "7 unread notifications" }));
    expect(toastShown("7 unread admin notifications")).toBe(true);
  });

  it("keeps the document title in step with the screen", () => {
    renderApp();
    expect(document.title).toBe("Platform overview · Pulse");
    openScreen("configuration");
    expect(document.title).toBe("Configuration · Pulse");
  });
});

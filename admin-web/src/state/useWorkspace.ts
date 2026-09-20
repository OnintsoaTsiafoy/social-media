import { useCallback, useState } from "react";

import { PAGE_FILTERS } from "@/data/analytics";
import { CONNECTED_PAGES } from "@/data/pages";
import { DEFAULT_KEYWORDS, DEFAULT_SLA, SLA_MIN, SLA_STEP, type SlaKey } from "@/data/settings";
import type { AnalyticsTab, PageFilter, Period, SentimentFilter } from "@/lib/chart";

/** Analytics filters. Kept above the screen so they survive navigating away and back. */
export function useAnalyticsFilters() {
  const [tab, setTab] = useState<AnalyticsTab>("Engagement");
  const [period, setPeriod] = useState<Period>("30 d");
  const [sentiment, setSentiment] = useState<SentimentFilter>("All");
  const [page, setPage] = useState<PageFilter>("All pages");

  const cyclePage = useCallback(
    () =>
      setPage((current) => {
        const next = (PAGE_FILTERS.indexOf(current) + 1) % PAGE_FILTERS.length;
        return PAGE_FILTERS[next] ?? "All pages";
      }),
    [],
  );

  return { tab, setTab, period, setPeriod, sentiment, setSentiment, page, cyclePage };
}

/** Per-page auto-reply switches. */
export function usePageSettings() {
  const [autoReply, setAutoReply] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CONNECTED_PAGES.map((page) => [page.id, page.autoReply])),
  );

  const toggleAutoReply = useCallback(
    (id: string) => setAutoReply((current) => ({ ...current, [id]: !current[id] })),
    [],
  );

  return { autoReply, toggleAutoReply };
}

/** Workspace configuration: moderation keywords and service levels. */
export function useWorkspaceSettings(say: (message: string) => void) {
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [sla, setSla] = useState(DEFAULT_SLA);

  const addKeyword = useCallback(() => {
    const word = draftKeyword.trim().toLowerCase();
    if (!word || keywords.includes(word)) return;
    setKeywords((list) => [...list, word]);
    setDraftKeyword("");
    say(`Keyword “${word}” added to the filter`);
  }, [draftKeyword, keywords, say]);

  const removeKeyword = useCallback(
    (word: string) => setKeywords((list) => list.filter((entry) => entry !== word)),
    [],
  );

  const stepSla = useCallback(
    (key: SlaKey, direction: 1 | -1) =>
      setSla((current) => ({
        ...current,
        [key]: Math.max(SLA_MIN, current[key] + direction * SLA_STEP),
      })),
    [],
  );

  return { keywords, draftKeyword, setDraftKeyword, addKeyword, removeKeyword, sla, stepSla };
}

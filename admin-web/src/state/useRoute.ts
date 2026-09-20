import { useEffect, useRef, useState } from "react";

import type { ScreenId } from "@/types";

export const SCREENS: ScreenId[] = ["overview", "supervision", "analytics", "users", "pages", "configuration"];

/** How long the skeleton shows while a screen "loads" (mirrors the design). */
export const SKELETON_MS = 520;

export function screenFromHash(hash: string): ScreenId {
  const id = hash.replace(/^#\/?/, "");
  return SCREENS.find((screen) => screen === id) ?? "overview";
}

export function hrefFor(screen: ScreenId): string {
  return `#/${screen}`;
}

/**
 * Hash-based routing: the URL survives a reload and the browser's back button works,
 * with no router dependency. Switching screens flashes the skeleton for `SKELETON_MS`.
 */
export function useRoute(): { screen: ScreenId; loading: boolean } {
  const [screen, setScreen] = useState<ScreenId>(() => screenFromHash(window.location.hash));
  const [loading, setLoading] = useState(false);
  const current = useRef(screen);
  const timer = useRef(0);

  useEffect(() => {
    const onHashChange = () => {
      const next = screenFromHash(window.location.hash);
      if (next === current.current) return;
      current.current = next;
      setScreen(next);
      setLoading(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setLoading(false), SKELETON_MS);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.clearTimeout(timer.current);
    };
  }, []);

  return { screen, loading };
}

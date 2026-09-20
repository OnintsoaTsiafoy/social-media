import { useEffect, useState } from "react";

import type { ScreenId } from "@/types";

export const SCREENS: ScreenId[] = ["overview", "supervision", "analytics", "users", "pages", "configuration"];

export function screenFromHash(hash: string): ScreenId {
  // Le retour de Facebook ajoute une requête au fragment (`#/pages?status=select&…`).
  const id = hash.replace(/^#\/?/, "").split("?")[0] ?? "";
  return SCREENS.find((screen) => screen === id) ?? "overview";
}

export function hrefFor(screen: ScreenId): string {
  return `#/${screen}`;
}

/**
 * Hash-based routing: the URL survives a reload and the browser's back button works,
 * with no router dependency. Each screen shows its own loading skeleton while its data loads.
 */
export function useRoute(): { screen: ScreenId } {
  const [screen, setScreen] = useState<ScreenId>(() => screenFromHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setScreen(screenFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return { screen };
}

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { clearSession } from "@/api/session";

beforeEach(() => {
  // jsdom n'a pas matchMedia. Les tests demandent « moins d'animations » : les chiffres et
  // les courbes s'affichent directement, sans attendre l'animation d'entrée.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  clearSession(false);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = "";
  document.documentElement.lang = "";
  vi.unstubAllGlobals();
});

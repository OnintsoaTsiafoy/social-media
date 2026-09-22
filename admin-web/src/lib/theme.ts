import { useSyncExternalStore } from "react";

/**
 * Thème de la console : clair, sombre ou celui du système.
 *
 * Le thème résolu est posé sur <html data-theme="…"> ; tokens.css porte les deux
 * jeux de couleurs. index.html applique le même calcul avant le premier rendu
 * pour éviter un flash du mauvais thème — garder les deux en accord.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ColorScheme = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

export const THEME_STORAGE_KEY = "hootly.admin.theme";

const THEME_COLOR: Record<ColorScheme, string> = { light: "#000A14", dark: "#020509" };

const listeners = new Set<() => void>();
let preference: ThemePreference = readStoredPreference();

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_PREFERENCES.find((value) => value === stored) ?? "system";
  } catch {
    // Stockage indisponible : on suit le système.
    return "system";
  }
}

function systemScheme(): ColorScheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveScheme(value: ThemePreference): ColorScheme {
  return value === "system" ? systemScheme() : value;
}

function apply(): void {
  const scheme = resolveScheme(preference);
  document.documentElement.dataset.theme = scheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[scheme]);
  listeners.forEach((listener) => listener());
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Le choix reste valable pour la session en cours.
  }
  apply();
}

/** À appeler une fois au démarrage : applique le thème et suit les changements du système. */
export function initTheme(): void {
  apply();
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (preference === "system") apply();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => preference);
}

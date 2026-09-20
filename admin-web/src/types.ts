import type { NetworkFilter } from "@/api/types";

export type ScreenId =
  | "overview"
  | "supervision"
  | "analytics"
  | "users"
  | "pages"
  | "configuration";

/** Filtre de réseau partagé par le flux en direct, les escalades et le tableau d'analytique. */
export type NetFilter = NetworkFilter;

/**
 * Colour pair applied through `data-tone` (see `styles/tokens.css`). Every badge,
 * chip and tag in the console takes its background/foreground from one of these.
 */
export type Tone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "muted"
  | "body"
  | "lime"
  | "fb"
  | "ig";

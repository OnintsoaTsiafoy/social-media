export type ScreenId =
  | "overview"
  | "supervision"
  | "analytics"
  | "users"
  | "pages"
  | "configuration";

export type NetworkCode = "FB" | "IG";
/** Network filter shared by the overview live stream and the analytics table. */
export type NetFilter = "all" | "fb" | "ig";

export type SentimentLabel = "Positive" | "Neutral" | "Negative";

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

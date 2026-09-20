import type { CSSProperties } from "react";

/** Staggers an entrance animation: the stylesheet reads it as `var(--delay)`. */
export function delay(ms: number): CSSProperties {
  return { "--delay": `${ms}ms` } as CSSProperties;
}

/** Minimum track width for a `.grid-auto` container (columns wrap as the viewport narrows). */
export function columns(minPx: number): CSSProperties {
  return { "--min": `${minPx}px` } as CSSProperties;
}

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

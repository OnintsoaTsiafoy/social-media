const integer = new Intl.NumberFormat("fr-FR");

/** fr-FR groups thousands with a narrow no-break space; widen it to a regular no-break space. */
const NARROW_NO_BREAK_SPACE = String.fromCharCode(0x202f);
const NO_BREAK_SPACE = String.fromCharCode(0x00a0);

/** 12480 becomes "12 480" (grouped with a no-break space), so a figure never wraps mid-number. */
export function formatInt(value: number): string {
  return integer.format(Math.round(value)).replaceAll(NARROW_NO_BREAK_SPACE, NO_BREAK_SPACE);
}

/** 188 → "3m 08s". Seconds are always two digits and never roll over to "60s". */
export function formatDuration(totalSeconds: number): string {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** "Sunday, 20 September 2026" — the overview header follows the real clock. */
export function formatLongDate(date: Date): string {
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
  const rest = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `${weekday}, ${rest}`;
}

/** The `count` days ending on `end` (inclusive), oldest first, with a short weekday name. */
export function recentDays(count: number, end: Date): Array<{ weekday: string; day: number }> {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (count - 1 - i));
    return { weekday: date.toLocaleDateString("en-US", { weekday: "short" }), day: date.getDate() };
  });
}

export function initialsOf(fullName: string): string {
  return fullName
    .split(" ")
    .map((word) => word[0] ?? "")
    .join("");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

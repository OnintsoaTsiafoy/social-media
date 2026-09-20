export type Locale = "fr" | "en";

export const LOCALES: readonly Locale[] = ["fr", "en"];
/** Langue principale : celle de l'interface tant que l'utilisateur n'en a pas choisi une autre. */
export const DEFAULT_LOCALE: Locale = "fr";

const INTL_TAG: Record<Locale, string> = { fr: "fr-FR", en: "en-GB" };

/** fr-FR sépare les milliers par une espace fine insécable ; on la remplace par une insécable ordinaire. */
const NARROW_NO_BREAK_SPACE = String.fromCharCode(0x202f);
const NO_BREAK_SPACE = String.fromCharCode(0x00a0);
const widen = (text: string) => text.replaceAll(NARROW_NO_BREAK_SPACE, NO_BREAK_SPACE);

export function intlTag(locale: Locale): string {
  return INTL_TAG[locale];
}

/** 12480 devient « 12 480 » (insécable) : un chiffre ne se coupe jamais en fin de ligne. */
export function formatInt(locale: Locale, value: number): string {
  return widen(new Intl.NumberFormat(INTL_TAG[locale]).format(Math.round(value)));
}

export function formatDecimal(locale: Locale, value: number, digits = 1): string {
  return widen(
    new Intl.NumberFormat(INTL_TAG[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value),
  );
}

/** Rapport 0–1 → « 68,4 % » (fr) / « 68.4% » (en). */
export function formatPercent(locale: Locale, ratio: number, digits = 1): string {
  const number = formatDecimal(locale, ratio * 100, digits);
  return locale === "fr" ? `${number}${NO_BREAK_SPACE}%` : `${number}%`;
}

/** Pourcentage déjà exprimé en points (0–100), sans décimale : « 82 % ». */
export function formatPoints(locale: Locale, points: number): string {
  const number = formatInt(locale, points);
  return locale === "fr" ? `${number}${NO_BREAK_SPACE}%` : `${number}%`;
}

/**
 * 188 → « 3 min 08 s » (fr) / « 3m 08s » (en). Les secondes ont toujours deux chiffres et
 * ne passent jamais à « 60 s » ; au-delà d'une heure : « 1 h 05 min » / « 1h 05m ».
 */
export function formatDuration(locale: Locale, totalSeconds: number): string {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  if (hours > 0) {
    return locale === "fr" ? `${hours} h ${pad(minutes)} min` : `${hours}h ${pad(minutes)}m`;
  }
  return locale === "fr" ? `${minutes} min ${pad(seconds)} s` : `${minutes}m ${pad(seconds)}s`;
}

/** « dimanche 20 septembre 2026 » : l'en-tête de la vue d'ensemble suit l'horloge. */
export function formatLongDate(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** « 20 sept. » : axes des graphiques. */
export function formatShortDate(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], { day: "numeric", month: "short" }).format(date);
}

export function formatWeekday(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], { weekday: "short" }).format(date);
}

/** « 20 sept. · 14:02 » : lignes du journal d'audit. */
export function formatDateTime(locale: Locale, date: Date): string {
  const day = formatShortDate(locale, date);
  const time = new Intl.DateTimeFormat(INTL_TAG[locale], { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${day} · ${time}`;
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** « il y a 2 min » / « 2 minutes ago ». En dessous de 45 s : « à l'instant ». */
export function formatRelative(locale: Locale, date: Date, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(INTL_TAG[locale], { numeric: "auto", style: "short" });
  if (Math.abs(seconds) < 45) return formatter.format(0, "second");

  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(Math.round(seconds / 60), "minute");
}

export function initialsOf(fullName: string): string {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

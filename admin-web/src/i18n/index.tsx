import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { en } from "./en";
import { fr, type MessageCatalog } from "./fr";
import {
  DEFAULT_LOCALE,
  LOCALES,
  formatDateTime,
  formatDecimal,
  formatDuration,
  formatInt,
  formatLongDate,
  formatPercent,
  formatPoints,
  formatRelative,
  formatShortDate,
  formatWeekday,
  intlTag,
  type Locale,
} from "./format";

export { DEFAULT_LOCALE, LOCALES, type Locale };

type CatalogKey = keyof MessageCatalog;
type PluralSuffix = "_one" | "_other";
type PluralBase<K> = K extends `${infer Base}${PluralSuffix}` ? Base : never;

/** Toute clé du catalogue ; pour un pluriel, la clé de base (`nav.queue`) suffit. */
export type MessageKey = Exclude<CatalogKey, `${string}${PluralSuffix}`> | PluralBase<CatalogKey>;
export type MessageParams = Record<string, string | number>;

const CATALOGS: Record<Locale, Readonly<Record<string, string>>> = { fr, en };
const STORAGE_KEY = "pulse.locale";

const NO_BREAK_SPACE = String.fromCharCode(0x00a0);

/** Typographie française : insécable avant `: ; ? ! %` et à l'intérieur des guillemets. */
export function frenchSpacing(text: string): string {
  return text.replace(/ ([:;?!%»])/g, `${NO_BREAK_SPACE}$1`).replace(/(«) /g, `$1${NO_BREAK_SPACE}`);
}

function formatParam(locale: Locale, value: string | number): string {
  if (typeof value === "string") return value;
  return Number.isInteger(value) ? formatInt(locale, value) : formatDecimal(locale, value, 1);
}

/**
 * Traduit une clé. Repli : catalogue de la langue → français → la clé elle-même (visible en
 * développement, jamais un écran vide). `count` choisit la forme plurielle de la langue.
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const catalogs = [CATALOGS[locale], CATALOGS.fr];
  const count = typeof params?.count === "number" ? params.count : null;
  const plural = count === null ? null : new Intl.PluralRules(intlTag(locale)).select(count) === "one" ? "_one" : "_other";

  let template: string | undefined;
  for (const catalog of catalogs) {
    template = (plural ? catalog[`${key}${plural}`] : undefined) ?? catalog[key];
    if (template !== undefined) break;
  }
  if (template === undefined) return key;

  const filled = template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params?.[name];
    return value === undefined ? placeholder : formatParam(locale, value);
  });
  return locale === "fr" ? frenchSpacing(filled) : filled;
}

export type Translate = (key: MessageKey, params?: MessageParams) => string;

export interface Formatters {
  int: (value: number) => string;
  decimal: (value: number, digits?: number) => string;
  /** Rapport 0–1 → « 68,4 % ». */
  percent: (ratio: number, digits?: number) => string;
  /** Points 0–100 → « 82 % ». */
  points: (points: number) => string;
  duration: (seconds: number) => string;
  longDate: (date: Date) => string;
  shortDate: (date: Date) => string;
  weekday: (date: Date) => string;
  dateTime: (date: Date) => string;
  relative: (date: Date, now?: Date) => string;
}

function formattersFor(locale: Locale): Formatters {
  return {
    int: (value) => formatInt(locale, value),
    decimal: (value, digits) => formatDecimal(locale, value, digits),
    percent: (ratio, digits) => formatPercent(locale, ratio, digits),
    points: (points) => formatPoints(locale, points),
    duration: (seconds) => formatDuration(locale, seconds),
    longDate: (date) => formatLongDate(locale, date),
    shortDate: (date) => formatShortDate(locale, date),
    weekday: (date) => formatWeekday(locale, date),
    dateTime: (date) => formatDateTime(locale, date),
    relative: (date, now) => formatRelative(locale, date, now),
  };
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  format: Formatters;
}

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return LOCALES.find((locale) => locale === stored) ?? DEFAULT_LOCALE;
  } catch {
    // Stockage indisponible (navigation privée, politique du navigateur) : langue principale.
    return DEFAULT_LOCALE;
  }
}

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? readStoredLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Le choix reste valable pour la session en cours.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      format: formattersFor(locale),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}

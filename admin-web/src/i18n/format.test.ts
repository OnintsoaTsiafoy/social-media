import { describe, expect, it } from "vitest";

import {
  clamp,
  formatDateTime,
  formatDecimal,
  formatDuration,
  formatInt,
  formatLongDate,
  formatPercent,
  formatPoints,
  formatRelative,
  initialsOf,
} from "./format";

const NBSP = " ";

describe("formatInt", () => {
  it("groupe les milliers avec une espace insécable", () => {
    expect(formatInt("fr", 12480)).toBe(`12${NBSP}480`);
    expect(formatInt("fr", 999)).toBe("999");
    expect(formatInt("fr", 1_284_000)).toBe(`1${NBSP}284${NBSP}000`);
  });

  it("arrondit et suit la langue", () => {
    expect(formatInt("fr", 12.6)).toBe("13");
    expect(formatInt("en", 12480)).toBe("12,480");
  });
});

describe("formatDecimal / formatPercent / formatPoints", () => {
  it("met la virgule décimale française et l'espace avant %", () => {
    expect(formatDecimal("fr", 68.4)).toBe("68,4");
    expect(formatPercent("fr", 0.684)).toBe(`68,4${NBSP}%`);
    expect(formatPoints("fr", 82)).toBe(`82${NBSP}%`);
  });

  it("colle le % en anglais", () => {
    expect(formatPercent("en", 0.684)).toBe("68.4%");
    expect(formatPoints("en", 82)).toBe("82%");
  });

  it("respecte le nombre de décimales demandé", () => {
    expect(formatPercent("fr", 0.5, 0)).toBe(`50${NBSP}%`);
    expect(formatDecimal("fr", 1.2, 2)).toBe("1,20");
  });
});

describe("formatDuration", () => {
  it("écrit minutes et secondes sur deux chiffres, sans jamais afficher 60 s", () => {
    expect(formatDuration("fr", 188)).toBe("3 min 08 s");
    expect(formatDuration("fr", 59.6)).toBe("1 min 00 s");
    expect(formatDuration("fr", 0)).toBe("0 min 00 s");
    expect(formatDuration("en", 188)).toBe("3m 08s");
  });

  it("passe en heures au-delà d'une heure", () => {
    expect(formatDuration("fr", 3900)).toBe("1 h 05 min");
    expect(formatDuration("en", 3900)).toBe("1h 05m");
  });

  it("ne descend jamais sous zéro", () => {
    expect(formatDuration("fr", -5)).toBe("0 min 00 s");
  });
});

describe("dates", () => {
  const date = new Date(2026, 8, 20, 14, 2);

  it("écrit la date longue dans la langue", () => {
    expect(formatLongDate("fr", date)).toBe("dimanche 20 septembre 2026");
    // Selon la version d'ICU, l'anglais britannique met ou non une virgule après le jour.
    expect(formatLongDate("en", date)).toMatch(/^Sunday,? 20 September 2026$/);
  });

  it("écrit jour, mois court et heure", () => {
    expect(formatDateTime("fr", date)).toMatch(/^20 sept\.? · 14:02$/);
    expect(formatDateTime("en", date)).toMatch(/^20 Sep\.?t?\.? · 14:02$/);
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it("dit « à l'instant » sous 45 secondes", () => {
    expect(formatRelative("fr", ago(10), now)).toBe("maintenant");
  });

  it("choisit l'unité la plus lisible", () => {
    expect(formatRelative("fr", ago(2 * 60), now)).toMatch(/2\s?min/);
    expect(formatRelative("fr", ago(3 * 3600), now)).toMatch(/3\s?h/);
    expect(formatRelative("fr", ago(2 * 86_400), now)).toMatch(/2\s?j|avant-hier/);
    expect(formatRelative("en", ago(2 * 60), now)).toMatch(/2 min/);
  });
});

describe("initialsOf / clamp", () => {
  it("garde deux initiales en majuscules", () => {
    expect(initialsOf("Nadia Belhadj")).toBe("NB");
    expect(initialsOf("amel haddad ben salah")).toBe("AH");
    expect(initialsOf("Cher")).toBe("C");
    expect(initialsOf("")).toBe("");
  });

  it("borne une valeur", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});

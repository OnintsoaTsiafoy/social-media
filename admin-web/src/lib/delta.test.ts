import { describe, expect, it } from "vitest";

import type { Formatters } from "@/i18n";
import { formatInt, formatPoints } from "@/i18n/format";

import { NO_DELTA, signedDelta } from "./delta";

const format = {
  int: (value: number) => formatInt("fr", value),
  points: (value: number) => formatPoints("fr", value),
} as Formatters;

const NBSP = " ";

describe("signedDelta", () => {
  it("ne fabrique pas d'écart sans référence", () => {
    expect(signedDelta(null, "percent", "up", format)).toBe(NO_DELTA);
    expect(NO_DELTA.text).toBe("—");
  });

  it("donne le signe et la couleur selon le sens souhaité", () => {
    expect(signedDelta(8.2, "percent", "up", format)).toEqual({ text: `+8${NBSP}%`, tone: "success" });
    // Un délai qui baisse est une bonne nouvelle : signe moins typographique, ton positif.
    expect(signedDelta(-18, "percent", "down", format)).toEqual({ text: `−18${NBSP}%`, tone: "success" });
    expect(signedDelta(3, "count", "down", format)).toEqual({ text: "+3", tone: "danger" });
    expect(signedDelta(-4, "percent", "up", format)).toEqual({ text: `−4${NBSP}%`, tone: "danger" });
  });

  it("n'affiche pas de signe pour un écart nul après arrondi", () => {
    expect(signedDelta(0.2, "percent", "up", format)).toEqual({ text: `0${NBSP}%`, tone: "success" });
    expect(signedDelta(0, "count", "down", format)).toEqual({ text: "0", tone: "success" });
  });
});

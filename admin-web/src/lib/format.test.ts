import { describe, expect, it } from "vitest";

import { clamp, formatDuration, formatInt, formatLongDate, initialsOf, recentDays } from "@/lib/format";

const NO_BREAK_SPACE = String.fromCharCode(0x00a0);

describe("formatInt", () => {
  it("groups thousands with a no-break space so figures never wrap", () => {
    expect(formatInt(12480)).toBe(`12${NO_BREAK_SPACE}480`);
    expect(formatInt(1234567)).toBe(`1${NO_BREAK_SPACE}234${NO_BREAK_SPACE}567`);
  });

  it("leaves small numbers alone and rounds fractions", () => {
    expect(formatInt(0)).toBe("0");
    expect(formatInt(999)).toBe("999");
    expect(formatInt(1284.6)).toBe(`1${NO_BREAK_SPACE}285`);
  });
});

describe("formatDuration", () => {
  it("renders minutes and two-digit seconds", () => {
    expect(formatDuration(188)).toBe("3m 08s");
    expect(formatDuration(750)).toBe("12m 30s");
    expect(formatDuration(0)).toBe("0m 00s");
  });

  it("never rolls seconds over to 60", () => {
    expect(formatDuration(59.6)).toBe("1m 00s");
    expect(formatDuration(239.99)).toBe("4m 00s");
  });

  it("clamps negative input to zero", () => {
    expect(formatDuration(-5)).toBe("0m 00s");
  });
});

describe("formatLongDate", () => {
  it("writes weekday, day, month and year", () => {
    expect(formatLongDate(new Date(2026, 8, 20))).toBe("Sunday, 20 September 2026");
  });
});

describe("recentDays", () => {
  it("returns the days ending on the given date, oldest first", () => {
    expect(recentDays(3, new Date(2026, 8, 20))).toEqual([
      { weekday: "Fri", day: 18 },
      { weekday: "Sat", day: 19 },
      { weekday: "Sun", day: 20 },
    ]);
  });

  it("crosses month boundaries", () => {
    expect(recentDays(3, new Date(2026, 9, 1))).toEqual([
      { weekday: "Tue", day: 29 },
      { weekday: "Wed", day: 30 },
      { weekday: "Thu", day: 1 },
    ]);
  });
});

describe("initialsOf / clamp", () => {
  it("takes the first letter of each word", () => {
    expect(initialsOf("Nadia Belhadj")).toBe("NB");
    expect(initialsOf("Karim Saïdi")).toBe("KS");
  });

  it("clamps into range", () => {
    expect(clamp(5, 10, 20)).toBe(10);
    expect(clamp(25, 10, 20)).toBe(20);
    expect(clamp(15, 10, 20)).toBe(15);
  });
});

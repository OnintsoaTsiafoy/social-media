import { describe, expect, it } from "vitest";

import { ANALYTICS_TABS, PAGE_FILTERS, PERIODS, SENTIMENT_FILTERS } from "@/data/analytics";
import {
  computeSeries,
  formatMetric,
  pointIndexAt,
  previousPeriod,
  sparkPoints,
  toAreaPolygon,
  toPolyline,
  trendOf,
  type SeriesFilters,
} from "@/lib/chart";

const base = { period: "30 d", sentiment: "All", page: "All pages" } as const;

describe("computeSeries", () => {
  it("returns ten weekly points that stay inside the plot for every filter combination", () => {
    for (const tab of ANALYTICS_TABS)
      for (const period of PERIODS)
        for (const sentiment of SENTIMENT_FILTERS)
          for (const page of PAGE_FILTERS) {
            const series = computeSeries({ tab, period, sentiment, page });
            expect(series).toHaveLength(10);
            for (const y of series) {
              expect(y).toBeGreaterThanOrEqual(20);
              expect(y).toBeLessThanOrEqual(222);
            }
          }
  });

  it("applies the period, sentiment and page multipliers (first point has no wobble)", () => {
    const first = (overrides: Partial<SeriesFilters>) =>
      computeSeries({ tab: "Engagement", ...base, ...overrides })[0];

    expect(first({})).toBeCloseTo(140);
    expect(first({ sentiment: "Positive" })).toBeCloseTo(112);
    expect(first({ sentiment: "Negative" })).toBeCloseTo(176.4);
    expect(first({ period: "7 d" })).toBeCloseTo(117.6);
    expect(first({ page: "Helio Energy" })).toBeCloseTo(182);
  });

  it("clamps values that the multipliers would push off the chart", () => {
    const series = computeSeries({ tab: "AI performance", period: "90 d", sentiment: "Negative", page: "Helio Energy" });
    expect(Math.max(...series)).toBe(222);
  });
});

describe("previousPeriod", () => {
  it("stays inside the plot", () => {
    for (const y of previousPeriod(computeSeries({ tab: "Sentiment", ...base }))) {
      expect(y).toBeGreaterThanOrEqual(24);
      expect(y).toBeLessThanOrEqual(218);
    }
  });
});

describe("polyline helpers", () => {
  it("spreads points across the 800px width", () => {
    expect(toPolyline([10, 20, 30])).toBe("0,10.0 400,20.0 800,30.0");
  });

  it("closes the area down to the baseline", () => {
    expect(toAreaPolygon([10, 20]).endsWith("800,220 0,220")).toBe(true);
  });

  it("scales a sparkline to its own min and max", () => {
    expect(sparkPoints([0, 10])).toBe("0,28 120,2");
    expect(sparkPoints([5, 5])).toBe("0,28 120,28");
  });
});

describe("formatMetric", () => {
  it("reads response time in minutes and seconds", () => {
    expect(formatMetric("Response time", 22 * 4)).toBe("4m 00s");
    expect(formatMetric("Response time", 22 * 3.5)).toBe("3m 30s");
  });

  it("never prints 60 seconds (regression: the mock-up rounded seconds independently)", () => {
    expect(formatMetric("Response time", 22 * 3.9999)).toBe("4m 00s");
  });

  it("reads the other tabs as percentages", () => {
    expect(formatMetric("Engagement", 240 - 22 * 5)).toBe("5.0%");
    expect(formatMetric("Sentiment", 240 - 2.6 * 50)).toBe("50%");
    expect(formatMetric("AI performance", 240 - 2.6 * 68)).toBe("68%");
  });
});

describe("trendOf", () => {
  it("counts a falling response time as an improvement", () => {
    expect(trendOf("Response time", [162, 100, 70]).improving).toBe(true);
    expect(trendOf("Response time", [70, 100, 162]).improving).toBe(false);
  });

  it("counts a rising metric as an improvement everywhere else", () => {
    // Higher on the plot (smaller y) is worse for these tabs: y drops as the value rises.
    const rising = computeSeries({ tab: "Engagement", ...base });
    expect(trendOf("Engagement", rising).improving).toBe(true);
    expect(trendOf("Engagement", rising).deltaPercent).toBeGreaterThan(0);
    expect(trendOf("Engagement", [...rising].reverse()).improving).toBe(false);
  });
});

describe("pointIndexAt", () => {
  it("snaps a pointer ratio to the nearest weekly point", () => {
    expect(pointIndexAt(0)).toBe(0);
    expect(pointIndexAt(1)).toBe(9);
    expect(pointIndexAt(0.5)).toBe(5);
  });

  it("stays in range when the pointer leaves the plot", () => {
    expect(pointIndexAt(-0.4)).toBe(0);
    expect(pointIndexAt(1.7)).toBe(9);
  });
});

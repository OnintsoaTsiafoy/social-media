import { describe, expect, it } from "vitest";

import { formatMetric } from "@/lib/chart";
import { formatDuration } from "@/i18n/format";
import {
  CHART_BASELINE,
  CHART_TOP,
  CHART_WIDTH,
  hasData,
  layoutSeries,
  pointIndexAt,
  sparkPoints,
  toAreaPolygon,
  toPolyline,
  trendOf,
  xAt,
} from "./chart";

describe("layoutSeries", () => {
  it("place le plus haut relevé sous le plafond et zéro sur la ligne de base", () => {
    const { current } = layoutSeries([0, 50, 100], [10, 10, 10]);
    expect(current[0]?.y).toBe(CHART_BASELINE);
    // Le plafond est 115 % du plus haut relevé : 100 % reste sous le haut du cadre.
    expect(current[2]?.y).toBeGreaterThan(CHART_TOP);
    expect(current[2]?.y).toBeLessThan(current[1]?.y ?? 0);
  });

  it("garde les trous : une période sans donnée n'est pas ramenée à zéro", () => {
    const { current } = layoutSeries([10, null, 30], [null, null, null]);
    expect(current[1]).toBeNull();
    expect(current[0]?.value).toBe(10);
  });

  it("met la courbe précédente à la même échelle que la courante", () => {
    const { current, previous } = layoutSeries([40], [40]);
    expect(previous[0]?.y).toBe(current[0]?.y);
  });

  it("ne divise pas par zéro quand tout vaut zéro ou que rien n'est connu", () => {
    const zero = layoutSeries([0, 0], [0, 0]);
    expect(zero.current.every((point) => point?.y === CHART_BASELINE)).toBe(true);
    const none = layoutSeries([null, null], [null]);
    expect(none.current).toEqual([null, null]);
  });
});

describe("tracé", () => {
  it("répartit les points sur toute la largeur", () => {
    expect(xAt(0, 5)).toBe(0);
    expect(xAt(4, 5)).toBe(CHART_WIDTH);
    expect(xAt(0, 1)).toBe(CHART_WIDTH / 2);
  });

  it("saute les trous dans la polyligne", () => {
    const { current } = layoutSeries([10, null, 30], [null, null, null]);
    expect(toPolyline(current).split(" ")).toHaveLength(2);
  });

  it("ne dessine une aire que pour deux points ou plus, fermée sur la ligne de base", () => {
    const one = layoutSeries([10], [null]).current;
    expect(toAreaPolygon(one)).toBe("");
    const two = layoutSeries([10, 20], [null, null]).current;
    const polygon = toAreaPolygon(two).split(" ");
    expect(polygon).toHaveLength(4);
    expect(polygon[2]).toBe(`${CHART_WIDTH.toFixed(1)},${CHART_BASELINE}`);
    expect(polygon[3]).toBe(`0.0,${CHART_BASELINE}`);
  });

  it("ramène la position du curseur au point le plus proche", () => {
    expect(pointIndexAt(0, 10)).toBe(0);
    expect(pointIndexAt(1, 10)).toBe(9);
    expect(pointIndexAt(0.5, 10)).toBe(5);
    expect(pointIndexAt(2, 10)).toBe(9);
    expect(pointIndexAt(-1, 10)).toBe(0);
    expect(pointIndexAt(0.5, 1)).toBe(0);
  });

  it("détecte l'absence totale de donnée", () => {
    expect(hasData([null, null])).toBe(false);
    expect(hasData([null, 0])).toBe(true);
  });
});

describe("sparkPoints", () => {
  it("met à l'échelle sur le min et le max de la série", () => {
    const points = sparkPoints([0, 5, 10]).split(" ");
    expect(points[0]).toBe("0,28");
    expect(points[2]).toBe("120,2");
  });

  it("saute les trous et renvoie une chaîne vide sans donnée", () => {
    expect(sparkPoints([null, null])).toBe("");
    expect(sparkPoints([1, null, 3]).split(" ")).toHaveLength(2);
  });

  it("dessine une ligne plate quand toutes les valeurs sont égales", () => {
    const points = sparkPoints([4, 4, 4]).split(" ");
    expect(new Set(points.map((point) => point.split(",")[1])).size).toBe(1);
  });
});

describe("trendOf", () => {
  it("ne fabrique pas de tendance sans période de référence", () => {
    expect(trendOf("engagement", { value: 0.1, previousValue: null, deltaPercent: null })).toBeNull();
  });

  it("une hausse est une amélioration, sauf pour le temps de réponse", () => {
    expect(trendOf("engagement", { value: 1, previousValue: 0.5, deltaPercent: 100 })).toEqual({ improving: true, deltaPercent: 100 });
    expect(trendOf("sentiment", { value: 0.4, previousValue: 0.5, deltaPercent: -20 })).toEqual({ improving: false, deltaPercent: 20 });
    expect(trendOf("response_time", { value: 100, previousValue: 200, deltaPercent: -50 })).toEqual({ improving: true, deltaPercent: 50 });
    expect(trendOf("response_time", { value: 300, previousValue: 200, deltaPercent: 50 })).toEqual({ improving: false, deltaPercent: 50 });
  });
});

describe("formatMetric", () => {
  const format = {
    percent: (ratio: number, digits = 1) => `${(ratio * 100).toFixed(digits)}%`,
    duration: (seconds: number) => formatDuration("fr", seconds),
  } as Parameters<typeof formatMetric>[2];

  it("écrit un taux d'engagement avec une décimale, les autres taux sans", () => {
    expect(formatMetric("engagement", 0.0731, format)).toBe("7.3%");
    expect(formatMetric("sentiment", 0.6, format)).toBe("60%");
    expect(formatMetric("ai_performance", 0.684, format)).toBe("68%");
  });

  it("écrit un délai en minutes et secondes", () => {
    expect(formatMetric("response_time", 188, format)).toBe("3 min 08 s");
  });
});

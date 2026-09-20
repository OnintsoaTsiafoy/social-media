import { describe, expect, it } from "vitest";

import { translate, type Formatters, type Translate } from "@/i18n";
import { formatDuration, formatInt, formatLongDate, formatPercent } from "@/i18n/format";
import { OVERVIEW } from "@/test/fixtures";

import { buildReportCsv, reportFileName } from "./report";

const t: Translate = (key, params) => translate("fr", key, params);
const format = {
  int: (value: number) => formatInt("fr", value),
  percent: (ratio: number, digits?: number) => formatPercent("fr", ratio, digits),
  duration: (seconds: number) => formatDuration("fr", seconds),
  longDate: (date: Date) => formatLongDate("fr", date),
} as Formatters;

describe("buildReportCsv", () => {
  const csv = buildReportCsv(OVERVIEW, t, format, new Date(2026, 8, 20));
  const lines = csv.split("\r\n");

  it("commence par le titre et la date, en français", () => {
    expect(lines[0]).toBe("Vue d'ensemble de la plateforme;dimanche 20 septembre 2026");
    expect(lines[1]).toBe("7 derniers jours;Tous les réseaux");
  });

  it("reprend les indicateurs de l'écran", () => {
    expect(csv).toContain("Commentaires analysés;1 284");
    expect(csv).toContain("1re réponse (médiane);4 min 12 s");
    expect(csv).toContain("Résolus par l'IA;68,4 %");
    expect(csv).toContain("Escalades ouvertes;4");
  });

  it("écrit « Non disponible » quand une mesure manque, jamais 0", () => {
    const missing = buildReportCsv(
      { ...OVERVIEW, kpis: { ...OVERVIEW.kpis, firstResponse: { ...OVERVIEW.kpis.firstResponse, medianSeconds: null } } },
      t,
      format,
    );
    expect(missing).toContain("1re réponse (médiane);Non disponible");
  });

  it("détaille le volume quotidien avec les comptes bruts", () => {
    const first = OVERVIEW.daily[0];
    expect(lines).toContain(`${first?.date};${first?.positive};${first?.neutral};${first?.negative}`);
    expect(lines.filter((line) => /^\d{4}-\d{2}-\d{2};/.test(line))).toHaveLength(14);
  });

  it("met entre guillemets une cellule qui contient le séparateur", () => {
    const tricky = buildReportCsv(OVERVIEW, (key, params) => (key === "kpi.processed.label" ? 'A;"B"' : t(key, params)), format);
    expect(tricky).toContain('"A;""B""";1 284');
  });
});

describe("reportFileName", () => {
  it("date le fichier et le nomme dans la langue courante", () => {
    expect(reportFileName(t, new Date("2026-09-20T10:00:00Z"))).toBe("rapport-plateforme-2026-09-20.csv");
    expect(reportFileName((key, params) => translate("en", key, params), new Date("2026-09-20T10:00:00Z"))).toBe(
      "platform-report-2026-09-20.csv",
    );
  });
});

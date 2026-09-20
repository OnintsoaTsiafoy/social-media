import type { Overview } from "@/api/types";
import type { Formatters, Translate } from "@/i18n";

/** Une cellule CSV : entre guillemets dès qu'elle contient un séparateur, un guillemet ou un saut de ligne. */
function cell(value: string | number): string {
  const text = String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const row = (...cells: Array<string | number>) => cells.map(cell).join(";");

/**
 * Rapport CSV de la vue d'ensemble, tel que l'écran le montre (mêmes indicateurs, même période).
 * Séparateur `;` : c'est celui qu'attend un tableur en français.
 */
export function buildReportCsv(overview: Overview, t: Translate, format: Formatters, now: Date = new Date()): string {
  const { kpis, sentiment, daily } = overview;
  const unavailable = t("common.unavailable");
  const lines: string[] = [
    row(t("screen.overview"), format.longDate(now)),
    row(t(`overview.range.${overview.period}`), t(`network.${overview.network}`)),
    "",
    row(t("report.section.kpis")),
    row(t("report.column.indicator"), t("report.column.value")),
    row(t("kpi.processed.label"), format.int(kpis.processed.value)),
    row(
      t("kpi.firstResponse.label"),
      kpis.firstResponse.medianSeconds === null ? unavailable : format.duration(kpis.firstResponse.medianSeconds),
    ),
    row(t("kpi.aiResolved.label"), kpis.aiResolved.rate === null ? unavailable : format.percent(kpis.aiResolved.rate, 1)),
    row(t("kpi.escalations.label"), format.int(kpis.escalations.open)),
    "",
    row(t("report.section.sentiment")),
    row(t("sentiment.positive"), sentiment.positive),
    row(t("sentiment.neutral"), sentiment.neutral),
    row(t("sentiment.negative"), sentiment.negative),
    "",
    row(t("report.section.daily")),
    row(t("report.column.date"), t("sentiment.positive"), t("sentiment.neutral"), t("sentiment.negative")),
    ...daily.map((day) => row(day.date, day.positive, day.neutral, day.negative)),
  ];
  return lines.join("\r\n");
}

/** Nom de fichier daté : `rapport-plateforme-2026-09-20.csv`. */
export function reportFileName(t: Translate, now: Date = new Date()): string {
  return `${t("report.filename")}-${now.toISOString().slice(0, 10)}.csv`;
}

/** Télécharge `content` (avec BOM UTF-8 : Excel y reconnaît les accents). */
export function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

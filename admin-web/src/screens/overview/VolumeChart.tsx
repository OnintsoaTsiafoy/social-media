import { useMemo, useState, type CSSProperties } from "react";

import type { DailyVolume } from "@/api/types";
import { useI18n } from "@/i18n";
import { delay } from "@/lib/css";

/** Height in px of the tallest stacked bar. */
const BAR_AREA = 168;

const swatch = (color: string) => ({ "--swatch": color }) as CSSProperties;

interface DayColumn extends DailyVolume {
  /** « sam. 20 » : titre de l'infobulle. */
  full: string;
  weekday: string;
  /** « S20 » : étiquette de l'axe. */
  label: string;
  total: number;
}

export function VolumeChart({ daily, progress }: { daily: DailyVolume[]; progress: number }) {
  const { t, format } = useI18n();
  const [active, setActive] = useState<number | null>(null);

  const columns = useMemo<DayColumn[]>(
    () =>
      daily.map((day) => {
        // AAAA-MM-JJ est un jour civil : on le construit à midi, sans dépendre du fuseau du navigateur.
        const [year = 0, month = 1, dayOfMonth = 1] = day.date.split("-").map(Number);
        const date = new Date(year, month - 1, dayOfMonth, 12);
        const weekday = format.weekday(date);
        return {
          ...day,
          weekday,
          full: `${weekday} ${dayOfMonth}`,
          label: `${weekday.charAt(0).toUpperCase()}${dayOfMonth}`,
          total: day.positive + day.neutral + day.negative,
        };
      }),
    [daily, format],
  );

  const grandTotal = columns.reduce((sum, column) => sum + column.total, 0);
  const negativeTotal = columns.reduce((sum, column) => sum + column.negative, 0);
  const tallest = Math.max(1, ...columns.map((column) => column.total));
  const scale = BAR_AREA / tallest;
  const peak = columns.reduce<DayColumn | null>((best, column) => (!best || column.total > best.total ? column : best), null);
  const hovered = active === null ? null : (columns[active] ?? null);

  return (
    <div className="card card--pad span-2 rise" style={delay(60)}>
      <div className="volume__head">
        <div>
          <div className="card__title">{t("volume.title")}</div>
          <div className="card__sub">{t("volume.subtitle")}</div>
        </div>
        <div className="legend">
          <span className="legend__item"><i className="swatch" style={swatch("var(--lime)")} />{t("sentiment.positive")}</span>
          <span className="legend__item"><i className="swatch" style={swatch("var(--border-strong)")} />{t("sentiment.neutral")}</span>
          <span className="legend__item"><i className="swatch" style={swatch("var(--danger)")} />{t("sentiment.negative")}</span>
        </div>
      </div>

      {grandTotal === 0 ? (
        <div className="empty">{t("volume.empty")}</div>
      ) : (
        <div className="bars" onMouseLeave={() => setActive(null)}>
          {columns.map((column, i) => (
            <div
              key={column.date}
              className="bars__col"
              data-dim={active !== null && active !== i}
              style={delay(i * 35)}
              tabIndex={0}
              aria-label={t("volume.bar.aria", {
                date: column.full,
                positive: column.positive,
                neutral: column.neutral,
                negative: column.negative,
              })}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <div className="bars__seg bars__seg--neg" style={{ height: Math.round(column.negative * scale) }} />
              <div className="bars__seg bars__seg--neu" style={{ height: Math.round(column.neutral * scale) }} />
              <div className="bars__seg bars__seg--pos" style={{ height: Math.round(column.positive * scale) }} />
              <div className="bars__label">{column.label}</div>
            </div>
          ))}
          {hovered && active !== null && (
            <div className="tip" style={{ left: `${((active + 0.5) / columns.length) * 100}%` }}>
              <div className="tip__title">{hovered.full}</div>
              <div>
                {t("sentiment.positive")} <b>{format.int(hovered.positive)}</b> · {t("sentiment.neutral")}{" "}
                <b>{format.int(hovered.neutral)}</b> · {t("sentiment.negative")} <b>{format.int(hovered.negative)}</b>
              </div>
            </div>
          )}
        </div>
      )}

      {grandTotal > 0 && peak && (
        <div className="totals">
          <div>
            <div className="totals__label">{t("volume.total")}</div>
            <div className="totals__value">{format.int(grandTotal * progress)}</div>
          </div>
          <div>
            <div className="totals__label">{t("volume.peak")}</div>
            <div className="totals__value">
              {peak.weekday} · {format.int(peak.total)}
            </div>
          </div>
          <div>
            <div className="totals__label">{t("volume.negativeShare")}</div>
            <div className="totals__value" style={{ color: "var(--danger-text)" }}>
              {format.percent(negativeTotal / grandTotal, 1)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

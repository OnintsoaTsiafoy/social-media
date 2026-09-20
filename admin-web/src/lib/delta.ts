import type { Formatters } from "@/i18n";
import type { Tone } from "@/types";

const MINUS = "\u2212";

export interface Delta {
  text: string;
  tone: Extract<Tone, "success" | "danger" | "muted">;
}

/** Aucune référence comparable : jamais un « +100 % » fabriqué à partir de rien. */
export const NO_DELTA: Delta = { text: "—", tone: "muted" };

/**
 * Écart signé (« +8 % », « −18 % », « +3 »). `goodWhen` dit dans quel sens l'écart est une bonne
 * nouvelle : plus de commentaires traités, oui ; plus d'escalades ouvertes, non.
 */
export function signedDelta(
  value: number | null,
  unit: "percent" | "count",
  goodWhen: "up" | "down",
  format: Formatters,
): Delta {
  if (value === null) return NO_DELTA;
  const rounded = Math.round(value);
  if (rounded === 0) return { text: unit === "percent" ? format.points(0) : "0", tone: "success" };

  const sign = rounded > 0 ? "+" : MINUS;
  const magnitude = Math.abs(rounded);
  const text = `${sign}${unit === "percent" ? format.points(magnitude) : format.int(magnitude)}`;
  const good = goodWhen === "up" ? rounded > 0 : rounded < 0;
  return { text, tone: good ? "success" : "danger" };
}

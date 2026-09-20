import type { Tone } from "@/types";

export const DEFAULT_KEYWORDS = ["remboursement", "arnaque", "scandale", "avocat", "boycott", "plainte"];

export type SlaKey = "first" | "escalation" | "night";

export const SLA_DEFS: Array<{ key: SlaKey; label: string; description: string }> = [
  { key: "first", label: "First response target", description: "Maximum delay before any reply" },
  { key: "escalation", label: "Escalation timeout", description: "Unanswered comments go to an admin" },
  { key: "night", label: "Night mode window", description: "Auto-reply only, from 22h" },
];

export const DEFAULT_SLA: Record<SlaKey, number> = { first: 15, escalation: 45, night: 30 };
export const SLA_STEP = 5;
export const SLA_MIN = 5;

export type AuditKind = "ROLE" | "AI" | "PAGE" | "USER" | "RULE";

export const AUDIT_TRAIL: Array<{ time: string; kind: AuditKind; text: string; who: string }> = [
  { time: "20 Sep · 14:02", kind: "ROLE", text: "Amel Haddad promoted to Senior CM", who: "Amine R." },
  { time: "20 Sep · 11:47", kind: "AI", text: "Autonomy threshold raised 78% → 82%", who: "Amine R." },
  { time: "20 Sep · 09:15", kind: "PAGE", text: "Maison Verte connected via Business Manager", who: "Amine R." },
  { time: "19 Sep · 18:33", kind: "USER", text: "Thomas Weber suspended after policy review", who: "Sofia R." },
  { time: "19 Sep · 16:04", kind: "RULE", text: "Keyword “boycott” added to moderation filter", who: "Amine R." },
];

export const AUDIT_TONE: Record<AuditKind, Tone> = {
  ROLE: "body",
  AI: "lime",
  PAGE: "fb",
  USER: "danger",
  RULE: "body",
};

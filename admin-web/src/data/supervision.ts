import type { NetworkCode, SentimentLabel, Tone } from "@/types";

export interface QueueItem {
  id: string;
  net: NetworkCode;
  page: string;
  ago: string;
  sentiment: SentimentLabel;
  author: string;
  /** Model confidence, 0–100. At or above the autonomy threshold the draft is sent unreviewed. */
  confidence: number;
  comment: string;
  draft: string;
}

export const QUEUE_ITEMS: QueueItem[] = [
  {
    id: "q1", net: "FB", page: "Nova Cosmetics", ago: "2 min ago", sentiment: "Negative", author: "Claire D.", confidence: 71,
    comment: "Troisième commande abîmée, personne ne répond depuis une semaine. C'est inadmissible.",
    draft: "Bonjour Claire, nous sommes navrés pour ces trois commandes. Je transmets votre dossier à notre équipe logistique en priorité et vous recevez un suivi sous 24 h en message privé.",
  },
  {
    id: "q2", net: "IG", page: "Aurora Travel IG", ago: "9 min ago", sentiment: "Neutral", author: "@voyage.lou", confidence: 94,
    comment: "Est-ce que l'offre Crète est encore valable pour les départs de novembre ?",
    draft: "Bonjour ! L'offre Crète reste valable pour tous les départs jusqu'au 28 novembre. Vous trouverez les dates disponibles via le lien en bio.",
  },
  {
    id: "q3", net: "FB", page: "Helio Energy", ago: "17 min ago", sentiment: "Negative", author: "Marc T.", confidence: 63,
    comment: "Vos factures ont doublé sans explication. On parle d'une action collective.",
    draft: "Bonjour Marc, une hausse de cette ampleur n'est pas normale. Pouvez-vous nous transmettre votre référence client en message privé afin qu'un conseiller analyse votre facture aujourd'hui ?",
  },
  {
    id: "q4", net: "FB", page: "Maison Verte", ago: "24 min ago", sentiment: "Positive", author: "Inès K.", confidence: 88,
    comment: "Le service après-vente a été impeccable, merci à l'équipe !",
    draft: "Merci beaucoup Inès, votre message fait très plaisir à toute l'équipe. À très bientôt chez Maison Verte !",
  },
];

export const AI_STATUSES = [
  "Assistant analysing new comments",
  "Classifying sentiment",
  "Drafting replies",
  "Checking policy rules",
];

/** Why a reviewer rejected a draft — the answer is fed back to retrain the model. */
export const REJECT_REASONS = ["Wrong tone", "Incorrect facts", "Policy risk", "Too generic"];

export interface PipelineStep {
  label: string;
  /** `null` = the live review-queue length. */
  value: string | null;
  fill: number;
  active: boolean;
}

export const PIPELINE: PipelineStep[] = [
  { label: "Detected", value: "12 480", fill: 100, active: false },
  { label: "AI drafted", value: "11 902", fill: 95, active: false },
  { label: "Human review", value: null, fill: 42, active: true },
  { label: "Published", value: "8 537", fill: 68, active: false },
];

export type RuleKey = "negative" | "volume" | "vip" | "lang";

export const ESCALATION_RULES: Array<{ key: RuleKey; label: string; description: string }> = [
  { key: "negative", label: "Negative sentiment burst", description: "Notify admins when negative comments exceed 25% in one hour." },
  { key: "volume", label: "Volume spike", description: "Alert when a page receives 3× its usual hourly volume." },
  { key: "vip", label: "VIP & press accounts", description: "Never auto-reply to flagged accounts; route to a senior manager." },
  { key: "lang", label: "Unsupported language", description: "Escalate comments the model cannot translate confidently." },
];

export const DEFAULT_RULES: Record<RuleKey, boolean> = {
  negative: true,
  volume: true,
  vip: true,
  lang: false,
};

/** Below this confidence a draft that still needs review is flagged amber rather than red. */
export const REVIEW_WARNING_CONFIDENCE = 70;

export const SENTIMENT_TONE: Record<SentimentLabel, Tone> = {
  Negative: "danger",
  Positive: "success",
  Neutral: "muted",
};

/** What a given autonomy threshold means in practice, shown under the slider. */
export function describeThreshold(threshold: number): { tone: Tone; text: string } {
  if (threshold >= 90) {
    return { tone: "info", text: "Very strict — around 31% of drafts will need a human review." };
  }
  if (threshold >= 75) {
    return { tone: "success", text: "Balanced — roughly 2 of 3 replies are sent automatically." };
  }
  return { tone: "warning", text: "Permissive — sensitive drafts may be sent without review." };
}

export const THRESHOLD_MIN = 50;
export const THRESHOLD_MAX = 99;
export const DEFAULT_THRESHOLD = 82;

/**
 * Contrat de l'API d'administration (`/api/v1/admin`, voir docs/ADMIN_CONSOLE.md). Ces types
 * reprennent la forme exacte des réponses de `services/api/src/admin/`. `null` signifie
 * « non disponible » : l'écran l'affiche comme tel, jamais comme 0.
 */

export type Network = "facebook" | "instagram";
export type NetworkFilter = "all" | Network;
export type Period = "7d" | "30d" | "90d";
export type SentimentKey = "positive" | "neutral" | "negative";

export interface PageCounts {
  all: number;
  facebook: number;
  instagram: number;
}

export interface AdminProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  language: string;
  timezone: string;
  avatarInitials: string;
}

export interface AdminSession {
  user: AdminProfile;
  platformRole: "platform_admin";
}

export interface AdminSummary {
  pages: PageCounts;
  users: { total: number; active: number; suspended: number; online: number };
  supervision: { pendingDrafts: number; openEscalations: number };
  sla: { targetMinutes: number; complianceRate: number | null };
  ai: { autonomyRate: number | null };
  alerts: { escalations: number; pagesNeedingAction: number };
  lastEventAt: string | null;
}

// --- Vue d'ensemble ------------------------------------------------------------------------------

export type Severity = "critical" | "high" | "medium";

export interface OverviewEscalation {
  id: string;
  network: Network;
  text: string;
  page: string;
  raisedBy: string | null;
  raisedAt: string;
  severity: Severity;
}

export interface DailyVolume {
  /** Jour civil AAAA-MM-JJ dans le fuseau de l'administrateur. */
  date: string;
  positive: number;
  neutral: number;
  negative: number;
}

export interface Overview {
  period: Period;
  network: NetworkFilter;
  days: number;
  generatedAt: string;
  buckets: Array<{ start: string; end: string }>;
  pages: PageCounts;
  kpis: {
    processed: { value: number; previous: number; deltaPercent: number | null; spark: number[] };
    firstResponse: {
      medianSeconds: number | null;
      previousMedianSeconds: number | null;
      deltaPercent: number | null;
      spark: Array<number | null>;
      targetMinutes: number;
    };
    aiResolved: {
      rate: number | null;
      previousRate: number | null;
      /** Écart en points de pourcentage. */
      deltaPoints: number | null;
      sentByAi: number;
      totalReplies: number;
      spark: Array<number | null>;
    };
    escalations: { open: number; olderThanTwoHours: number; raised: number; raisedPrevious: number; spark: number[] };
  };
  sentiment: Record<SentimentKey, number>;
  daily: DailyVolume[];
  health: {
    webhooks: { total24h: number; failed24h: number; averageLatencyMs: number | null };
    moderationBacklog: number;
    tokens: { expiringWithinSevenDays: number; connectedPages: number };
  };
  escalations: OverviewEscalation[];
  leaderboard: Array<{ userId: string; name: string; replies: number }>;
}

export type FeedTag = "question" | "positive" | "negative" | "neutral" | "pending";

export interface LiveActivity {
  commentsLastHour: number;
  generatedAt: string;
  feed: Array<{ id: string; network: Network; page: string; text: string; tag: FeedTag; at: string }>;
}

// --- Supervision IA -------------------------------------------------------------------------------

export type RuleKey = "negative" | "volume" | "vip" | "lang";
export type RejectReason = "wrong_tone" | "incorrect_facts" | "policy_risk" | "too_generic";

export interface SupervisionSettings {
  autoReply: boolean;
  threshold: number;
  rules: Record<RuleKey, boolean>;
}

export type DraftStatus = "proposed" | "edited" | "failed";

export interface QueueDraft {
  /** Identifiant de la proposition de réponse. */
  id: string;
  commentId: string;
  network: Network;
  page: string;
  commentedAt: string;
  draftedAt: string;
  sentiment: SentimentKey | null;
  author: string | null;
  comment: string;
  draft: string;
  version: number;
  status: DraftStatus;
  /** 0–100 ; `null` quand la stratégie de génération n'en produit pas. */
  confidence: number | null;
  blocked: boolean;
  warnings: string[];
}

export interface Supervision {
  settings: SupervisionSettings;
  pipeline: { periodHours: number; detected: number; drafted: number; published: number; inReview: number };
  analysis: { waiting: number };
  queue: { total: number; items: QueueDraft[] };
  performance: {
    periodDays: number;
    generated: number;
    decided: number;
    approvalRate: number | null;
    editedRate: number | null;
    rejectedRate: number | null;
    averageDraftMs: number | null;
    feedbackLast24h: number;
  };
  /** Nombre de brouillons IA par point de confiance, de 0 à 99. */
  confidenceDistribution: number[];
}

export interface DraftOutcome {
  id: string;
  commentId: string;
  status: "sent" | "rejected" | "escalated";
}

// --- Analytique -------------------------------------------------------------------------------------

export type Metric = "engagement" | "response_time" | "sentiment" | "ai_performance";
export type SentimentFilter = "all" | SentimentKey;

export interface TrendPoint {
  start: string;
  end: string;
  value: number | null;
}

export interface Trend {
  metric: Metric;
  period: Period;
  sentiment: SentimentFilter;
  unit: "percent" | "seconds";
  points: TrendPoint[];
  previous: TrendPoint[];
  summary: { value: number | null; previousValue: number | null; deltaPercent: number | null };
}

export interface PagePerformance {
  period: Period;
  pages: Array<{
    id: string;
    name: string;
    network: Network;
    comments: number;
    firstReplySeconds: number | null;
    aiShare: number | null;
    sentimentScore: number | null;
  }>;
  options: Array<{ id: string; name: string; network: Network }>;
  hourly: Array<{ hour: number; average: number }>;
}

// --- Utilisateurs et rôles -----------------------------------------------------------------------------

export type MemberRole = "owner" | "admin" | "community_manager" | "viewer";
export type EditableRole = Exclude<MemberRole, "owner">;
export type UserStatus = "active" | "suspended";
export type UserFilter = "all" | UserStatus;
export type PlatformRole = "user" | "platform_admin";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  platformRole: PlatformRole;
  /** Rôle le plus élevé parmi les marques ; `null` sans aucune marque. */
  role: MemberRole | null;
  memberships: Array<{ brandId: string; brandName: string; role: MemberRole }>;
  pagesCount: number;
  lastSeenAt: string | null;
  createdAt: string;
  replies30d: number;
  averageResponseSeconds: number | null;
}

export interface UserList {
  items: AdminUser[];
  page: number;
  pageSize: number;
  total: number;
  counts: { all: number; active: number; suspended: number };
}

export interface UserPatch {
  status?: UserStatus;
  platformRole?: PlatformRole;
  memberships?: Array<{ brandId: string; role: EditableRole }>;
}

// --- Pages connectées ----------------------------------------------------------------------------------------

export type PageHealth = "healthy" | "attention" | "action_required";
export type TokenState = "valid" | "expiring" | "expired" | "error" | "unknown";

export interface ConnectedPage {
  id: string;
  network: Network;
  name: string;
  handle: string | null;
  followers: number | null;
  status: PageHealth;
  rawStatus: string;
  comments24h: number;
  backlog: number;
  token: { state: TokenState; expiresAt: string | null; message: string | null };
  brand: { id: string; name: string };
  team: Array<{ id: string; name: string; initials: string }>;
  teamCount: number;
  autoReply: boolean;
  lastCommentsSyncAt: string | null;
}

export interface PageList {
  items: ConnectedPage[];
  totals: PageCounts;
}

// --- Configuration --------------------------------------------------------------------------------------------

export interface ServiceLevels {
  firstResponseMinutes: number;
  escalationMinutes: number;
  nightWindowMinutes: number;
}

export interface AdminSettings {
  keywords: string[];
  serviceLevels: ServiceLevels;
  supervision: SupervisionSettings;
}

export type AuditKind = "role" | "ai" | "page" | "user" | "rule";

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  kind: AuditKind | null;
  actor: { id: string; name: string } | null;
  metadata: Record<string, unknown>;
}

export interface AuditPage {
  items: AuditEntry[];
  page: number;
  pageSize: number;
  total: number;
}

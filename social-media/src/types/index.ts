/** Domain model for the Community Manager assistant app. */

import type { Href } from 'expo-router';

export type SocialNetwork = 'facebook' | 'instagram';

export type Language = 'fr' | 'en' | 'ar';

export type PublicationStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'partially_published'
  | 'failed'
  | 'cancelled';

export type TargetStatus = 'pending' | 'sent' | 'failed';

export type Sentiment = 'positive' | 'neutral' | 'negative';

export type Intent = 'question' | 'complaint' | 'info_request' | 'claim' | 'other';

export type Priority = 'low' | 'medium' | 'high';

// Matches the backend's CommentStatus enum verbatim (lowercased on the wire,
// same convention as AccountStatus) — Sprint 08 native states only. No
// `untreated` (the code never distinguished it from `new`) and no
// `treated` (renamed `processed` to match the backend, which also reaches
// this status when a reply is actually sent, not just via a manual action).
export type CommentStatus = 'new' | 'processed' | 'ignored' | 'escalated';

export type ResponseStatus = 'proposed' | 'edited' | 'approved' | 'rejected' | 'sent' | 'failed';

// Matches the backend's SocialAccountStatus enum verbatim (lowercased on the
// wire, like Brand.status) — one canonical vocabulary end-to-end instead of
// a translation map (Sprint 06 Day 5).
export type AccountStatus =
  | 'connected'
  | 'expiring'
  | 'expired'
  | 'reauth_required'
  | 'revoked'
  | 'disconnected';

export type BrandTone = 'professional' | 'friendly' | 'empathetic' | 'formal' | 'custom';

export type NotificationType =
  | 'publication_approval_requested'
  | 'publication_approved'
  | 'publication_rejected'
  | 'publication_changes_requested'
  | 'priority_comment'
  | 'negative_comment'
  | 'urgent_comment'
  | 'ai_response_ready'
  | 'publication_published'
  | 'publication_failed'
  | 'publication_partial'
  | 'token_expiring'
  | 'token_expired'
  | 'sync_failed'
  | 'account_disconnected';

export type User = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  language: Language;
  timezone: string;
  phone?: string | null;
  createdAt: string;
  avatarInitials: string;
};

export type Brand = {
  id: string;
  name: string;
  description: string;
  sector: string;
  primaryLanguage: Language;
  secondaryLanguages: Language[];
  tone: BrandTone;
  /** Free-text description used when `tone` is `custom`. */
  customTone?: string;
  useInformalAddress: boolean;
  emojisAllowed: boolean;
  targetLength: string;
  greeting: string;
  closing: string;
  bannedTerms: string[];
  recommendedTerms: string[];
  escalationRule: string;
  connectedAccountIds: string[];
  isActive?: boolean;
  role?: 'OWNER' | 'ADMIN' | 'COMMUNITY_MANAGER' | 'VIEWER';
  status?: 'active' | 'archived';
  /** Incremented by the API whenever AI settings change; protects against stale saves. */
  version?: number;
  formality?: 'informal' | 'formal' | 'adaptive';
  instructions?: string;
  complaintInstructions?: string;
  urgencyInstructions?: string;
  supportInstructions?: string;
};

export type SocialAccount = {
  id: string;
  network: SocialNetwork;
  name: string;
  username: string;
  externalId: string;
  kind: string;
  brandId: string;
  brandName: string;
  status: AccountStatus;
  permissions: { label: string; granted: boolean }[];
  connectedAt: string;
  tokenExpiresAt: string | null;
  lastSyncAt: string | null;
};

export type MediaAsset = {
  id: string;
  fileName: string;
  mimeType: string;
  /** Bytes. */
  size: number;
  width: number;
  height: number;
  uri?: string;
  /** 0 → 1. */
  uploadProgress: number;
};

export type PublicationTarget = {
  network: SocialNetwork;
  accountId: string;
  accountUsername: string;
  status: TargetStatus;
  sentAt: string | null;
  attempts: number;
  externalId: string | null;
  error: string | null;
};

export type PublicationMetrics = {
  /** `null` means the platform did not provide the metric - render "Non disponible", never 0. */
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  reach: number | null;
  impressions: number | null;
  engagementRate: number | null;
  lastSyncAt: string | null;
};

export type Publication = {
  id: string;
  brandId: string;
  brandName: string;
  text: string;
  language: Language;
  hashtags: string[];
  media: MediaAsset | null;
  targets: PublicationTarget[];
  status: PublicationStatus;
  authorName: string;
  authorId: string;
  approval: PublicationApproval | null;
  approvalValid: boolean;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  timezone: string;
  metrics: PublicationMetrics;
  commentCount: number;
  negativeCommentCount: number;
  urgentCommentCount: number;
  /** Per-network overrides, when the CM wants different copy per platform. */
  perNetwork?: Partial<Record<SocialNetwork, { text: string; hashtags: string[] }>>;
};

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'cancelled';
export type PublicationApproval = {
  id: string;
  publicationId: string;
  requestedBy: string;
  requesterName: string;
  reviewerId: string | null;
  reviewerName: string | null;
  status: ApprovalStatus;
  revision: number;
  requestComment: string | null;
  comment: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ApprovalMember = { id: string; displayName: string; role: 'owner' | 'admin' | 'community_manager' | 'viewer' };
export type ApprovalHistoryEvent = {
  id: string; action: string; actorId: string | null; actorName: string; timestamp: string;
  comment: string | null; fromStatus: PublicationStatus | null; toStatus: PublicationStatus | null;
  reviewerId: string | null; approvalId: string | null;
};

export type AiAnalysis = {
  sentiment: Sentiment;
  intent: Intent;
  priority: Priority;
  /** 0 → 1. Le minimum des deux tâches (sentiment et intention), pas leur
   * moyenne : une intention sûre ne compense pas un sentiment douteux. */
  confidence: number;
  /** Vrai quand le modèle est sous son seuil, ou quand le commentaire n'est
   * pas en français (hors du périmètre du dataset). L'écran doit alors dire
   * « à vérifier » plutôt que d'afficher un verdict comme les autres. */
  lowConfidence: boolean;
  urgent: boolean;
  sensitive: boolean;
  recommendedAction: string;
  explanation: string;
  analysedAt: string;
  modelVersion: string;
};

/** Résultat du contrôle de sécurité, tel que le serveur le renvoie.
 * `blocking` interdit l'approbation ; les autres niveaux sont affichés et
 * l'humain décide. */
export type ResponseWarning = {
  code: string;
  severity: 'blocking' | 'warning' | 'info';
  message: string;
  matches?: string[];
};

export type AiResponse = {
  id: string;
  text: string;
  language: Language;
  tone: BrandTone;
  status: ResponseStatus;
  createdAt: string;
  generatedByAi: boolean;
  /** Kept so the original proposal is never lost after a human edit. */
  originalText: string;
  version: number;
  warnings: ResponseWarning[];
  /** Vrai quand un avertissement bloquant interdit l'envoi : le serveur
   * refusera l'approbation tant qu'il n'est pas levé. */
  blocked: boolean;
  /** `local-template-x` ou `claude` : dit quelle source a produit le texte. */
  generator?: string;
  promptVersion?: string;
  generatedText?: string;
  finalText?: string | null;
  confidenceScore?: number | null;
  sources?: { documentId: string; chunkId: string; title: string; score: number; revision: number }[];
  similarExamples?: { id: string; score: number }[];
  feedbackStatus?: 'ACCEPTED' | 'EDITED' | 'REJECTED' | 'REGENERATED' | null;
  strategy?: 'llm' | 'rag' | 'rag_feedback' | 'human';
};

export type Comment = {
  id: string;
  network: SocialNetwork;
  authorName: string;
  authorInitials: string;
  text: string;
  publishedAt: string;
  publicationId: string;
  publicationTitle: string;
  status: CommentStatus;
  isNew: boolean;
  deletedOnPlatform: boolean;
  /** `null` while the AI analysis is still pending. */
  analysis: AiAnalysis | null;
  response: AiResponse | null;
};

export type HistoryEventKind =
  | 'comment_received'
  | 'ai_analysis'
  | 'response_proposed'
  | 'response_edited'
  | 'send_failed'
  | 'response_sent'
  | 'status_changed'
  | 'escalated';

export type HistoryEvent = {
  id: string;
  kind: HistoryEventKind;
  at: string;
  title: string;
  detail?: string;
  /** Quoted response body, when the event carries one. */
  body?: string;
  actor?: string;
  modelVersion?: string;
  version?: number;
};

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  priority: Priority;
  createdAt: string;
  read: boolean;
  network: SocialNetwork | null;
  /** In-app route this notification opens - validated against the route tree. */
  href: Href;
};

export type DashboardSummary = {
  scheduledCount: number;
  newCommentCount: number;
  highPriorityCount: number;
  pendingAiResponseCount: number;
};

export type AnalyticsTotals = {
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  reach: number | null;
  impressions: number | null;
  engagementRate: number | null;
  negativeComments: number | null;
  urgentComments: number | null;
  responsesGenerated: number | null;
  responsesSent: number | null;
  /** Percent change vs. the previous period; `null` when not comparable. */
  deltas: Partial<Record<'reactions' | 'comments' | 'engagementRate', number>>;
};

export type AnalyticsBucket = {
  label: string;
  facebook: number;
  instagram: number;
};

export type SentimentBreakdown = {
  positive: number;
  neutral: number;
  negative: number;
};

export type AnalyticsOverview = {
  totals: AnalyticsTotals;
  interactions: AnalyticsBucket[];
  sentiment: SentimentBreakdown;
  topPublications: Publication[];
  /** `null` when nothing has ever been synced for this brand yet (Sprint 12) — same meaning as `PublicationMetrics.lastSyncAt`. */
  lastSyncAt: string | null;
  /** Metrics a platform refused, surfaced to the user as an explanation. */
  unavailable: string[];
};

export type BestTimeConfidence = 'low' | 'medium' | 'high';

/** One weekday × time-slot recommendation from `GET /analytics/best-times`. */
export type BestTimeSlot = {
  /** 0 = Monday … 6 = Sunday, same convention as `buildMonthGrid`. */
  weekday: number;
  weekdayLabel: string;
  slotStartHour: number;
  slotEndHour: number;
  slotLabel: string;
  score: number;
  confidence: BestTimeConfidence;
  sampleSize: number;
  metrics: { avgEngagementRate: number; avgReach: number; avgInteractions: number };
  /** `null` when there is no comparable average across the analysed slots. */
  deltaVsAveragePercent: number | null;
};

export type BestTimesResult = {
  status: 'ok' | 'insufficient_data';
  network: SocialNetwork;
  period: '7d' | '30d' | '90d';
  timezone: string;
  analyzedCount: number;
  minimumRequired: number;
  best: BestTimeSlot | null;
  alternatives: BestTimeSlot[];
};

export type BestTimeExplanation = {
  text: string;
  generator: string;
  generatedAt: string;
};

export type NotificationPreferences = {
  publicationApproval: boolean;
  negativeComment: boolean;
  urgentComment: boolean;
  highPriorityComment: boolean;
  aiResponseGenerated: boolean;
  publicationPublished: boolean;
  publicationFailed: boolean;
  tokenExpiring: boolean;
  syncFailed: boolean;
  sound: boolean;
  vibration: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  minimumPriority: Priority;
};

export type Session = {
  id: string;
  device: string;
  location: string;
  lastActiveAt: string;
  current: boolean;
};

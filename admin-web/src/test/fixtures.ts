import type {
  AdminProfile,
  AdminSettings,
  AdminSummary,
  AdminUser,
  AuditPage,
  LiveActivity,
  Overview,
  PageList,
  PagePerformance,
  QueueDraft,
  Supervision,
  Trend,
  UserList,
} from "@/api/types";

/** Jeux de données des tests : la forme exacte des réponses de l'API d'administration. */

export const PROFILE: AdminProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@hootly.app",
  firstName: "Amine",
  lastName: "Rahali",
  displayName: "Amine Rahali",
  language: "fr",
  timezone: "Europe/Paris",
  avatarInitials: "AR",
};

export const SESSION = { user: PROFILE, platformRole: "platform_admin" as const };

export const SUMMARY: AdminSummary = {
  pages: { all: 3, facebook: 2, instagram: 1 },
  users: { total: 5, active: 4, suspended: 1, online: 2 },
  supervision: { pendingDrafts: 2, openEscalations: 1 },
  sla: { targetMinutes: 15, complianceRate: 0.942 },
  ai: { autonomyRate: 0.684 },
  alerts: { escalations: 1, pagesNeedingAction: 1 },
  lastEventAt: new Date(Date.now() - 12_000).toISOString(),
};

const day = (offset: number) => {
  const date = new Date(Date.now() - offset * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const OVERVIEW: Overview = {
  period: "7d",
  network: "all",
  days: 7,
  generatedAt: new Date().toISOString(),
  buckets: [],
  pages: { all: 3, facebook: 2, instagram: 1 },
  kpis: {
    processed: { value: 1284, previous: 1000, deltaPercent: 28.4, spark: [1, 2, 3, 4, 5, 6, 7, 8] },
    firstResponse: {
      medianSeconds: 252,
      previousMedianSeconds: 300,
      deltaPercent: -16,
      spark: [null, 300, 280, null, 260, 250, 255, 252],
      targetMinutes: 15,
    },
    aiResolved: { rate: 0.684, previousRate: 0.6, deltaPoints: 8.4, sentByAi: 26, totalReplies: 38, spark: [0.5, 0.6, null, 0.7, 0.68, 0.7, 0.66, 0.684] },
    escalations: { open: 4, olderThanTwoHours: 2, raised: 5, raisedPrevious: 2, spark: [0, 1, 0, 2, 0, 1, 0, 1] },
  },
  sentiment: { positive: 700, neutral: 400, negative: 184 },
  daily: Array.from({ length: 14 }, (_, index) => ({
    date: day(13 - index),
    positive: 50 + index,
    neutral: 20,
    negative: 10 + (index % 3),
  })),
  health: {
    webhooks: { total24h: 200, failed24h: 10, averageLatencyMs: 212 },
    moderationBacklog: 120,
    tokens: { expiringWithinSevenDays: 2, connectedPages: 3 },
  },
  escalations: [
    {
      id: "c1c1c1c1-0000-4000-8000-000000000001",
      network: "facebook",
      text: "Rumeur de rappel produit sous le post de lancement",
      page: "Nova Cosmetics",
      raisedBy: "Nadia B.",
      raisedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
      severity: "critical",
    },
    {
      id: "c1c1c1c1-0000-4000-8000-000000000002",
      network: "instagram",
      text: "Insultes répétées visant un modérateur",
      page: "Nova Cosmetics IG",
      raisedBy: null,
      raisedAt: new Date(Date.now() - 22 * 60_000).toISOString(),
      severity: "high",
    },
  ],
  leaderboard: [
    { userId: "u1", name: "Amel Haddad", replies: 40 },
    { userId: "u2", name: "Nadia Belhadj", replies: 20 },
  ],
};

export const LIVE: LiveActivity = {
  commentsLastHour: 37,
  generatedAt: new Date().toISOString(),
  feed: [
    { id: "f1", network: "facebook", page: "Nova Cosmetics", text: "Quand arrive le réassort de la crème n°3 ?", tag: "question", at: new Date().toISOString() },
    { id: "f2", network: "instagram", page: "Nova Cosmetics IG", text: "Commande reçue en avance, merci !", tag: "positive", at: new Date().toISOString() },
    { id: "f3", network: "facebook", page: "Aurora Travel", text: "Toujours aucune réponse à mon mail…", tag: "pending", at: new Date().toISOString() },
  ],
};

export const DRAFTS: QueueDraft[] = [
  {
    id: "d1d1d1d1-0000-4000-8000-000000000001",
    commentId: "c0c0c0c0-0000-4000-8000-000000000001",
    network: "facebook",
    page: "Nova Cosmetics",
    commentedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    draftedAt: new Date().toISOString(),
    sentiment: "negative",
    author: "Claire D.",
    comment: "Troisième commande abîmée, personne ne répond depuis une semaine.",
    draft: "Bonjour Claire, nous sommes navrés pour ces trois commandes.",
    version: 1,
    status: "proposed",
    confidence: 71,
    blocked: false,
    warnings: [],
  },
  {
    id: "d2d2d2d2-0000-4000-8000-000000000002",
    commentId: "c0c0c0c0-0000-4000-8000-000000000002",
    network: "instagram",
    page: "Aurora Travel IG",
    commentedAt: new Date(Date.now() - 9 * 60_000).toISOString(),
    draftedAt: new Date().toISOString(),
    sentiment: null,
    author: null,
    comment: "Est-ce que l'offre Crète est encore valable en novembre ?",
    draft: "Bonjour ! L'offre Crète reste valable jusqu'au 28 novembre.",
    version: 2,
    status: "failed",
    confidence: null,
    blocked: true,
    warnings: ["Promesse de date non confirmée"],
  },
];

export const SUPERVISION: Supervision = {
  settings: { autoReply: false, threshold: 82, rules: { negative: true, volume: true, vip: true, lang: false } },
  pipeline: { periodHours: 24, detected: 100, drafted: 80, published: 60, inReview: 2 },
  analysis: { waiting: 3 },
  queue: { total: 2, items: DRAFTS },
  performance: {
    periodDays: 30,
    generated: 200,
    decided: 100,
    approvalRate: 0.926,
    editedRate: 0.051,
    rejectedRate: 0.023,
    averageDraftMs: 1200,
    feedbackLast24h: 8,
  },
  // 10 brouillons à 60 %, 30 à 85 % : un seuil de 82 en laisse passer 75 %.
  confidenceDistribution: Array.from({ length: 100 }, (_, index) => (index === 60 ? 10 : index === 85 ? 30 : 0)),
};

export const TREND: Trend = {
  metric: "engagement",
  period: "30d",
  sentiment: "all",
  unit: "percent",
  points: Array.from({ length: 10 }, (_, index) => ({
    start: new Date(Date.now() - (10 - index) * 3 * 86_400_000).toISOString(),
    end: new Date(Date.now() - (9 - index) * 3 * 86_400_000).toISOString(),
    value: index === 4 ? null : 0.05 + index * 0.005,
  })),
  previous: Array.from({ length: 10 }, (_, index) => ({
    start: new Date(Date.now() - (20 - index) * 3 * 86_400_000).toISOString(),
    end: new Date(Date.now() - (19 - index) * 3 * 86_400_000).toISOString(),
    value: 0.04,
  })),
  summary: { value: 0.0731, previousValue: 0.06, deltaPercent: 21.8 },
};

export const PAGE_PERFORMANCE: PagePerformance = {
  period: "30d",
  pages: [
    { id: "p1", name: "Nova Cosmetics", network: "facebook", comments: 4821, firstReplySeconds: 160, aiShare: 0.74, sentimentScore: 78 },
    { id: "p2", name: "Aurora Travel", network: "instagram", comments: 1402, firstReplySeconds: 750, aiShare: null, sentimentScore: 36 },
    { id: "p3", name: "Maison Verte", network: "facebook", comments: 0, firstReplySeconds: null, aiShare: null, sentimentScore: null },
  ],
  options: [
    { id: "p1", name: "Nova Cosmetics", network: "facebook" },
    { id: "p2", name: "Aurora Travel", network: "instagram" },
  ],
  hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, average: hour === 14 ? 12.4 : hour === 9 ? 6 : 1 })),
};

const user = (overrides: Partial<AdminUser>): AdminUser => ({
  id: "u-default",
  name: "Nom",
  email: "nom@example.fr",
  status: "active",
  platformRole: "user",
  role: "community_manager",
  memberships: [{ brandId: "b1", brandName: "Studio Vega", role: "community_manager" }],
  pagesCount: 2,
  lastSeenAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  createdAt: new Date().toISOString(),
  replies30d: 412,
  averageResponseSeconds: 188,
  ...overrides,
});

export const USERS: AdminUser[] = [
  user({ id: PROFILE.id, name: "Amine Rahali", email: "admin@hootly.app", platformRole: "platform_admin", role: null, memberships: [], pagesCount: 0 }),
  user({ id: "u-nadia", name: "Nadia Belhadj", email: "nadia.b@pulse.io" }),
  user({
    id: "u-lea",
    name: "Léa Martin",
    email: "lea@studio-vega.fr",
    role: "owner",
    memberships: [
      { brandId: "b1", brandName: "Studio Vega", role: "owner" },
      { brandId: "b2", brandName: "Nova Cosmetics", role: "viewer" },
    ],
  }),
  user({ id: "u-thomas", name: "Thomas Weber", email: "thomas.w@pulse.io", status: "suspended", lastSeenAt: null, replies30d: 0, averageResponseSeconds: null }),
];

export const USER_LIST: UserList = {
  items: USERS,
  page: 1,
  pageSize: 25,
  total: 4,
  counts: { all: 4, active: 3, suspended: 1 },
};

export const PAGES: PageList = {
  totals: { all: 3, facebook: 2, instagram: 1 },
  items: [
    {
      id: "p1",
      network: "facebook",
      name: "Nova Cosmetics",
      handle: "@novacosmetics",
      followers: 412000,
      status: "healthy",
      rawStatus: "connected",
      comments24h: 1284,
      backlog: 12,
      token: { state: "valid", expiresAt: "2027-03-14T00:00:00.000Z", message: null },
      brand: { id: "b2", name: "Nova Cosmetics SAS" },
      team: [
        { id: "u-nadia", name: "Nadia Belhadj", initials: "NB" },
        { id: "u-lea", name: "Léa Martin", initials: "LM" },
      ],
      teamCount: 2,
      autoReply: true,
      lastCommentsSyncAt: null,
    },
    {
      id: "p2",
      network: "instagram",
      name: "Aurora Travel",
      handle: null,
      followers: null,
      status: "action_required",
      rawStatus: "reauth_required",
      comments24h: 611,
      backlog: 88,
      token: { state: "error", expiresAt: null, message: "Invalid OAuth access token" },
      brand: { id: "b3", name: "Aurora" },
      team: [],
      teamCount: 0,
      autoReply: false,
      lastCommentsSyncAt: null,
    },
  ],
};

export const SETTINGS: AdminSettings = {
  keywords: ["remboursement", "arnaque"],
  serviceLevels: { firstResponseMinutes: 15, escalationMinutes: 45, nightWindowMinutes: 30 },
  supervision: SUPERVISION.settings,
};

export const AUDIT: AuditPage = {
  page: 1,
  pageSize: 20,
  total: 3,
  items: [
    {
      id: "a1",
      at: "2026-09-20T12:02:00.000Z",
      action: "admin.membership.role_changed",
      kind: "role",
      actor: { id: PROFILE.id, name: "Amine Rahali" },
      metadata: { userName: "Amel Haddad", brandName: "Studio Vega", from: "community_manager", to: "admin" },
    },
    {
      id: "a2",
      at: "2026-09-20T09:47:00.000Z",
      action: "admin.settings.supervision_updated",
      kind: "ai",
      actor: { id: PROFILE.id, name: "Amine Rahali" },
      metadata: { before: { autoReply: false, threshold: 78, rules: { vip: true } }, after: { autoReply: false, threshold: 82, rules: { vip: true } } },
    },
    {
      id: "a3",
      at: "2026-09-19T18:33:00.000Z",
      action: "social_account.disconnected",
      kind: "page",
      actor: null,
      metadata: { provider: "INSTAGRAM" },
    },
  ],
};

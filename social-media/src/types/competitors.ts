/**
 * Analyse concurrentielle (sprint_listing/PLUS/TODO_ANALYSE_CONCURRENTIELLE_MISE_A_JOUR.md).
 *
 * Le vocabulaire est celui du serveur, en minuscules sur le fil — même
 * convention que `AccountStatus`/`CommentStatus` : une seule liste de statuts
 * de bout en bout plutôt qu'une table de traduction.
 */
import type { SocialNetwork } from './index';
import type { AnalyticsPeriod } from './analytics';

export type CompetitorStatus = 'active' | 'unavailable' | 'permission_required' | 'sync_error';

/** Disponibilité d'une métrique. `partial` = calculée sur une partie seulement
 * des publications — l'écran doit le dire, pas l'arrondir à « disponible ». */
export type MetricAvailability = 'available' | 'partial' | 'unavailable';

export type CompetitorMetricSnapshot = {
  collectedAt: string;
  followersCount: number | null;
  postsCount: number | null;
  reactionsCount: number | null;
  commentsCount: number | null;
  sharesCount: number | null;
  engagementRate: number | null;
};

export type Competitor = {
  id: string;
  brandId: string;
  platform: SocialNetwork;
  externalId: string | null;
  username: string;
  name: string;
  profileUrl: string | null;
  avatarUrl: string | null;
  status: CompetitorStatus;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  latestMetric: CompetitorMetricSnapshot | null;
};

export type CompetitorDetail = Competitor & {
  reason: string | null;
  storedPosts: number;
  storedMetrics: number;
};

export type CompetitorVerification = {
  status: CompetitorStatus;
  platform: SocialNetwork;
  handle: string;
  externalId: string | null;
  username: string;
  name: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  accountType: string | null;
  followersCount: number | null;
  postsCount: number | null;
  unavailableFields: string[];
  reason: string | null;
  alreadyAdded: boolean;
  competitorId: string | null;
};

export type CompetitorPost = {
  id: string;
  externalPostId: string;
  message: string | null;
  mediaType: string | null;
  permalink: string | null;
  publishedAt: string | null;
  reactionsCount: number | null;
  commentsCount: number | null;
  sharesCount: number | null;
  engagementRate: number | null;
  syncedAt: string;
};

export type AveragedMetric = {
  value: number | null;
  availability: MetricAvailability;
  sampleSize: number;
  total: number | null;
};

export type CompetitorIndicators = {
  periodStart: string;
  periodEnd: string;
  postsCount: number;
  postsPerWeek: number;
  followersCount: number | null;
  interactionComponents: string[];
  avgReactions: AveragedMetric;
  avgComments: AveragedMetric;
  avgShares: AveragedMetric;
  avgInteractions: AveragedMetric;
  engagementRate: { value: number | null; availability: MetricAvailability };
  engagementTrend: { current: number | null; previous: number | null; changePercent: number | null };
  topPost: (CompetitorPost & { interactions: number }) | null;
  mostFrequentWeekday: { value: number; label: string; count: number } | null;
  mostFrequentHour: { value: number; label: string; count: number } | null;
  unavailable: string[];
  warnings: string[];
};

export type CompetitorAnalytics = {
  competitor: Pick<Competitor, 'id' | 'platform' | 'username' | 'name' | 'avatarUrl' | 'profileUrl' | 'status' | 'lastSyncedAt'>;
  period: AnalyticsPeriod;
  indicators: CompetitorIndicators;
  followersSyncedAt: string | null;
  history: { collectedAt: string; followersCount: number | null; postsCount: number | null; engagementRate: number | null }[];
  topPosts: (CompetitorPost & { interactions: number })[];
  warnings: string[];
};

export type ComparedMetric = {
  key: string;
  label: string;
  unit: 'count' | 'percent';
  brand: number | null;
  competitor: number | null;
  /** Écart de la marque par rapport au concurrent : positif = la marque fait mieux. */
  differencePercent: number | null;
  availability: MetricAvailability;
};

export type CompetitorComparison = {
  competitor: Pick<Competitor, 'id' | 'platform' | 'username' | 'name' | 'avatarUrl' | 'status' | 'lastSyncedAt'>;
  network: string;
  interactionComponents: string[];
  brand: CompetitorIndicators;
  competitorIndicators: CompetitorIndicators;
  metrics: ComparedMetric[];
  topPosts: { brand: CompetitorIndicators['topPost']; competitor: CompetitorIndicators['topPost'] };
  notes: string[];
};

export type CompetitorComparisonResult = {
  period: AnalyticsPeriod;
  platform: SocialNetwork | 'all';
  periodStart: string;
  periodEnd: string;
  comparisons: CompetitorComparison[];
  warnings: string[];
};

export type CompetitorExplanation = {
  period: AnalyticsPeriod;
  platform: SocialNetwork | 'all';
  text: string;
  recommendations: string[];
  generator: string;
  warnings: { code: string; severity: string; message: string }[];
  facts: unknown;
};

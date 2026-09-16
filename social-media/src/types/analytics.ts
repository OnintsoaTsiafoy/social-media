import type { SocialNetwork } from './index';

export type AnalyticsPeriod = '7d' | '30d' | '90d';
export type AnalyticsMetric = {
  label: string; value: number | null; unit: 'count' | 'percent' | 'percentage_points';
  availability: 'available' | 'partial' | 'unavailable';
};
export type AnalyticsFact = { id: string; type: string; metric: string; value: number; unit: AnalyticsMetric['unit'];
  polarity: 'neutral' | 'positive' | 'attention'; message: string; recommendation: string | null };
export type AnalyticsSummary = {
  period: AnalyticsPeriod; network: SocialNetwork | 'all'; periodStart: string; periodEnd: string;
  previousPeriodStart: string; previousPeriodEnd: string; lastSyncAt: string | null;
  metrics: Record<string, AnalyticsMetric>;
  facts: AnalyticsFact[];
  anomalies: AnalyticsFact[];
  variations: { metric: string; current: number | null; previous: number | null; changePercent: number | null; reason: string | null }[];
  topPublications: { publicationId: string; publishedAt: string; rank: number; interactions: number; sharePercent: number | null }[];
  bestNetwork: { network: SocialNetwork; interactions: number } | null;
  interactionPeak: { date: string; interactions: number } | null;
  unavailableMetrics: string[]; partialMetrics: string[];
  coverage: { currentPublications: number; previousPublications: number; currentComments: number;
    previousComments: number; currentAnalyzedComments: number; previousAnalyzedComments: number };
  ai: { status: 'not_requested' };
  warnings: string[];
};
export type AnalyticsInsight = {
  id: string; brandId: string; network: SocialNetwork | 'all'; period: AnalyticsPeriod;
  periodStart: string; periodEnd: string; createdAt: string; historical: boolean;
  summary: string; importantFacts: string[]; positivePoints: string[]; attentionPoints: string[];
  recommendations: string[]; referencedMetrics: string[]; warnings: string[];
  metricsSnapshot: AnalyticsSummary; model: string; ai: { status: 'available' | 'fallback' };
  feedback: { useful: boolean; comment: string } | null;
};
export type AnalyticsInsightHistory = { items: AnalyticsInsight[]; total: number; page: number; pageSize: number };
export type AnalyticsInsightFeedbackStats = {
  total: number; positive: number; negative: number; satisfactionRate: number | null;
  mostRejected: { insightId: string; rejections: number }[];
};

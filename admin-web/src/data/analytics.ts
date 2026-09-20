import type { AnalyticsTab, PageFilter, Period, SentimentFilter } from "@/lib/chart";
import type { NetworkCode } from "@/types";

export const ANALYTICS_TABS: AnalyticsTab[] = ["Engagement", "Response time", "Sentiment", "AI performance"];
export const PERIODS: Period[] = ["7 d", "30 d", "90 d"];
export const SENTIMENT_FILTERS: SentimentFilter[] = ["All", "Positive", "Neutral", "Negative"];
export const PAGE_FILTERS: PageFilter[] = ["All pages", "Nova Cosmetics", "Aurora Travel", "Helio Energy"];

export const CHART_META: Record<AnalyticsTab, { title: string; subtitle: string }> = {
  Engagement: { title: "Engagement rate", subtitle: "Interactions per 1 000 impressions" },
  "Response time": { title: "First response time", subtitle: "Median delay before a manager replies" },
  Sentiment: { title: "Positive sentiment", subtitle: "Share of positive comments week over week" },
  "AI performance": { title: "AI autonomy", subtitle: "Replies resolved without human review" },
};

export interface PageStat {
  net: NetworkCode;
  name: string;
  comments: string;
  /** Median first-reply delay, in seconds. */
  firstReplySeconds: number;
  aiShare: string;
  sentiment: number;
}

export const PAGE_STATS: PageStat[] = [
  { net: "FB", name: "Nova Cosmetics", comments: "4 821", firstReplySeconds: 160, aiShare: "74%", sentiment: 78 },
  { net: "IG", name: "Nova Cosmetics", comments: "3 118", firstReplySeconds: 192, aiShare: "69%", sentiment: 71 },
  { net: "FB", name: "Aurora Travel", comments: "2 604", firstReplySeconds: 531, aiShare: "52%", sentiment: 48 },
  { net: "IG", name: "Aurora Travel", comments: "1 402", firstReplySeconds: 306, aiShare: "61%", sentiment: 63 },
  { net: "FB", name: "Helio Energy", comments: "1 188", firstReplySeconds: 750, aiShare: "41%", sentiment: 36 },
  { net: "FB", name: "Maison Verte", comments: "512", firstReplySeconds: 228, aiShare: "77%", sentiment: 84 },
];

/** A first reply slower than this is flagged in red. */
export const SLOW_REPLY_SECONDS = 8 * 60;
/** A sentiment score below this is trending the wrong way. */
export const HEALTHY_SENTIMENT = 60;

/** Comments per hour, weekly average, from 06h to 24h in 12 buckets. */
export const HOURLY_VOLUME = [18, 26, 40, 62, 88, 104, 96, 120, 130, 112, 74, 40];

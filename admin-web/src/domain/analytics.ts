import type { Metric, SentimentFilter } from "@/api/types";

export const METRICS: readonly Metric[] = ["engagement", "response_time", "sentiment", "ai_performance"];
export const SENTIMENT_FILTERS: readonly SentimentFilter[] = ["all", "positive", "neutral", "negative"];

/** A first reply slower than this is flagged in red. */
export const SLOW_REPLY_SECONDS = 8 * 60;
/** A sentiment score below this is trending the wrong way. */
export const HEALTHY_SENTIMENT = 60;

/** Le graphique d'activité couvre 06 h → 24 h. */
export const FIRST_HOUR = 6;
export const LAST_HOUR = 23;

/** Le filtre de sentiment ne s'applique pas à l'engagement, calculé à partir des publications. */
export const METRICS_WITHOUT_SENTIMENT: readonly Metric[] = ["engagement"];

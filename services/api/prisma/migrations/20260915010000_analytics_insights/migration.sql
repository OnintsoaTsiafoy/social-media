CREATE TABLE "analytics_insights" (
  "id" UUID NOT NULL,
  "brand_id" UUID NOT NULL,
  "network" VARCHAR(16) NOT NULL,
  "period" VARCHAR(4) NOT NULL,
  "period_start" TIMESTAMPTZ(6) NOT NULL,
  "period_end" TIMESTAMPTZ(6) NOT NULL,
  "metrics_snapshot" JSONB NOT NULL,
  "summary" TEXT NOT NULL,
  "recommendations" JSONB NOT NULL,
  "explanation" JSONB NOT NULL,
  "model" VARCHAR(120) NOT NULL,
  "ai_status" VARCHAR(16) NOT NULL,
  "request_id" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_insights_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_insights_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "analytics_insights_network_check" CHECK ("network" IN ('all', 'facebook', 'instagram')),
  CONSTRAINT "analytics_insights_period_check" CHECK ("period" IN ('7d', '30d', '90d')),
  CONSTRAINT "analytics_insights_dates_check" CHECK ("period_start" < "period_end"),
  CONSTRAINT "analytics_insights_ai_status_check" CHECK ("ai_status" IN ('available', 'fallback'))
);
CREATE INDEX "analytics_insights_brand_id_network_period_created_at_idx" ON "analytics_insights"("brand_id", "network", "period", "created_at");

CREATE TABLE "analytics_insight_feedback" (
  "id" UUID NOT NULL,
  "insight_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "useful" BOOLEAN NOT NULL,
  "comment" VARCHAR(1000) NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "analytics_insight_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_insight_feedback_insight_id_fkey" FOREIGN KEY ("insight_id") REFERENCES "analytics_insights"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "analytics_insight_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "analytics_insight_feedback_insight_id_user_id_key" ON "analytics_insight_feedback"("insight_id", "user_id");
CREATE INDEX "analytics_insight_feedback_user_id_idx" ON "analytics_insight_feedback"("user_id");

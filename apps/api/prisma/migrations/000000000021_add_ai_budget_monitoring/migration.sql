CREATE TABLE "ai_usage_events" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
  "cache_creation_tokens" INTEGER NOT NULL DEFAULT 0,
  "reasoning_tokens" INTEGER NOT NULL DEFAULT 0,
  "estimated_usd" DECIMAL(18,8) NOT NULL,
  "estimated_brl" DECIMAL(18,8) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_budget_alerts" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "month_start" DATE NOT NULL,
  "threshold" INTEGER NOT NULL,
  "estimated_brl" DECIMAL(18,8) NOT NULL,
  "budget_brl" DECIMAL(18,2) NOT NULL,
  "recipient_email" TEXT NOT NULL,
  "acknowledged_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_budget_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_usage_events_org_id_created_at_idx" ON "ai_usage_events"("org_id", "created_at");
CREATE INDEX "ai_usage_events_org_id_provider_model_created_at_idx" ON "ai_usage_events"("org_id", "provider", "model", "created_at");
CREATE UNIQUE INDEX "ai_budget_alerts_org_id_month_start_threshold_key" ON "ai_budget_alerts"("org_id", "month_start", "threshold");
CREATE INDEX "ai_budget_alerts_org_id_acknowledged_at_created_at_idx" ON "ai_budget_alerts"("org_id", "acknowledged_at", "created_at");

ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_budget_alerts" ADD CONSTRAINT "ai_budget_alerts_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

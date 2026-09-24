ALTER TABLE "conversations"
  ADD COLUMN "secondary_intent" TEXT,
  ADD COLUMN "alternative_route_key" TEXT,
  ADD COLUMN "triage_conflict" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "routing_evidence" JSONB NOT NULL DEFAULT '[]';

CREATE TYPE "OperationalActionRequestStatus" AS ENUM (
  'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'
);

CREATE TABLE "operational_action_requests" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "skill_id" TEXT NOT NULL,
  "requested_action" TEXT NOT NULL,
  "request_payload" JSONB NOT NULL DEFAULT '{}',
  "deduplication_key" TEXT NOT NULL,
  "status" "OperationalActionRequestStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "requested_by_id" TEXT,
  "reviewed_by_id" TEXT,
  "review_note" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "operational_action_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_action_requests_org_id_deduplication_key_key"
  ON "operational_action_requests"("org_id", "deduplication_key");
CREATE INDEX "operational_action_requests_org_id_status_created_at_idx"
  ON "operational_action_requests"("org_id", "status", "created_at");
CREATE INDEX "operational_action_requests_org_id_conversation_id_idx"
  ON "operational_action_requests"("org_id", "conversation_id");

ALTER TABLE "operational_action_requests"
  ADD CONSTRAINT "operational_action_requests_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_action_requests"
  ADD CONSTRAINT "operational_action_requests_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_action_requests"
  ADD CONSTRAINT "operational_action_requests_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "operational_skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

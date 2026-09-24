CREATE TYPE "FollowUpStatus" AS ENUM ('SCHEDULED', 'READY_FOR_REVIEW', 'PAUSED', 'CANCELLED', 'COMPLETED');

CREATE TABLE "follow_up_sequences" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "status" "FollowUpStatus" NOT NULL DEFAULT 'SCHEDULED',
  "mode" TEXT NOT NULL DEFAULT 'REVIEW',
  "current_step" INTEGER NOT NULL DEFAULT 1,
  "consent_at" TIMESTAMP(3) NOT NULL,
  "next_run_at" TIMESTAMP(3),
  "paused_reason" TEXT,
  "last_sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "follow_up_sequences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "follow_up_sequences_conversation_id_key" ON "follow_up_sequences"("conversation_id");
CREATE INDEX "follow_up_sequences_org_id_status_next_run_at_idx" ON "follow_up_sequences"("org_id", "status", "next_run_at");
ALTER TABLE "follow_up_sequences" ADD CONSTRAINT "follow_up_sequences_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_up_sequences" ADD CONSTRAINT "follow_up_sequences_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

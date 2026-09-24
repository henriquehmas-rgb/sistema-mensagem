CREATE TYPE "LearningCandidateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "learning_candidates" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "intent" TEXT,
  "content" TEXT NOT NULL,
  "status" "LearningCandidateStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learning_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "learning_candidates_org_id_conversation_id_key"
  ON "learning_candidates"("org_id", "conversation_id");
CREATE INDEX "learning_candidates_org_id_status_created_at_idx"
  ON "learning_candidates"("org_id", "status", "created_at");
ALTER TABLE "learning_candidates" ADD CONSTRAINT "learning_candidates_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_candidates" ADD CONSTRAINT "learning_candidates_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

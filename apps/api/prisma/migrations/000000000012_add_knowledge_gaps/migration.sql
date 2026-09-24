CREATE TYPE "KnowledgeGapStatus" AS ENUM ('PENDING', 'ANSWERED', 'APPLIED', 'DISMISSED');

CREATE TABLE "knowledge_gaps" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "department_id" TEXT,
  "responder_id" TEXT,
  "status" "KnowledgeGapStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "context" JSONB NOT NULL DEFAULT '{}',
  "answer" TEXT,
  "due_at" TIMESTAMP(3),
  "answered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knowledge_gaps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_gaps_org_id_status_created_at_idx"
  ON "knowledge_gaps"("org_id", "status", "created_at");
CREATE INDEX "knowledge_gaps_org_id_department_id_status_idx"
  ON "knowledge_gaps"("org_id", "department_id", "status");
CREATE INDEX "knowledge_gaps_conversation_id_status_idx"
  ON "knowledge_gaps"("conversation_id", "status");

ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_responder_id_fkey"
  FOREIGN KEY ("responder_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

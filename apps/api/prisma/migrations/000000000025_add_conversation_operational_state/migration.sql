CREATE TABLE "conversation_operational_states" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "state" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversation_operational_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_operational_states_conversation_id_key"
  ON "conversation_operational_states"("conversation_id");

CREATE INDEX "conversation_operational_states_org_id_updated_at_idx"
  ON "conversation_operational_states"("org_id", "updated_at");

ALTER TABLE "conversation_operational_states"
  ADD CONSTRAINT "conversation_operational_states_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_operational_states"
  ADD CONSTRAINT "conversation_operational_states_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

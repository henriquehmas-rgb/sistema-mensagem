-- O responsável do follow-up é independente do atendente que assumiu a conversa.
-- A cadência continua sempre em modo REVIEW: esta coluna nunca autoriza envio automático.
ALTER TABLE "follow_up_sequences"
  ADD COLUMN "responsible_user_id" TEXT;

CREATE INDEX "follow_up_sequences_org_id_responsible_user_id_status_next_run_at_idx"
  ON "follow_up_sequences"("org_id", "responsible_user_id", "status", "next_run_at");

ALTER TABLE "follow_up_sequences"
  ADD CONSTRAINT "follow_up_sequences_responsible_user_id_fkey"
  FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "learning_candidates"
  ADD COLUMN "fingerprint" TEXT,
  ADD COLUMN "quality_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "auto_publish_eligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "auto_published_at" TIMESTAMP(3),
  ADD COLUMN "published_source_id" TEXT;

UPDATE "learning_candidates" SET "fingerprint" = "id" WHERE "fingerprint" IS NULL;
ALTER TABLE "learning_candidates" ALTER COLUMN "fingerprint" SET NOT NULL;
CREATE INDEX "learning_candidates_org_id_fingerprint_status_idx"
  ON "learning_candidates"("org_id", "fingerprint", "status");

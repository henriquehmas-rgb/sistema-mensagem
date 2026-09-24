ALTER TABLE "conversations"
  ADD COLUMN "identity_verified_at" TIMESTAMP(3),
  ADD COLUMN "identity_verified_by" TEXT,
  ADD COLUMN "identity_verification_method" TEXT;


CREATE TABLE "olho_de_deus_integrations" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "base_url" TEXT NOT NULL,
  "allowed_hosts" TEXT NOT NULL,
  "encrypted_credentials" TEXT NOT NULL,
  "allow_insecure_http" BOOLEAN NOT NULL DEFAULT false,
  "is_enabled" BOOLEAN NOT NULL DEFAULT false,
  "last_tested_at" TIMESTAMP(3),
  "last_test_succeeded" BOOLEAN,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "olho_de_deus_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "olho_de_deus_integrations_org_id_key"
  ON "olho_de_deus_integrations"("org_id");

ALTER TABLE "olho_de_deus_integrations"
  ADD CONSTRAINT "olho_de_deus_integrations_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

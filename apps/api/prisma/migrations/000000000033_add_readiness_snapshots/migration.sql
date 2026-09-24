-- Snapshot agregado e imutável para comparar prontidão sem misturar
-- maturidade operacional, integrações externas ou dados pessoais.
CREATE TABLE "readiness_snapshots" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "label" TEXT,
  "operational" JSONB NOT NULL,
  "integration" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "readiness_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "readiness_snapshots_org_id_created_at_idx"
  ON "readiness_snapshots"("org_id", "created_at");

ALTER TABLE "readiness_snapshots"
  ADD CONSTRAINT "readiness_snapshots_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "readiness_snapshots"
  ADD CONSTRAINT "readiness_snapshots_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

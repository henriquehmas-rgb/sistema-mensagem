-- Variações sociais de baixo risco, isoladas por organização e fora do RAG.
CREATE TABLE "language_variants" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "evidence_count" INTEGER NOT NULL,
    "route_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "language_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "language_variants_org_id_normalized_text_kind_key"
    ON "language_variants"("org_id", "normalized_text", "kind");
CREATE INDEX "language_variants_org_id_kind_status_idx"
    ON "language_variants"("org_id", "kind", "status");
ALTER TABLE "language_variants" ADD CONSTRAINT "language_variants_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

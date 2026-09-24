CREATE TYPE "GlobalDirectiveStatus" AS ENUM (
  'DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REPLACED'
);

CREATE TABLE "global_directives" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "GlobalDirectiveStatus" NOT NULL DEFAULT 'DRAFT',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "principles" JSONB NOT NULL DEFAULT '[]',
  "prohibitions" JSONB NOT NULL DEFAULT '[]',
  "owner" TEXT,
  "valid_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "global_directives_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "global_directives_org_id_key_version_key"
  ON "global_directives"("org_id", "key", "version");
CREATE INDEX "global_directives_org_id_status_priority_idx"
  ON "global_directives"("org_id", "status", "priority");
ALTER TABLE "global_directives"
  ADD CONSTRAINT "global_directives_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

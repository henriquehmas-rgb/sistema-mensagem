CREATE TYPE "OperationalSkillStatus" AS ENUM (
  'DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REPLACED'
);

CREATE TABLE "operational_skills" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "department_id" TEXT,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "OperationalSkillStatus" NOT NULL DEFAULT 'DRAFT',
  "trigger_conditions" JSONB NOT NULL DEFAULT '[]',
  "required_data" JSONB NOT NULL DEFAULT '[]',
  "allowed_sources" JSONB NOT NULL DEFAULT '[]',
  "protocol_steps" JSONB NOT NULL DEFAULT '[]',
  "allowed_actions" JSONB NOT NULL DEFAULT '[]',
  "forbidden_actions" JSONB NOT NULL DEFAULT '[]',
  "completion_criteria" JSONB NOT NULL DEFAULT '[]',
  "review_conditions" JSONB NOT NULL DEFAULT '[]',
  "human_handoff_conditions" JSONB NOT NULL DEFAULT '[]',
  "identity_requirement" TEXT NOT NULL DEFAULT 'NONE',
  "minimum_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "owner" TEXT,
  "valid_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "operational_skills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_skills_org_id_key_version_key"
  ON "operational_skills"("org_id", "key", "version");
CREATE INDEX "operational_skills_org_id_status_idx"
  ON "operational_skills"("org_id", "status");
CREATE INDEX "operational_skills_org_id_department_id_status_idx"
  ON "operational_skills"("org_id", "department_id", "status");

ALTER TABLE "operational_skills"
  ADD CONSTRAINT "operational_skills_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_skills"
  ADD CONSTRAINT "operational_skills_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

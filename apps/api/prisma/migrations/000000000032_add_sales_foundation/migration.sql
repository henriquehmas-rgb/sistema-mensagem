CREATE TYPE "SalesOpportunityStatus" AS ENUM ('OPEN', 'ON_HOLD', 'WON', 'LOST');
CREATE TYPE "SalesStageCategory" AS ENUM ('NEW', 'QUALIFYING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'ON_HOLD');
CREATE TYPE "SalesTaskStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

CREATE TABLE "sales_pipelines" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "department_id" TEXT,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_pipelines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_stages" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "pipeline_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" "SalesStageCategory" NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#6366f1',
  "position" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_opportunities" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "department_id" TEXT,
  "pipeline_id" TEXT NOT NULL,
  "stage_id" TEXT NOT NULL,
  "assignee_id" TEXT,
  "created_by_id" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "status" "SalesOpportunityStatus" NOT NULL DEFAULT 'OPEN',
  "estimated_value_cents" INTEGER,
  "next_action" TEXT,
  "next_action_at" TIMESTAMP(3),
  "hold_reason" TEXT,
  "closed_reason" TEXT,
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_opportunities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_tasks" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "opportunity_id" TEXT NOT NULL,
  "assignee_id" TEXT,
  "title" TEXT NOT NULL,
  "due_at" TIMESTAMP(3),
  "status" "SalesTaskStatus" NOT NULL DEFAULT 'OPEN',
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_activities" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "opportunity_id" TEXT NOT NULL,
  "author_id" TEXT,
  "type" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_pipelines_org_id_name_key" ON "sales_pipelines"("org_id", "name");
CREATE UNIQUE INDEX "sales_stages_pipeline_id_position_key" ON "sales_stages"("pipeline_id", "position");
CREATE INDEX "sales_pipelines_org_id_is_active_idx" ON "sales_pipelines"("org_id", "is_active");
CREATE INDEX "sales_pipelines_org_id_department_id_idx" ON "sales_pipelines"("org_id", "department_id");
CREATE INDEX "sales_stages_org_id_pipeline_id_is_active_position_idx" ON "sales_stages"("org_id", "pipeline_id", "is_active", "position");
CREATE INDEX "sales_opportunities_org_id_status_next_action_at_idx" ON "sales_opportunities"("org_id", "status", "next_action_at");
CREATE INDEX "sales_opportunities_org_id_pipeline_id_stage_id_idx" ON "sales_opportunities"("org_id", "pipeline_id", "stage_id");
CREATE INDEX "sales_opportunities_org_id_contact_id_created_at_idx" ON "sales_opportunities"("org_id", "contact_id", "created_at");
CREATE INDEX "sales_opportunities_org_id_conversation_id_idx" ON "sales_opportunities"("org_id", "conversation_id");
CREATE INDEX "sales_tasks_org_id_status_due_at_idx" ON "sales_tasks"("org_id", "status", "due_at");
CREATE INDEX "sales_tasks_org_id_opportunity_id_idx" ON "sales_tasks"("org_id", "opportunity_id");
CREATE INDEX "sales_activities_org_id_opportunity_id_created_at_idx" ON "sales_activities"("org_id", "opportunity_id", "created_at");

ALTER TABLE "sales_pipelines" ADD CONSTRAINT "sales_pipelines_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_pipelines" ADD CONSTRAINT "sales_pipelines_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_stages" ADD CONSTRAINT "sales_stages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_stages" ADD CONSTRAINT "sales_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "sales_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "sales_pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "sales_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_tasks" ADD CONSTRAINT "sales_tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_tasks" ADD CONSTRAINT "sales_tasks_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_tasks" ADD CONSTRAINT "sales_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_activities" ADD CONSTRAINT "sales_activities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_activities" ADD CONSTRAINT "sales_activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_activities" ADD CONSTRAINT "sales_activities_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

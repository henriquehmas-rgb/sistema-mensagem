-- Estrutura operacional do atendimento: protocolo, departamento e encerramento.
CREATE TABLE "departments" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "color" TEXT NOT NULL DEFAULT '#6366f1',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "resolution_reasons" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "resolution_reasons_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "conversations" ADD COLUMN "protocol" TEXT;
ALTER TABLE "conversations" ADD COLUMN "department_id" TEXT;
ALTER TABLE "conversations" ADD COLUMN "resolution_reason_id" TEXT;
ALTER TABLE "conversations" ADD COLUMN "resolution_note" TEXT;
ALTER TABLE "conversations" ADD COLUMN "resolved_at" TIMESTAMP(3);

-- Toda organização recebe uma fila padrão e motivos mínimos utilizáveis logo
-- após a migração, sem depender de executar seed em produção.
INSERT INTO "departments" ("id", "org_id", "name", "description", "is_default", "updated_at")
SELECT 'dep_' || substr(md5("id" || ':default'), 1, 24), "id", 'Atendimento Geral',
       'Fila padrão para novos atendimentos', true, CURRENT_TIMESTAMP
FROM "organizations";

INSERT INTO "resolution_reasons" ("id", "org_id", "name", "updated_at")
SELECT 'rr_' || substr(md5("id" || ':' || reason), 1, 24), "id", reason, CURRENT_TIMESTAMP
FROM "organizations"
CROSS JOIN (VALUES ('Dúvida resolvida'), ('Solicitação concluída'), ('Encaminhado para outro setor'),
                   ('Histórico migrado sem motivo')) AS defaults(reason);

-- Backfill determinístico e sem exposição de dados do cliente.
UPDATE "conversations"
SET "protocol" = 'SEEG-' || upper(substr(md5("id"), 1, 12));
UPDATE "conversations" AS c
SET "department_id" = d."id"
FROM "departments" AS d
WHERE d."org_id" = c."org_id" AND d."is_default" = true;
UPDATE "conversations" AS c
SET "resolution_reason_id" = r."id", "resolved_at" = c."updated_at"
FROM "resolution_reasons" AS r
WHERE c."status" = 'RESOLVED' AND r."org_id" = c."org_id"
  AND r."name" = 'Histórico migrado sem motivo';
ALTER TABLE "conversations" ALTER COLUMN "protocol" SET NOT NULL;

CREATE UNIQUE INDEX "conversations_protocol_key" ON "conversations"("protocol");
CREATE UNIQUE INDEX "departments_org_id_name_key" ON "departments"("org_id", "name");
CREATE INDEX "departments_org_id_is_active_idx" ON "departments"("org_id", "is_active");
CREATE UNIQUE INDEX "resolution_reasons_org_id_name_key" ON "resolution_reasons"("org_id", "name");
CREATE INDEX "resolution_reasons_org_id_is_active_idx" ON "resolution_reasons"("org_id", "is_active");
CREATE INDEX "conversations_org_id_department_id_status_idx" ON "conversations"("org_id", "department_id", "status");

ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resolution_reasons" ADD CONSTRAINT "resolution_reasons_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_resolution_reason_id_fkey"
  FOREIGN KEY ("resolution_reason_id") REFERENCES "resolution_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

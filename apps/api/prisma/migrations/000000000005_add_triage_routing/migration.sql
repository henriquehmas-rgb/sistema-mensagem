ALTER TABLE "departments" ADD COLUMN "routing_key" TEXT;
ALTER TABLE "conversations" ADD COLUMN "last_intent" TEXT;
ALTER TABLE "conversations" ADD COLUMN "triage_confidence" DOUBLE PRECISION;
ALTER TABLE "conversations" ADD COLUMN "triaged_at" TIMESTAMP(3);

UPDATE "departments" SET "routing_key" = 'general' WHERE "is_default" = true;

INSERT INTO "departments" ("id", "org_id", "name", "description", "color", "routing_key", "updated_at")
SELECT 'dep_' || substr(md5(o."id" || ':' || d.key), 1, 24), o."id", d.name, d.description, d.color, d.key, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
  ('technical_support', 'Suporte Técnico', 'Falhas, conexão, equipamentos e suporte técnico', '#0ea5e9'),
  ('billing', 'Financeiro', 'Faturas, pagamentos, cobranças e segunda via', '#f59e0b'),
  ('sales', 'Comercial', 'Planos, preços, contratação e upgrade', '#22c55e'),
  ('retention', 'Cancelamento e Retenção', 'Cancelamento, insatisfação e retenção', '#ef4444')
) AS d(key, name, description, color)
WHERE NOT EXISTS (
  SELECT 1 FROM "departments" existing
  WHERE existing."org_id" = o."id" AND existing."routing_key" = d.key
);

CREATE UNIQUE INDEX "departments_org_id_routing_key_key" ON "departments"("org_id", "routing_key");

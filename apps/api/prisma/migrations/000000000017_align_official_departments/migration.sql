-- Os setores oficiais são Suporte, Financeiro e Vendas.
-- Retenção continua como intenção/especialidade, roteada para Vendas.

UPDATE "conversations" AS c
SET "department_id" = sales."id"
FROM "departments" AS legacy
JOIN "departments" AS sales
  ON sales."org_id" = legacy."org_id" AND sales."routing_key" = 'sales'
WHERE c."department_id" = legacy."id"
  AND legacy."routing_key" = 'retention';

UPDATE "users" AS u
SET "department_id" = sales."id"
FROM "departments" AS legacy
JOIN "departments" AS sales
  ON sales."org_id" = legacy."org_id" AND sales."routing_key" = 'sales'
WHERE u."department_id" = legacy."id"
  AND legacy."routing_key" = 'retention';

UPDATE "knowledge_gaps" AS gap
SET "department_id" = sales."id"
FROM "departments" AS legacy
JOIN "departments" AS sales
  ON sales."org_id" = legacy."org_id" AND sales."routing_key" = 'sales'
WHERE gap."department_id" = legacy."id"
  AND legacy."routing_key" = 'retention';

UPDATE "operational_skills" AS skill
SET "department_id" = sales."id"
FROM "departments" AS legacy
JOIN "departments" AS sales
  ON sales."org_id" = legacy."org_id" AND sales."routing_key" = 'sales'
WHERE skill."department_id" = legacy."id"
  AND legacy."routing_key" = 'retention';

UPDATE "departments" AS sales
SET "name" = 'Vendas',
    "description" = 'Planos, contratação, upgrade, cancelamento e retenção',
    "updated_at" = CURRENT_TIMESTAMP
WHERE sales."routing_key" = 'sales'
  AND NOT EXISTS (
    SELECT 1 FROM "departments" AS existing
    WHERE existing."org_id" = sales."org_id"
      AND existing."id" <> sales."id"
      AND lower(existing."name") = lower('Vendas')
  );

UPDATE "departments" AS support
SET "name" = 'Suporte',
    "description" = 'Conexão, equipamentos, diagnóstico e suporte técnico',
    "updated_at" = CURRENT_TIMESTAMP
WHERE support."routing_key" = 'technical_support'
  AND NOT EXISTS (
    SELECT 1 FROM "departments" AS existing
    WHERE existing."org_id" = support."org_id"
      AND existing."id" <> support."id"
      AND lower(existing."name") = lower('Suporte')
  );

UPDATE "departments"
SET "routing_key" = NULL,
    "is_active" = false,
    "name" = 'Cancelamento e Retenção (legado)',
    "description" = 'Departamento legado; solicitações de retenção agora pertencem a Vendas',
    "is_default" = false,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "routing_key" = 'retention';

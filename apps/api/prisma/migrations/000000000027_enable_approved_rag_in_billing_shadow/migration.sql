-- Financeiro permanece em DRAFT e fora do piloto. Esta migração somente
-- permite que suas skills de sombra consultem fontes RAG já aprovadas, assim
-- como as skills equivalentes de Vendas. Não libera escrita, não ativa skill
-- e não altera conversas, dados do IXC ou permissões de clientes.
UPDATE operational_skills AS skill
SET allowed_sources = skill.allowed_sources || '["RAG_APPROVED"]'::jsonb,
    updated_at = now()
FROM departments AS department
WHERE skill.department_id = department.id
  AND department.routing_key = 'billing'
  AND skill.status = 'DRAFT'
  AND NOT (skill.allowed_sources ? 'RAG_APPROVED');

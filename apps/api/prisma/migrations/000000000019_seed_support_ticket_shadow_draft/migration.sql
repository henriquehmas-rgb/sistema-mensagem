-- Piloto de Suporte: rascunho idempotente para simulação de chamado.
-- Não ativa a skill e não concede execução de escrita externa.

INSERT INTO "operational_skills" (
  "id", "org_id", "department_id", "key", "name", "description", "version", "status",
  "trigger_conditions", "required_data", "allowed_sources", "protocol_steps",
  "allowed_actions", "forbidden_actions", "completion_criteria", "review_conditions",
  "human_handoff_conditions", "identity_requirement", "minimum_confidence", "owner",
  "created_at", "updated_at"
)
SELECT
  'skill_' || md5(org."id" || ':support-connectivity-ticket:1'),
  org."id",
  dep."id",
  'support-connectivity-ticket',
  'Abertura segura de chamado de conectividade',
  'Prepara chamado de Suporte com identidade, evidência, ocorrência e deduplicação em modo SHADOW.',
  1,
  'DRAFT'::"OperationalSkillStatus",
  '["Ausência total de conexão confirmada após triagem segura"]'::jsonb,
  '["Identidade validada", "Cliente e contrato inequívocos", "Ocorrência identificada", "Ausência de rompimento coletivo incompatível"]'::jsonb,
  '["POLICY_APPROVED", "IXC_READ", "OLHO_DE_DEUS_SHADOW", "CONVERSATION_CONTEXT"]'::jsonb,
  '["Validar identidade", "Confirmar cliente e contrato", "Consultar incidente coletivo", "Consultar chamado ou OS semelhante", "Resolver o mapeamento support.connectivity.ticket", "Preparar proposta sem escrita externa"]'::jsonb,
  '["read_ticket", "read_service_order", "request_ticket"]'::jsonb,
  '["request_service_order", "execute_external_write", "choose_external_subject_id", "change_ticket_priority", "promise_deadline"]'::jsonb,
  '["Proposta SHADOW registrada com mapeamento versionado e evidências", "Duplicidade ou necessidade de revisão identificada"]'::jsonb,
  '["Duplicidade possível", "Fonte indisponível ou conflitante", "Mapeamento não homologado", "Ausência de ocorrência explícita"]'::jsonb,
  '["GAP técnico real", "Exceção operacional", "Ação real ainda não homologada"]'::jsonb,
  'LAST_3_CPF',
  0.90,
  'GRUPO SEEG',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "organizations" org
JOIN "departments" dep
  ON dep."org_id" = org."id"
 AND dep."routing_key" = 'technical_support'
 AND dep."is_active" = true
WHERE NOT EXISTS (
  SELECT 1
    FROM "operational_skills" existing
   WHERE existing."org_id" = org."id"
     AND existing."key" = 'support-connectivity-ticket'
     AND existing."version" = 1
);

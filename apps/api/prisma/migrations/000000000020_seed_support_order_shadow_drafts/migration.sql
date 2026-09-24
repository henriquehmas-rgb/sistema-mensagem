-- Rascunhos de OS para homologação futura. Nenhuma skill é ativada.

WITH definitions AS (
  SELECT * FROM jsonb_to_recordset($skills$
  [
    {
      "key":"support-fiber-los-service-order",
      "name":"OS para perda de sinal de fibra",
      "description":"Prepara OS de fibra LOS somente após falha individual confirmada.",
      "mappingKey":"support.fiber_los.service_order",
      "triggers":["Perda de sinal óptico individual confirmada"],
      "required":["Identidade validada","Contrato e login inequívocos","Falha individual confirmada","Ausência de rompimento coletivo","Chamado de origem identificado"],
      "steps":["Consultar evento coletivo","Consultar conexão e registros existentes","Confirmar falha individual","Vincular chamado de origem","Preparar OS em SHADOW"],
      "review":["Duplicidade possível","Evidência inconclusiva","Prazo, custo ou visita sem fonte"]
    },
    {
      "key":"support-signal-correction-service-order",
      "name":"OS para correção de sinal",
      "description":"Prepara OS de correção de sinal somente após diagnóstico individual homologado.",
      "mappingKey":"support.signal_correction.service_order",
      "triggers":["Sinal degradado individual confirmado após diagnóstico seguro"],
      "required":["Identidade validada","Contrato e login inequívocos","Falha individual confirmada","Ausência de rompimento coletivo","Chamado de origem identificado"],
      "steps":["Consultar evento coletivo","Consultar conexão e registros existentes","Confirmar sinal degradado individual","Vincular chamado de origem","Preparar OS em SHADOW"],
      "review":["Duplicidade possível","Evidência inconclusiva","Prazo, custo ou visita sem fonte"]
    }
  ]$skills$::jsonb) AS value(
    "key" text, "name" text, "description" text, "mappingKey" text,
    "triggers" jsonb, "required" jsonb, "steps" jsonb, "review" jsonb
  )
)
INSERT INTO "operational_skills" (
  "id", "org_id", "department_id", "key", "name", "description", "version", "status",
  "trigger_conditions", "required_data", "allowed_sources", "protocol_steps",
  "allowed_actions", "forbidden_actions", "completion_criteria", "review_conditions",
  "human_handoff_conditions", "identity_requirement", "minimum_confidence", "owner",
  "created_at", "updated_at"
)
SELECT
  'skill_' || md5(org."id" || ':' || def."key" || ':1'),
  org."id", dep."id", def."key", def."name", def."description", 1,
  'DRAFT'::"OperationalSkillStatus",
  def."triggers",
  def."required" || jsonb_build_array('Mapeamento controlado: ' || def."mappingKey"),
  '["POLICY_APPROVED", "IXC_READ", "OLHO_DE_DEUS_SHADOW", "CONVERSATION_CONTEXT"]'::jsonb,
  def."steps",
  '["read_ticket", "read_service_order", "request_service_order"]'::jsonb,
  '["request_ticket", "execute_external_write", "choose_external_subject_id", "change_ticket_priority", "promise_deadline"]'::jsonb,
  '["Proposta SHADOW vinculada ao chamado e à ocorrência", "Bloqueio ou revisão registrados com evidências"]'::jsonb,
  def."review",
  '["GAP técnico real", "Evento coletivo", "Ação real ainda não homologada"]'::jsonb,
  'LAST_3_CPF', 0.90, 'GRUPO SEEG', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" org
JOIN "departments" dep
  ON dep."org_id" = org."id"
 AND dep."routing_key" = 'technical_support'
 AND dep."is_active" = true
CROSS JOIN definitions def
WHERE NOT EXISTS (
  SELECT 1 FROM "operational_skills" existing
   WHERE existing."org_id" = org."id"
     AND existing."key" = def."key"
     AND existing."version" = 1
);

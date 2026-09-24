-- Habilidades derivadas de padrões anonimizados da curadoria OPA.
-- Permanecem em DRAFT/sombra: nenhuma consulta, renovação, proposta, contato
-- ou criação de lead é executada por esta migration.

WITH definitions AS (
  SELECT * FROM jsonb_to_recordset($skills$
  [
    {
      "key":"billing-contract-summary",
      "name":"Consulta de contratos e renovação em modo sombra",
      "description":"Organiza uma consulta de contratos ativos ou renovação somente após identidade, sem renovar, alterar ou prometer condições.",
      "routeKey":"billing",
      "identity":"LAST_3_CPF",
      "confidence":0.92,
      "triggers":["Consulta de contratos ativos","Dúvida sobre renovação de contrato ou serviços vinculados"],
      "required":["Identidade validada","Contrato correto","Situação atual em fonte IXC autorizada"],
      "sources":["POLICY_APPROVED","IXC_READ","RAG_APPROVED","CONVERSATION_CONTEXT"],
      "steps":["Confirmar identidade antes de qualquer dado individual","Consultar somente contratos atuais na fonte autorizada","Diferenciar informação atual de renovação solicitada","Preparar revisão para proposta, renovação ou condição individual"],
      "allowed":["read_contract","summarize_current_contracts","prepare_contract_renewal_review","create_financial_gap"],
      "forbidden":["renew_contract","change_contract","promise_terms","send_proposal","execute_external_write"],
      "completion":["Consulta atual resumida com fonte autorizada","Renovação preparada para revisão sem promessa"],
      "review":["Fonte IXC indisponível","Contrato ambíguo","Pedido de condição ou renovação individual"],
      "handoff":["financial_contract_review_required","GAP financeiro"]
    },
    {
      "key":"sales-business-qualification",
      "name":"Qualificação de internet comercial",
      "description":"Entende a necessidade de uma empresa em linguagem livre antes de indicar opções oficiais, sem prometer cobertura, preço ou contato.",
      "routeKey":"sales",
      "identity":"NONE",
      "confidence":0.90,
      "triggers":["Interesse em internet comercial ou plano para empresa","Necessidade de conectividade para equipe, nuvem ou videoconferência"],
      "required":["Necessidade declarada","Porte ou uso aproximado quando necessário","Fonte oficial para portfólio e cobertura"],
      "sources":["POLICY_APPROVED","RAG_APPROVED","CONVERSATION_CONTEXT"],
      "steps":["Acolher texto livre sem exigir resposta de menu","Fazer uma pergunta proporcional por vez sobre uso da empresa","Explicar que cobertura e condição dependem de fonte oficial","Preparar contexto mínimo para proposta ou cobertura em modo sombra"],
      "allowed":["qualify_business_need","collect_minimum_coverage_context","prepare_lead_intake","create_commercial_gap"],
      "forbidden":["guarantee_coverage","quote_unapproved_price","register_lead","send_message","place_call","execute_external_write"],
      "completion":["Necessidade empresarial resumida","Próximo passo preparado sem promessa ou contato automático"],
      "review":["Cobertura ou portfólio sem fonte oficial","Pedido de preço, desconto ou condição individual","Consentimento de contato ambíguo"],
      "handoff":["commercial_review_required","GAP comercial"]
    }
  ]
  $skills$::jsonb) AS d(
    "key" text, "name" text, "description" text, "routeKey" text,
    "identity" text, "confidence" double precision, "triggers" jsonb,
    "required" jsonb, "sources" jsonb, "steps" jsonb, "allowed" jsonb,
    "forbidden" jsonb, "completion" jsonb, "review" jsonb, "handoff" jsonb
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
  'skill_' || md5(org."id" || ':' || d."key" || ':1'),
  org."id", dep."id", d."key", d."name", d."description", 1,
  'DRAFT'::"OperationalSkillStatus",
  d."triggers", d."required", d."sources", d."steps", d."allowed", d."forbidden",
  d."completion", d."review", d."handoff", d."identity", d."confidence", 'GRUPO SEEG',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" org
CROSS JOIN definitions d
JOIN "departments" dep
  ON dep."org_id" = org."id"
 AND dep."routing_key" = d."routeKey"
 AND dep."is_active" = true
WHERE NOT EXISTS (
  SELECT 1 FROM "operational_skills" existing
  WHERE existing."org_id" = org."id"
    AND existing."key" = d."key"
    AND existing."version" = 1
);

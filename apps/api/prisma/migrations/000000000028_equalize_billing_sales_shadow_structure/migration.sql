-- Equaliza a matriz estrutural de Financeiro e Vendas com Suporte.
-- Nenhuma skill é ativada, nenhuma conversa é alterada e nenhuma escrita em
-- sistema externo é liberada por esta migration.

-- O cadastro de lead continua sem conector factual homologado. A skill pode
-- preparar o contexto e o consentimento, mas nunca grava um lead fora do Omni.
UPDATE "operational_skills" AS skill
SET "allowed_actions" = (
      SELECT COALESCE(jsonb_agg(action), '[]'::jsonb)
      FROM jsonb_array_elements_text(skill."allowed_actions") AS action
      WHERE action <> 'register_lead'
    ) || '["prepare_lead_intake"]'::jsonb,
    "updated_at" = now()
FROM "departments" AS department
WHERE skill."department_id" = department."id"
  AND department."routing_key" = 'sales'
  AND skill."key" = 'sales-plan-qualification'
  AND skill."status" = 'DRAFT'
  AND skill."allowed_actions" ? 'register_lead';

WITH definitions AS (
  SELECT * FROM jsonb_to_recordset($skills$
  [
    {
      "key":"billing-policy-boundary",
      "name":"Políticas financeiras e limites de negociação",
      "description":"Explica regras gerais aprovadas e bloqueia qualquer condição individual, acordo ou alteração financeira.",
      "routeKey":"billing",
      "identity":"LAST_3_CPF",
      "confidence":0.92,
      "triggers":["Dúvida sobre parcelamento, acordo, juros, multa ou condição de cobrança","Pedido de desconto, renegociação ou alteração individual"],
      "required":["Política geral aprovada","Identidade validada apenas quando a dúvida envolver contrato ou condição individual"],
      "sources":["POLICY_APPROVED","RAG_APPROVED","CONVERSATION_CONTEXT"],
      "steps":["Distinguir política geral de pedido individual","Responder somente a regra aprovada e aplicável","Não inferir condição do contrato","Criar revisão financeira para acordo, desconto, parcelamento ou alteração"],
      "allowed":["explain_approved_financial_policy","prepare_financial_terms_review","create_financial_gap"],
      "forbidden":["grant_discount","negotiate_terms","change_due_date","change_amount","promise_approval","execute_external_write"],
      "completion":["Política geral respondida com fonte aprovada","Pedido individual preparado para revisão"],
      "review":["Qualquer condição individual","Política ausente, ambígua ou desatualizada"],
      "handoff":["financial_terms_approval_required","GAP financeiro"]
    },
    {
      "key":"sales-coverage-intake",
      "name":"Triagem de cobertura e disponibilidade",
      "description":"Coleta somente o contexto necessário e prepara a verificação de cobertura sem garanti-la ou registrar lead externamente.",
      "routeKey":"sales",
      "identity":"NONE",
      "confidence":0.90,
      "triggers":["Pergunta sobre cobertura, disponibilidade ou viabilidade de instalação","Cliente informa endereço para verificar atendimento"],
      "required":["Localidade mínima necessária","Fonte oficial de cobertura quando disponível","Consentimento para qualquer contato posterior"],
      "sources":["POLICY_APPROVED","RAG_APPROVED","CONVERSATION_CONTEXT"],
      "steps":["Explicar o que será verificado sem prometer resultado","Coletar somente a localidade mínima necessária","Consultar fonte oficial quando houver integração homologada","Preparar revisão comercial quando a fonte não existir ou for inconclusiva"],
      "allowed":["collect_minimum_coverage_context","prepare_coverage_review","create_commercial_gap"],
      "forbidden":["guarantee_coverage","invent_availability","register_lead","promise_installation_date","execute_external_write"],
      "completion":["Cobertura confirmada por fonte oficial","Revisão comercial preparada com contexto mínimo"],
      "review":["Fonte de cobertura indisponível","Endereço ambíguo","Elegibilidade inconclusiva"],
      "handoff":["coverage_verification_required","GAP comercial"]
    },
    {
      "key":"sales-follow-up-consent",
      "name":"Consentimento e próximo contato comercial",
      "description":"Registra a intenção de acompanhamento somente em modo sombra e sem enviar mensagens ou criar lead externo.",
      "routeKey":"sales",
      "identity":"NONE",
      "confidence":0.90,
      "triggers":["Cliente pede retorno, ligação, mensagem ou acompanhamento","Cliente confirma interesse em continuar a proposta depois"],
      "required":["Canal e momento de contato declarados pelo cliente","Consentimento explícito","Resumo mínimo do interesse"],
      "sources":["POLICY_APPROVED","RAG_APPROVED","CONVERSATION_CONTEXT"],
      "steps":["Confirmar que o contato foi solicitado","Registrar canal e momento sem supor consentimento","Preparar contexto para o fluxo homologado","Respeitar opt-out imediatamente"],
      "allowed":["prepare_follow_up_consent","prepare_lead_intake","record_opt_out_context"],
      "forbidden":["send_message","place_call","register_lead","contact_without_consent","ignore_opt_out","execute_external_write"],
      "completion":["Consentimento ou recusa resumidos em modo sombra","Próximo passo informado sem promessa de contato"],
      "review":["Canal ou consentimento ambíguo","Pedido de contato fora de canal homologado"],
      "handoff":["commercial_follow_up_review_required","GAP comercial"]
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

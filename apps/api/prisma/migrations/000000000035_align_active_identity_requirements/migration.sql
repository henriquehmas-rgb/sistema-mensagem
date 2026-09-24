-- O fluxo publicado valida CPF completo em memória e persiste apenas o
-- resultado mascarado. Protocolos ativos antigos ainda declaravam a regra
-- obsoleta dos três últimos dígitos, o que gerava perguntas divergentes.
UPDATE "operational_skills"
SET "identity_requirement" = 'STRONG',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'ACTIVE'
  AND "identity_requirement" = 'LAST_3_CPF';

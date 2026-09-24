-- Ativa somente a camada resolutiva de diagnóstico já aprovada pelo responsável.
-- Mantém confiança alta e não libera escrita em IXC/Olho de Deus.
UPDATE "operational_skills"
SET
  "status" = 'ACTIVE'::"OperationalSkillStatus",
  "minimum_confidence" = GREATEST("minimum_confidence", 0.90),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'support-core-diagnosis'
  AND "version" = 1
  AND "status" IN (
    'DRAFT'::"OperationalSkillStatus",
    'IN_REVIEW'::"OperationalSkillStatus",
    'APPROVED'::"OperationalSkillStatus",
    'SUSPENDED'::"OperationalSkillStatus"
  );

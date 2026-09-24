ALTER TABLE "users" ADD COLUMN "department_id" TEXT;

UPDATE "users" AS u
SET "department_id" = d."id"
FROM "departments" AS d
WHERE u."org_id" = d."org_id"
  AND u."role" = 'AGENT'
  AND d."is_default" = true;

ALTER TABLE "users"
ADD CONSTRAINT "users_department_id_fkey"
FOREIGN KEY ("department_id") REFERENCES "departments"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_org_id_department_id_idx" ON "users"("org_id", "department_id");

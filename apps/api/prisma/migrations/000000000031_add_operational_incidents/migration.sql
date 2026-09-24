CREATE TYPE "OperationalIncidentSeverity" AS ENUM ('P1', 'P2', 'P3');
CREATE TYPE "OperationalIncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

CREATE TABLE "operational_incidents" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "severity" "OperationalIncidentSeverity" NOT NULL,
  "status" "OperationalIncidentStatus" NOT NULL DEFAULT 'OPEN',
  "occurrence_count" INTEGER NOT NULL DEFAULT 1,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_notification_at" TIMESTAMP(3),
  "acknowledged_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "operational_incidents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_incidents_org_id_fingerprint_key"
  ON "operational_incidents"("org_id", "fingerprint");
CREATE INDEX "operational_incidents_org_id_status_severity_last_seen_at_idx"
  ON "operational_incidents"("org_id", "status", "severity", "last_seen_at");

ALTER TABLE "operational_incidents"
  ADD CONSTRAINT "operational_incidents_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

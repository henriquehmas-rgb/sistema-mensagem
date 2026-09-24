CREATE TABLE "network_topology_calibration_evidence" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "mapping_id" TEXT NOT NULL,
  "event_fingerprint" TEXT NOT NULL,
  "evidence_fingerprint" TEXT NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "network_topology_calibration_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "network_topology_calibration_evidence_mapping_id_event_fingerprint_key"
  ON "network_topology_calibration_evidence"("mapping_id", "event_fingerprint");

CREATE INDEX "network_topology_calibration_evidence_org_id_mapping_id_observed_at_idx"
  ON "network_topology_calibration_evidence"("org_id", "mapping_id", "observed_at");

ALTER TABLE "network_topology_calibration_evidence"
  ADD CONSTRAINT "network_topology_calibration_evidence_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "network_topology_calibration_evidence"
  ADD CONSTRAINT "network_topology_calibration_evidence_mapping_id_fkey"
  FOREIGN KEY ("mapping_id") REFERENCES "network_topology_mappings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

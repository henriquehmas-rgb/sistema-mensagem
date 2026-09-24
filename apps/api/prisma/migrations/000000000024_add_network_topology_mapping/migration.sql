CREATE TYPE "NetworkTopologyMappingKind" AS ENUM (
  'IXC_CUSTOMER',
  'IXC_CONNECTION',
  'IXC_FTTH_BOX',
  'IXC_CONCENTRATOR',
  'REGION'
);

CREATE TYPE "NetworkTopologyMappingStatus" AS ENUM ('SHADOW', 'CONFIRMED', 'RETIRED');

CREATE TABLE "network_topology_mappings" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "reference_kind" "NetworkTopologyMappingKind" NOT NULL,
  "reference_fingerprint" TEXT NOT NULL,
  "encrypted_reference" TEXT NOT NULL,
  "topology_fingerprint" TEXT NOT NULL,
  "encrypted_topology" TEXT NOT NULL,
  "status" "NetworkTopologyMappingStatus" NOT NULL DEFAULT 'SHADOW',
  "evidence_reference" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "retired_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "network_topology_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "network_topology_mappings_org_id_reference_kind_reference_fingerprint_topology_fingerprint_key"
  ON "network_topology_mappings"("org_id", "reference_kind", "reference_fingerprint", "topology_fingerprint");

CREATE INDEX "network_topology_mappings_org_id_status_reference_kind_idx"
  ON "network_topology_mappings"("org_id", "status", "reference_kind");

ALTER TABLE "network_topology_mappings"
  ADD CONSTRAINT "network_topology_mappings_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

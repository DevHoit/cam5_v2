CREATE TABLE IF NOT EXISTS "gateway_rate_limits" (
  "gateway_id" uuid NOT NULL REFERENCES "gateways"("id") ON DELETE CASCADE,
  "operation" text NOT NULL CHECK ("operation" IN ('ingest', 'heartbeat')),
  "requests" timestamptz[] NOT NULL DEFAULT '{}',
  "accepted" boolean NOT NULL DEFAULT true,
  PRIMARY KEY ("gateway_id", "operation"),
  CHECK (cardinality("requests") <= 120)
);

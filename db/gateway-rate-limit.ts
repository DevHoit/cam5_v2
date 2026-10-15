import { sql } from "drizzle-orm";
import type { Cam5Database } from "./index";

export const GATEWAY_REQUEST_LIMIT = 120;
export type GatewayOperation = "ingest" | "heartbeat";

/** One atomic upsert: every instance shares the same 60-second sliding window.
 * Heartbeats have a separate budget so an upload backlog cannot hide gateway health.
 * Production uses the database clock. `at` is only for deterministic tests.
 */
export async function consumeGatewayQuota(db: Cam5Database, gatewayId: string, operation: GatewayOperation, at?: Date) {
  const now = at ? sql`${at.toISOString()}::timestamptz` : sql`statement_timestamp()`;
  const retained = sql`ARRAY(SELECT t FROM unnest(gateway_rate_limits.requests) AS t WHERE t > ${now} - interval '60 seconds' ORDER BY t)`;
  const available = sql`cardinality(${retained}) < ${GATEWAY_REQUEST_LIMIT}`;
  const result = await db.execute(sql`
    INSERT INTO gateway_rate_limits (gateway_id, operation, requests, accepted)
    VALUES (${gatewayId}::uuid, ${operation}, ARRAY[${now}], true)
    ON CONFLICT (gateway_id, operation) DO UPDATE SET
      requests = CASE WHEN ${available} THEN array_append(${retained}, ${now}) ELSE ${retained} END,
      accepted = ${available}
    RETURNING accepted, CASE WHEN accepted THEN 0 ELSE
      greatest(1, ceil(extract(epoch FROM (requests[1] + interval '60 seconds' - ${now}))))::int
    END AS retry_after_seconds
  `);
  // postgres-js returns rows directly; PGlite returns { rows }.
  const rows = Array.isArray(result) ? result : (result as unknown as { rows: Record<string, unknown>[] }).rows;
  const row = rows[0];
  if (!row) throw new Error("No se pudo comprobar la cuota del gateway.");
  return { accepted: row.accepted === true, retryAfterSeconds: Number(row.retry_after_seconds) };
}

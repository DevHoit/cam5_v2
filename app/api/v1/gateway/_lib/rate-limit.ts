import type { Cam5Database } from "../../../../../db/index";
import { consumeGatewayQuota, type GatewayOperation } from "../../../../../db/gateway-rate-limit";
import { ApiError } from "../../_lib/auth";

export async function checkIngestRateLimit(db: Cam5Database, gatewayId: string, operation: GatewayOperation) {
  const result = await consumeGatewayQuota(db, gatewayId, operation);
  if (!result.accepted) {
    throw new ApiError(429, "Cuota temporal del gateway excedida. Conserva el lote y reintenta después del intervalo indicado.", { "Retry-After": String(result.retryAfterSeconds) });
  }
}

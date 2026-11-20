import type { NextRequest } from "next/server";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { ACTIVITY_WRITE_INTERVAL_MS } from "../../../../../db/auth";
import { hashGatewayToken } from "../../../../../db/gateway-auth";
import { getDb } from "../../../../../db/index";
import { clients, gatewayApiCredentials, gateways, sites } from "../../../../../db/schema";
import { ApiError } from "../../_lib/auth";

/**
 * Token del gateway: "Authorization: Bearer cam5gw_…" (gateways Linux) o "X-HOIT-Token: cam5gw_…"
 * (mini gateways ESP32, que ya envían ese encabezado).
 */
export function gatewayTokenFrom(request: Pick<NextRequest, "headers">): string | null {
  const authorization = (request.headers.get("authorization") ?? "").trim();
  if (authorization) {
    const [scheme, token, ...extra] = authorization.split(/\s+/);
    return scheme?.toLowerCase() === "bearer" && token?.startsWith("cam5gw_") && !extra.length ? token : null;
  }
  const header = (request.headers.get("x-hoit-token") ?? "").trim();
  return header.startsWith("cam5gw_") && !/\s/.test(header) ? header : null;
}

export async function requireGatewayCredential(request: NextRequest) {
  const token = gatewayTokenFrom(request);
  if (!token) throw new ApiError(401, "Credencial de gateway inválida.");

  const db = getDb();
  const now = new Date();
  const [credential] = await db.select({
    id: gatewayApiCredentials.id,
    lastUsedAt: gatewayApiCredentials.lastUsedAt,
    gatewayId: gateways.id,
    gatewayCode: gateways.code,
    gatewayName: gateways.name,
    siteId: gateways.siteId,
  }).from(gatewayApiCredentials)
    .innerJoin(gateways, eq(gateways.id, gatewayApiCredentials.gatewayId))
    .innerJoin(sites, eq(sites.id, gateways.siteId))
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .where(and(
      eq(gatewayApiCredentials.tokenHash, hashGatewayToken(token)),
      eq(gateways.active, true),
      eq(sites.active, true),
      eq(clients.active, true),
      isNull(gatewayApiCredentials.revokedAt),
      or(isNull(gatewayApiCredentials.expiresAt), gt(gatewayApiCredentials.expiresAt, now)),
    ))
    .limit(1);

  if (!credential) throw new ApiError(401, "Credencial de gateway inválida.");
  if (!credential.lastUsedAt || now.getTime() - credential.lastUsedAt.getTime() >= ACTIVITY_WRITE_INTERVAL_MS) {
    await db.update(gatewayApiCredentials).set({ lastUsedAt: now }).where(eq(gatewayApiCredentials.id, credential.id));
  }
  return { db, credential };
}

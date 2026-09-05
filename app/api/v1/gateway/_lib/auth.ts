import type { NextRequest } from "next/server";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { hashGatewayToken } from "../../../../../db/gateway-auth";
import { getDb } from "../../../../../db/index";
import { clients, gatewayApiCredentials, gateways, sites } from "../../../../../db/schema";
import { ApiError } from "../../_lib/auth";

export async function requireGatewayCredential(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token, ...extra] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra.length || !token.startsWith("cam5gw_")) {
    throw new ApiError(401, "Credencial de gateway inválida.");
  }

  const db = getDb();
  const now = new Date();
  const [credential] = await db.select({
    id: gatewayApiCredentials.id,
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
  await db.update(gatewayApiCredentials).set({ lastUsedAt: now }).where(eq(gatewayApiCredentials.id, credential.id));
  return { db, credential };
}

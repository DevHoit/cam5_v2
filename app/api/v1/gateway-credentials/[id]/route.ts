import type { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { auditLogs, gatewayApiCredentials, gateways } from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "settings.write");
    const { id } = await context.params;
    const [credential] = await db.select({
      id: gatewayApiCredentials.id,
      name: gatewayApiCredentials.name,
      tokenPrefix: gatewayApiCredentials.tokenPrefix,
      gatewayId: gateways.id,
      gatewayCode: gateways.code,
    }).from(gatewayApiCredentials)
      .innerJoin(gateways, eq(gateways.id, gatewayApiCredentials.gatewayId))
      .where(and(eq(gatewayApiCredentials.id, id), eq(gateways.siteId, user.siteId), isNull(gatewayApiCredentials.revokedAt)))
      .limit(1);
    if (!credential) throw new ApiError(404, "La credencial ya no está activa o no pertenece al sitio.");
    const metadata = requestMetadata(request);
    const revokedAt = new Date();
    await db.transaction(async (tx) => {
      await tx.update(gatewayApiCredentials).set({ revokedAt }).where(eq(gatewayApiCredentials.id, credential.id));
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "gateway_credentials.revoke",
        resourceType: "gateway_api_credential",
        resourceId: credential.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { gatewayId: credential.gatewayId, gatewayCode: credential.gatewayCode, name: credential.name, tokenPrefix: credential.tokenPrefix },
        after: { revokedAt: revokedAt.toISOString() },
      });
    });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

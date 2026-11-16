import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { auditLogs, gatewayReleases, gateways } from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Elimina una versión que ningún gateway tiene asignada. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "settings.read");
    if (!user.platformStaff) throw new ApiError(403, "Solo el personal de HOIT administra las versiones del gateway.");
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(404, "La versión no existe.");
    const metadata = requestMetadata(request);
    await db.transaction(async (tx) => {
      const [release] = await tx.select({ id: gatewayReleases.id, version: gatewayReleases.version })
        .from(gatewayReleases).where(eq(gatewayReleases.id, id)).limit(1).for("update");
      if (!release) throw new ApiError(404, "La versión no existe.");
      const [inUse] = await tx.select({ code: gateways.code }).from(gateways).where(eq(gateways.targetReleaseId, id)).limit(1);
      if (inUse) throw new ApiError(409, `La versión ${release.version} está asignada a ${inUse.code}. Asigna otra antes de eliminarla.`);
      await tx.delete(gatewayReleases).where(eq(gatewayReleases.id, id));
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "gateway_release.delete",
        resourceType: "gateway_release",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { version: release.version },
      });
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

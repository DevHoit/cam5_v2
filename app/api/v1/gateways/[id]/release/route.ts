import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { auditLogs, gatewayReleases, gateways } from "../../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Asigna la versión que debe tener un gateway del sitio activo ({"releaseId": "…"} o null para no
 * actualizar). El equipo la recibe en su próximo heartbeat con salud (≤ 15 min). Volver a asignar
 * la misma versión permite reintentar una instalación que falló o se revirtió.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "settings.read");
    if (!user.platformStaff) throw new ApiError(403, "Solo el personal de HOIT puede actualizar el software del gateway.");
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(404, "El gateway no existe.");
    const body = await request.json().catch(() => null) as { releaseId?: unknown } | null;
    const releaseId = body?.releaseId ?? null;
    if (releaseId !== null && (typeof releaseId !== "string" || !UUID_PATTERN.test(releaseId))) {
      throw new ApiError(400, "Versión inválida.");
    }

    const metadata = requestMetadata(request);
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select({ id: gateways.id, code: gateways.code, targetReleaseId: gateways.targetReleaseId, softwareVersion: gateways.softwareVersion })
        .from(gateways).where(and(eq(gateways.id, id), eq(gateways.siteId, user.siteId))).limit(1).for("update");
      if (!current) throw new ApiError(404, "El gateway no existe en el sitio activo.");
      let version: string | null = null;
      if (releaseId) {
        const [release] = await tx.select({ version: gatewayReleases.version }).from(gatewayReleases)
          .where(eq(gatewayReleases.id, releaseId)).limit(1);
        if (!release) throw new ApiError(404, "La versión no existe.");
        version = release.version;
      }
      const assignedAt = releaseId ? new Date() : null;
      await tx.update(gateways).set({ targetReleaseId: releaseId, targetAssignedAt: assignedAt, updatedAt: new Date() })
        .where(eq(gateways.id, id));
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "gateway.release_assign",
        resourceType: "gateway",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { code: current.code, targetReleaseId: current.targetReleaseId, softwareVersion: current.softwareVersion },
        after: { code: current.code, targetReleaseId: releaseId, version },
      });
      return { targetReleaseId: releaseId, targetVersion: version, targetAssignedAt: assignedAt };
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

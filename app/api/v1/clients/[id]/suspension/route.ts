import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { auditLogs, clients } from "../../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Suspende o reactiva el acceso al portal de un cliente (p. ej. por falta de pago).
 * Mientras está suspendido, sus usuarios no pueden entrar, pero sus gateways siguen enviando y la
 * telemetría, las alarmas y el histórico continúan. Solo el personal de la plataforma puede hacerlo,
 * para que un administrador del cliente no pueda reactivarse a sí mismo.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request);
    if (!user.platformStaff) throw new ApiError(403, "Solo el personal de HOIT puede suspender o reactivar un cliente.");
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(404, "El cliente no existe.");
    const body = await request.json().catch(() => null) as { action?: unknown; reason?: unknown } | null;
    const action = body?.action;
    if (action !== "suspend" && action !== "resume") throw new ApiError(400, "La acción debe ser suspend o resume.");
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    if (action === "suspend" && reason.length < 3) throw new ApiError(400, "Indica el motivo de la suspensión.");

    const metadata = requestMetadata(request);
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select({ id: clients.id, code: clients.code, name: clients.name, suspendedAt: clients.suspendedAt, suspendedReason: clients.suspendedReason })
        .from(clients).where(eq(clients.id, id)).limit(1).for("update");
      if (!current) throw new ApiError(404, "El cliente no existe.");
      if (action === "suspend" && current.suspendedAt) throw new ApiError(409, "El cliente ya está suspendido.");
      if (action === "resume" && !current.suspendedAt) throw new ApiError(409, "El cliente no está suspendido.");

      const [updated] = await tx.update(clients).set(action === "suspend"
        ? { suspendedAt: now, suspendedReason: reason, suspendedBy: user.id, updatedAt: now }
        : { suspendedAt: null, suspendedReason: null, suspendedBy: null, updatedAt: now })
        .where(eq(clients.id, id))
        .returning({ id: clients.id, code: clients.code, name: clients.name, suspendedAt: clients.suspendedAt, suspendedReason: clients.suspendedReason });
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: action === "suspend" ? "client.suspend" : "client.resume",
        resourceType: "client",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { code: current.code, suspendedAt: current.suspendedAt?.toISOString() ?? null, suspendedReason: current.suspendedReason },
        after: { code: updated.code, suspendedAt: updated.suspendedAt?.toISOString() ?? null, suspendedReason: updated.suspendedReason },
      });
      return updated;
    });

    return Response.json({
      client: { ...result, suspendedAt: result.suspendedAt?.toISOString() ?? null },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

import { after, type NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { checkGatewayDataAlert, DataPlanInputError, parseDataPlanInput, readDataPlan } from "../../../../../../db/gateway-data-plan";
import { auditLogs, gateways } from "../../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cambia el plan de datos 4G y el tope de aviso de un gateway del sitio activo. Solo el personal
 * de la plataforma: los administradores de sitio no gestionan las SIM.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "settings.read");
    if (!user.platformStaff) throw new ApiError(403, "Solo el personal de HOIT puede cambiar el plan de datos.");
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(404, "El gateway no existe.");
    let plan;
    try {
      plan = parseDataPlanInput(await request.json().catch(() => null));
    } catch (error) {
      if (error instanceof DataPlanInputError) throw new ApiError(400, error.message);
      throw error;
    }

    const metadata = requestMetadata(request);
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select({ id: gateways.id, code: gateways.code, metadata: gateways.metadata })
        .from(gateways).where(and(eq(gateways.id, id), eq(gateways.siteId, user.siteId))).limit(1).for("update");
      if (!current) throw new ApiError(404, "El gateway no existe en el sitio activo.");
      const before = readDataPlan(current.metadata);
      await tx.update(gateways).set({
        metadata: sql`coalesce(${gateways.metadata}, '{}'::jsonb) || ${JSON.stringify({ dataPlan: plan })}::jsonb`,
        updatedAt: new Date(),
      }).where(eq(gateways.id, id));
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "gateway.data_plan",
        resourceType: "gateway",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { code: current.code, ...before },
        after: { code: current.code, ...plan },
      });
      return plan;
    });

    // Si el tope nuevo ya está superado, el aviso sale ahora y no en el próximo heartbeat.
    after(() => checkGatewayDataAlert(db, id).catch((error: unknown) => {
      console.error("Aviso de consumo 4G no enviado:", error instanceof Error ? error.message : error);
    }));
    return Response.json({ dataPlan: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

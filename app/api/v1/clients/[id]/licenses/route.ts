import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { loadClientLicenses } from "../../../../../../db/licenses";
import { auditLogs, clients } from "../../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseLimit(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 10000) throw new ApiError(400, `${label}: indica un número entero entre 0 y 10000, o déjalo vacío para no limitar.`);
  return number;
}

/** Uso de licencias del cliente. Solo personal de HOIT o administradores del cliente. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request);
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(404, "El cliente no existe.");
    const administers = user.sites.some((site) => site.clientId === id && site.roleKey === "administrator");
    if (!user.platformStaff && !administers) throw new ApiError(403, "No tienes acceso a las licencias de este cliente.");
    const [licenses] = await loadClientLicenses(db, [id]);
    if (!licenses) throw new ApiError(404, "El cliente no existe.");
    return Response.json({ licenses }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * Define las licencias contratadas por el cliente. Solo el personal de HOIT, para que un administrador del
 * cliente no pueda ampliarse las licencias. Bajar el límite no quita acceso a nadie: solo impide sumar usuarios.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request);
    if (!user.platformStaff) throw new ApiError(403, "Solo el personal de HOIT puede cambiar las licencias de un cliente.");
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(404, "El cliente no existe.");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron cambios.");
    const userLicenseLimit = parseLimit(body.userLicenseLimit, "Licencias del cliente");
    const partnerName = typeof body.partnerName === "string" ? body.partnerName.trim().slice(0, 180) || null : null;
    const partnerLicenseLimit = partnerName ? parseLimit(body.partnerLicenseLimit, "Licencias del integrador") : null;

    const metadata = requestMetadata(request);
    await db.transaction(async (tx) => {
      const [current] = await tx.select({ code: clients.code, userLicenseLimit: clients.userLicenseLimit, partnerName: clients.partnerName, partnerLicenseLimit: clients.partnerLicenseLimit })
        .from(clients).where(eq(clients.id, id)).limit(1).for("update");
      if (!current) throw new ApiError(404, "El cliente no existe.");
      await tx.update(clients).set({ userLicenseLimit, partnerName, partnerLicenseLimit, updatedAt: new Date() }).where(eq(clients.id, id));
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "client.licenses.update",
        resourceType: "client",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { code: current.code, userLicenseLimit: current.userLicenseLimit, partnerName: current.partnerName, partnerLicenseLimit: current.partnerLicenseLimit },
        after: { code: current.code, userLicenseLimit, partnerName, partnerLicenseLimit },
      });
    });
    const [licenses] = await loadClientLicenses(db, [id]);
    return Response.json({ licenses }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

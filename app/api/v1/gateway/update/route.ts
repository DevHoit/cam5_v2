import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { gatewayReleases, gateways } from "../../../../../db/schema";
import { apiErrorResponse, ApiError } from "../../_lib/auth";
import { requireGatewayCredential } from "../_lib/auth";

export const dynamic = "force-dynamic";

/**
 * Paquete de la versión asignada a este gateway (tar.gz firmado). El gateway comprueba SHA-256 y
 * firma con los datos que recibió en el heartbeat antes de instalarlo.
 */
export async function GET(request: NextRequest) {
  try {
    const { db, credential } = await requireGatewayCredential(request);
    const [release] = await db.select({
      version: gatewayReleases.version,
      sha256: gatewayReleases.sha256,
      bundle: gatewayReleases.bundle,
    }).from(gateways)
      .innerJoin(gatewayReleases, eq(gatewayReleases.id, gateways.targetReleaseId))
      .where(eq(gateways.id, credential.gatewayId))
      .limit(1);
    if (!release) throw new ApiError(404, "No hay una versión asignada a este gateway.");
    const body = new Uint8Array(release.bundle);
    return new Response(body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(body.byteLength),
        "Cache-Control": "no-store",
        "X-Release-Version": release.version,
        "X-Release-Sha256": release.sha256,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

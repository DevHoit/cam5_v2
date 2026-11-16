import { after, type NextRequest } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { checkGatewayDataAlert } from "../../../../../db/gateway-data-plan";
import { releaseOffer } from "../../../../../db/gateway-releases";
import { assets, devices, gatewayReleases, gateways, readingProfiles } from "../../../../../db/schema";
import { apiErrorResponse } from "../../_lib/auth";
import { requireGatewayCredential } from "../_lib/auth";

export const dynamic = "force-dynamic";

const MAX_HEALTH_BYTES = 4096;
const MAX_HEALTH_KEYS = 40;

/**
 * Salud del equipo enviada opcionalmente en el heartbeat ({"health":{...}}): salida activa,
 * señal, consumo 4G del mes, cola, memoria, versión. Solo valores simples; se guarda en
 * gateways.metadata.health para el portal. Un cuerpo vacío o "{}" sigue siendo válido.
 */
function parseHealth(rawBody: string): Record<string, string | number | boolean> | null {
  if (!rawBody || rawBody.length > MAX_HEALTH_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch { return null; }
  const health = parsed && typeof parsed === "object" ? (parsed as { health?: unknown }).health : undefined;
  if (!health || typeof health !== "object" || Array.isArray(health)) return null;
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(health).slice(0, MAX_HEALTH_KEYS)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
    if (typeof value === "string") clean[key] = value.slice(0, 120);
    else if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === "boolean") clean[key] = value;
  }
  return Object.keys(clean).length ? clean : null;
}

export async function POST(request: NextRequest) {
  try {
    const { db, credential } = await requireGatewayCredential(request);
    const receivedAt = new Date();
    const health = parseHealth(await request.text().catch(() => ""));
    const [policy] = await db.select({
      heartbeatIntervalSeconds: readingProfiles.heartbeatIntervalSeconds,
    }).from(devices)
      .innerJoin(assets, eq(assets.id, devices.assetId))
      .leftJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
      .where(and(
        eq(devices.gatewayId, credential.gatewayId),
        eq(devices.active, true),
        eq(assets.active, true),
      ))
      .orderBy(asc(devices.unitId))
      .limit(1);

    const [updated] = await db.update(gateways).set({
      state: "online",
      lastSeenAt: receivedAt,
      updatedAt: receivedAt,
      ...(health ? {
        metadata: sql`coalesce(${gateways.metadata}, '{}'::jsonb) || ${JSON.stringify({ health: { ...health, receivedAt: receivedAt.toISOString() } })}::jsonb`,
        ...(typeof health.version === "string" ? { softwareVersion: health.version.slice(0, 80) } : {}),
      } : {}),
    }).where(eq(gateways.id, credential.gatewayId)).returning({
      softwareVersion: gateways.softwareVersion,
      targetReleaseId: gateways.targetReleaseId,
      targetAssignedAt: gateways.targetAssignedAt,
    });

    // Actualización remota: si el personal asignó otra versión, el gateway la descarga de /gateway/update.
    const [target] = updated?.targetReleaseId ? await db.select({
      version: gatewayReleases.version,
      sha256: gatewayReleases.sha256,
      signature: gatewayReleases.signature,
      sizeBytes: gatewayReleases.sizeBytes,
    }).from(gatewayReleases).where(eq(gatewayReleases.id, updated.targetReleaseId)).limit(1) : [];
    const update = releaseOffer(target ?? null, updated?.softwareVersion, updated?.targetAssignedAt ?? null);

    // Aviso de consumo 4G al personal de la plataforma, sin demorar la respuesta al gateway.
    if (typeof health?.lteMonthMb === "number") {
      after(() => checkGatewayDataAlert(db, credential.gatewayId).catch((error: unknown) => {
        console.error("Aviso de consumo 4G no enviado:", error instanceof Error ? error.message : error);
      }));
    }

    return Response.json({
      status: "accepted",
      serverTime: receivedAt.toISOString(),
      nextHeartbeatInMs: (policy?.heartbeatIntervalSeconds ?? 30) * 1_000,
      ...(update ? { update } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

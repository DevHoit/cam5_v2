import type { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { assets, devices, gateways, readingProfiles } from "../../../../../db/schema";
import { apiErrorResponse, ApiError } from "../../_lib/auth";
import { requireGatewayCredential } from "../_lib/auth";
import { handleSpecHeartbeat } from "../_lib/heartbeat-spec-v1";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { db, credential } = await requireGatewayCredential(request);
    const receivedAt = new Date();
    const rawBody = await request.text();
    const parsedBody = rawBody.trim() ? (() => { try { return JSON.parse(rawBody) as unknown; } catch { return null; } })() : null;
    if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)) {
      const record = parsedBody as Record<string, unknown>;
      if (record.schema_version === "1.0") {
        return handleSpecHeartbeat({ db, credential, rawPayload: parsedBody, receivedAt });
      }
      if (record.schema_version !== undefined) throw new ApiError(400, "schema_version de heartbeat no soportado.");
    } else if (rawBody.trim()) {
      throw new ApiError(400, "El heartbeat debe ser JSON válido.");
    }
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

    await db.update(gateways).set({ state: "online", lastSeenAt: receivedAt, updatedAt: receivedAt }).where(eq(gateways.id, credential.gatewayId));

    return Response.json({
      status: "accepted",
      gateway: credential.gatewayCode,
      serverTime: receivedAt.toISOString(),
      nextHeartbeatInMs: (policy?.heartbeatIntervalSeconds ?? 30) * 1_000,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

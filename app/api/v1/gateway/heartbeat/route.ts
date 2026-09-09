import type { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { assets, devices, gateways, readingProfiles } from "../../../../../db/schema";
import { apiErrorResponse } from "../../_lib/auth";
import { requireGatewayCredential } from "../_lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { db, credential } = await requireGatewayCredential(request);
    const receivedAt = new Date();
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

import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const { assetId } = await params;
  const url = new URL(request.url);
  const channelId = url.searchParams.get("channelId");

  const db = await getSeededDb();
  const readings = channelId
    ? await db
        .select()
        .from(schema.telemetryReadings)
        .where(and(eq(schema.telemetryReadings.assetId, assetId), eq(schema.telemetryReadings.channelId, channelId)))
        .all()
    : await db
        .select()
        .from(schema.telemetryReadings)
        .where(eq(schema.telemetryReadings.assetId, assetId))
        .all();

  return NextResponse.json(
    readings.map((r) => ({
      channelId: r.channelId,
      sourceId: r.sourceId,
      assetId: r.assetId,
      nativeRegister: r.nativeRegister,
      value: r.value,
      rawValue: r.rawValue,
      unit: r.unit,
      severity: r.severity,
      quality: r.quality,
      qualityFlags: JSON.parse(r.qualityFlags),
      sourceTimestamp: r.sourceTimestamp,
      receivedAt: r.receivedAt,
      sequence: r.sequence,
    }))
  );
}

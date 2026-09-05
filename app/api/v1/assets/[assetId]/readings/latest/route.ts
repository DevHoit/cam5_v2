import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const { assetId } = await params;
  const db = await getSeededDb();
  const readings = await db
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

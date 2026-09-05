import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST() {
  const db = await getSeededDb();
  const device = await db
    .select()
    .from(schema.devices)
    .where(eq(schema.devices.id, "CAM5-01"))
    .get();

  if (!device) {
    return NextResponse.json({ error: "No device discovered" }, { status: 404 });
  }

  return NextResponse.json({
    id: device.id,
    assetId: device.assetId,
    model: device.model,
    serialNumber: device.serialNumber,
    firmwareVersion: device.firmwareVersion,
    dataVersion: device.dataVersion,
    capabilities: JSON.parse(device.capabilities),
    connection: JSON.parse(device.connection),
    network: JSON.parse(device.network),
    lastSeenAt: new Date().toISOString(),
  });
}

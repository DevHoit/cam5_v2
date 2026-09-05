import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const db = await getSeededDb();
  const device = await db
    .select()
    .from(schema.devices)
    .where(eq(schema.devices.id, deviceId))
    .get();

  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
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
    lastSeenAt: device.lastSeenAt,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const db = await getSeededDb();
  const device = await db
    .select()
    .from(schema.devices)
    .where(eq(schema.devices.id, deviceId))
    .get();

  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  const body = await request.json();

  const capabilities = body.capabilities ? JSON.stringify(body.capabilities) : device.capabilities;
  const connection = body.connection ? JSON.stringify(body.connection) : device.connection;
  const network = body.network ? JSON.stringify(body.network) : device.network;

  await db.update(schema.devices)
    .set({
      model: body.model ?? device.model,
      serialNumber: body.serialNumber ?? device.serialNumber,
      firmwareVersion: body.firmwareVersion ?? device.firmwareVersion,
      dataVersion: body.dataVersion ?? device.dataVersion,
      capabilities,
      connection,
      network,
      lastSeenAt: new Date().toISOString(),
    })
    .where(eq(schema.devices.id, deviceId))
    .run();

  const updated = (await db
    .select()
    .from(schema.devices)
    .where(eq(schema.devices.id, deviceId))
    .get())!;

  return NextResponse.json({
    id: updated.id,
    assetId: updated.assetId,
    model: updated.model,
    serialNumber: updated.serialNumber,
    firmwareVersion: updated.firmwareVersion,
    dataVersion: updated.dataVersion,
    capabilities: JSON.parse(updated.capabilities),
    connection: JSON.parse(updated.connection),
    network: JSON.parse(updated.network),
    lastSeenAt: updated.lastSeenAt,
  });
}

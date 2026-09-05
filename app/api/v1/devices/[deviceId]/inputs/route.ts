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
  const inputs = await db
    .select()
    .from(schema.inputAssignments)
    .where(eq(schema.inputAssignments.deviceId, deviceId))
    .all();

  return NextResponse.json(
    inputs.map((inp) => ({
      id: inp.id,
      type: inp.type,
      enabled: Boolean(inp.enabled),
      location: inp.location,
      band: inp.band ?? undefined,
      calibrationCode: inp.calibrationCode ?? undefined,
      antennaPort: inp.antennaPort ?? undefined,
      humidityIndex: inp.humidityIndex ?? undefined,
      mainsFrequencyHz: inp.mainsFrequencyHz ?? undefined,
      signalQuality: inp.signalQuality ?? undefined,
    }))
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const db = await getSeededDb();
  const body = await request.json();
  const inputsList: Array<{
    id: string;
    type: string;
    enabled: boolean;
    location: string;
    band?: number;
    calibrationCode?: string;
    antennaPort?: number;
    humidityIndex?: number;
    mainsFrequencyHz?: number;
    signalQuality?: string;
  }> = body.inputs || body;

  for (const inp of inputsList) {
    await db.insert(schema.inputAssignments)
      .values({
        id: inp.id,
        deviceId,
        type: inp.type,
        enabled: inp.enabled,
        location: inp.location,
        band: inp.band,
        calibrationCode: inp.calibrationCode,
        antennaPort: inp.antennaPort,
        humidityIndex: inp.humidityIndex,
        mainsFrequencyHz: inp.mainsFrequencyHz,
        signalQuality: inp.signalQuality,
      })
      .onConflictDoUpdate({
        target: schema.inputAssignments.id,
        set: {
          enabled: inp.enabled,
          location: inp.location,
          band: inp.band,
          calibrationCode: inp.calibrationCode,
          antennaPort: inp.antennaPort,
          humidityIndex: inp.humidityIndex,
          mainsFrequencyHz: inp.mainsFrequencyHz,
          signalQuality: inp.signalQuality,
        },
      })
      .run();
  }

  const updated = await db
    .select()
    .from(schema.inputAssignments)
    .where(eq(schema.inputAssignments.deviceId, deviceId))
    .all();

  return NextResponse.json(
    updated.map((inp) => ({
      id: inp.id,
      type: inp.type,
      enabled: Boolean(inp.enabled),
      location: inp.location,
      band: inp.band ?? undefined,
      calibrationCode: inp.calibrationCode ?? undefined,
      antennaPort: inp.antennaPort ?? undefined,
      humidityIndex: inp.humidityIndex ?? undefined,
      mainsFrequencyHz: inp.mainsFrequencyHz ?? undefined,
      signalQuality: inp.signalQuality ?? undefined,
    }))
  );
}

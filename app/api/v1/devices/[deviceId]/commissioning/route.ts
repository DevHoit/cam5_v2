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
  const comm = await db
    .select()
    .from(schema.commissioning)
    .where(eq(schema.commissioning.deviceId, deviceId))
    .get();

  if (!comm) {
    return NextResponse.json({ error: "Commissioning record not found" }, { status: 404 });
  }

  return NextResponse.json({
    deviceDiscovered: Boolean(comm.deviceDiscovered),
    registerMapVerified: Boolean(comm.registerMapVerified),
    inputsVerified: Boolean(comm.inputsVerified),
    clockSynchronized: Boolean(comm.clockSynchronized),
    alarmsAndRelaysVerified: Boolean(comm.alarmsAndRelaysVerified),
    initialBackupCreated: Boolean(comm.initialBackupCreated),
    historyVerified: Boolean(comm.historyVerified),
    acceptedForProduction: Boolean(comm.acceptedForProduction),
    checks: JSON.parse(comm.checks),
  });
}

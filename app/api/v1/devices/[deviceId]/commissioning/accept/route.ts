import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
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

  const checks: Array<{ id: string; status: string; checkedAt?: string; checkedBy?: string; detail?: string }> = JSON.parse(comm.checks);
  const accIdx = checks.findIndex((c) => c.id === "PRODUCTION_ACCEPTANCE");
  if (accIdx !== -1) {
    checks[accIdx] = {
      ...checks[accIdx],
      status: "passed",
      checkedAt: new Date().toISOString(),
      checkedBy: "Emerson Allende",
      detail: "Equipo aceptado para operación en producción.",
    };
  }

  await db.update(schema.commissioning)
    .set({
      acceptedForProduction: true,
      checks: JSON.stringify(checks),
    })
    .where(eq(schema.commissioning.deviceId, deviceId))
    .run();

  const updated = (await db
    .select()
    .from(schema.commissioning)
    .where(eq(schema.commissioning.deviceId, deviceId))
    .get())!;

  return NextResponse.json({
    deviceDiscovered: Boolean(updated.deviceDiscovered),
    registerMapVerified: Boolean(updated.registerMapVerified),
    inputsVerified: Boolean(updated.inputsVerified),
    clockSynchronized: Boolean(updated.clockSynchronized),
    alarmsAndRelaysVerified: Boolean(updated.alarmsAndRelaysVerified),
    initialBackupCreated: Boolean(updated.initialBackupCreated),
    historyVerified: Boolean(updated.historyVerified),
    acceptedForProduction: Boolean(updated.acceptedForProduction),
    checks: JSON.parse(updated.checks),
  });
}

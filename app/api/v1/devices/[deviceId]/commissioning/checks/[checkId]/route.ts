import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ deviceId: string; checkId: string }> }
) {
  const { deviceId, checkId } = await params;
  const db = await getSeededDb();
  const body = await request.json();

  const comm = await db
    .select()
    .from(schema.commissioning)
    .where(eq(schema.commissioning.deviceId, deviceId))
    .get();

  if (!comm) {
    return NextResponse.json({ error: "Commissioning record not found" }, { status: 404 });
  }

  const checks: Array<{
    id: string;
    status: "pending" | "passed" | "failed";
    checkedAt?: string;
    checkedBy?: string;
    detail?: string;
  }> = JSON.parse(comm.checks);

  const idx = checks.findIndex((c) => c.id === checkId);
  if (idx !== -1) {
    checks[idx] = {
      ...checks[idx],
      status: body.status,
      detail: body.detail ?? checks[idx].detail,
      checkedAt: new Date().toISOString(),
      checkedBy: "Emerson Allende",
    };
  }

  await db.update(schema.commissioning)
    .set({
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

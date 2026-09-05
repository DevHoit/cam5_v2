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

  const id = `BACKUP-${Date.now()}`;
  const now = new Date().toISOString();

  await db.insert(schema.configurationSnapshots)
    .values({
      id,
      deviceId,
      version: Math.floor(Date.now() / 1000),
      status: "validated",
      createdAt: now,
      createdBy: "Emerson Allende",
      checksum: "bak-chk-" + Math.random().toString(36).substring(2, 8),
      payload: JSON.stringify({ type: "full_backup" }),
    })
    .run();

  const snap = (await db
    .select()
    .from(schema.configurationSnapshots)
    .where(eq(schema.configurationSnapshots.id, id))
    .get())!;

  return NextResponse.json({
    id: snap.id,
    deviceId: snap.deviceId,
    version: snap.version,
    status: snap.status,
    createdAt: snap.createdAt,
    createdBy: snap.createdBy,
    checksum: snap.checksum ?? undefined,
  });
}

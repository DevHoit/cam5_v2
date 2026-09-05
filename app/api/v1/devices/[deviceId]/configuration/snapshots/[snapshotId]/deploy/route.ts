import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string; snapshotId: string }> }
) {
  const { snapshotId } = await params;
  const db = await getSeededDb();

  await db.update(schema.configurationSnapshots)
    .set({ status: "deployed" })
    .where(eq(schema.configurationSnapshots.id, snapshotId))
    .run();

  const snap = await db
    .select()
    .from(schema.configurationSnapshots)
    .where(eq(schema.configurationSnapshots.id, snapshotId))
    .get();

  if (!snap) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

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

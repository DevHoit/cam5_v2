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
  const snaps = await db
    .select()
    .from(schema.configurationSnapshots)
    .where(eq(schema.configurationSnapshots.deviceId, deviceId))
    .all();

  return NextResponse.json(
    snaps.map((s) => ({
      id: s.id,
      deviceId: s.deviceId,
      version: s.version,
      status: s.status,
      createdAt: s.createdAt,
      createdBy: s.createdBy,
      checksum: s.checksum ?? undefined,
    }))
  );
}

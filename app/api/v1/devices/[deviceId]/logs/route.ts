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
  const logs = await db
    .select()
    .from(schema.logFiles)
    .where(eq(schema.logFiles.deviceId, deviceId))
    .all();

  return NextResponse.json(
    logs.map((l) => ({
      id: l.id,
      name: l.name,
      size: l.size,
      createdAt: l.createdAt,
    }))
  );
}

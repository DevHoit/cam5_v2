import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");

  const db = await getSeededDb();
  const alarmList = statusFilter
    ? await db.select().from(schema.alarms).where(eq(schema.alarms.status, statusFilter)).all()
    : await db.select().from(schema.alarms).all();

  return NextResponse.json(
    alarmList.map((a) => ({
      id: a.id,
      assetId: a.assetId,
      channelId: a.channelId,
      title: a.title,
      severity: a.severity,
      status: a.status,
      triggerValue: a.triggerValue,
      threshold: a.threshold ?? undefined,
      consecutiveSamples: a.consecutiveSamples,
      openedAt: a.openedAt,
      acknowledgedAt: a.acknowledgedAt ?? undefined,
      acknowledgedBy: a.acknowledgedBy ?? undefined,
      closedAt: a.closedAt ?? undefined,
      note: a.note ?? undefined,
    }))
  );
}

import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ alarmId: string }> }
) {
  const { alarmId } = await params;
  const db = await getSeededDb();
  let body: { note?: string } = {};
  try {
    body = await request.json();
  } catch {
    // optional
  }

  const alarm = await db
    .select()
    .from(schema.alarms)
    .where(eq(schema.alarms.id, alarmId))
    .get();

  if (!alarm) {
    return NextResponse.json({ error: "Alarm not found" }, { status: 404 });
  }

  const closedAt = new Date().toISOString();
  const existingNote = alarm.note ?? "";
  const newNote = body.note ? (existingNote ? `${existingNote} | ${body.note}` : body.note) : alarm.note;

  await db.update(schema.alarms)
    .set({
      status: "closed",
      closedAt,
      note: newNote,
    })
    .where(eq(schema.alarms.id, alarmId))
    .run();

  const updated = (await db
    .select()
    .from(schema.alarms)
    .where(eq(schema.alarms.id, alarmId))
    .get())!;

  return NextResponse.json({
    id: updated.id,
    assetId: updated.assetId,
    channelId: updated.channelId,
    title: updated.title,
    severity: updated.severity,
    status: updated.status,
    triggerValue: updated.triggerValue,
    threshold: updated.threshold ?? undefined,
    consecutiveSamples: updated.consecutiveSamples,
    openedAt: updated.openedAt,
    acknowledgedAt: updated.acknowledgedAt ?? undefined,
    acknowledgedBy: updated.acknowledgedBy ?? undefined,
    closedAt: updated.closedAt ?? undefined,
    note: updated.note ?? undefined,
  });
}

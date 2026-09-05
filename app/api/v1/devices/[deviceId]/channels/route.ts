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
  const chs = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.deviceId, deviceId))
    .all();

  return NextResponse.json(
    chs.map((c) => ({
      id: c.id,
      sourceId: c.sourceId,
      enabled: Boolean(c.enabled),
      label: c.label,
      location: c.location,
      metric: c.metric,
      nativeRegister: c.nativeRegister,
      warningThreshold: c.warningThreshold ?? undefined,
      alarmThreshold: c.alarmThreshold ?? undefined,
      recoveryDeadband: c.recoveryDeadband ?? undefined,
      activationSamples: c.activationSamples,
      recoverySamples: c.recoverySamples,
      staleAfterSeconds: c.staleAfterSeconds,
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
  const channelsList: Array<{
    id: string;
    sourceId: string;
    enabled: boolean;
    label: string;
    location: string;
    metric: string;
    nativeRegister: number;
    warningThreshold?: number;
    alarmThreshold?: number;
    recoveryDeadband?: number;
    activationSamples: number;
    recoverySamples: number;
    staleAfterSeconds: number;
  }> = body.channels || body;

  for (const ch of channelsList) {
    await db.insert(schema.channels)
      .values({
        id: ch.id,
        deviceId,
        sourceId: ch.sourceId,
        enabled: ch.enabled,
        label: ch.label,
        location: ch.location,
        metric: ch.metric,
        nativeRegister: ch.nativeRegister,
        warningThreshold: ch.warningThreshold,
        alarmThreshold: ch.alarmThreshold,
        recoveryDeadband: ch.recoveryDeadband,
        activationSamples: ch.activationSamples ?? 3,
        recoverySamples: ch.recoverySamples ?? 3,
        staleAfterSeconds: ch.staleAfterSeconds ?? 30,
      })
      .onConflictDoUpdate({
        target: schema.channels.id,
        set: {
          enabled: ch.enabled,
          label: ch.label,
          location: ch.location,
          metric: ch.metric,
          warningThreshold: ch.warningThreshold,
          alarmThreshold: ch.alarmThreshold,
          recoveryDeadband: ch.recoveryDeadband,
          activationSamples: ch.activationSamples ?? 3,
          recoverySamples: ch.recoverySamples ?? 3,
          staleAfterSeconds: ch.staleAfterSeconds ?? 30,
        },
      })
      .run();
  }

  const updated = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.deviceId, deviceId))
    .all();

  return NextResponse.json(
    updated.map((c) => ({
      id: c.id,
      sourceId: c.sourceId,
      enabled: Boolean(c.enabled),
      label: c.label,
      location: c.location,
      metric: c.metric,
      nativeRegister: c.nativeRegister,
      warningThreshold: c.warningThreshold ?? undefined,
      alarmThreshold: c.alarmThreshold ?? undefined,
      recoveryDeadband: c.recoveryDeadband ?? undefined,
      activationSamples: c.activationSamples,
      recoverySamples: c.recoverySamples,
      staleAfterSeconds: c.staleAfterSeconds,
    }))
  );
}

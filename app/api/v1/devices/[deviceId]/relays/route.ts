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
  const list = await db
    .select()
    .from(schema.relays)
    .where(eq(schema.relays.deviceId, deviceId))
    .all();

  return NextResponse.json(
    list.map((r) => ({
      relay: r.relay,
      name: r.name,
      enabled: Boolean(r.enabled),
      sources: JSON.parse(r.sources),
      triggerLevel: r.triggerLevel,
      energized: Boolean(r.energized),
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
  const relayList: Array<{
    relay: number;
    name: string;
    enabled: boolean;
    sources: string[];
    triggerLevel: string;
    energized: boolean;
  }> = body.relays || body;

  for (const r of relayList) {
    await db.insert(schema.relays)
      .values({
        relay: r.relay,
        deviceId,
        name: r.name,
        enabled: r.enabled,
        sources: JSON.stringify(r.sources),
        triggerLevel: r.triggerLevel,
        energized: r.energized,
      })
      .onConflictDoUpdate({
        target: schema.relays.relay,
        set: {
          name: r.name,
          enabled: r.enabled,
          sources: JSON.stringify(r.sources),
          triggerLevel: r.triggerLevel,
          energized: r.energized,
        },
      })
      .run();
  }

  const updated = await db
    .select()
    .from(schema.relays)
    .where(eq(schema.relays.deviceId, deviceId))
    .all();

  return NextResponse.json(
    updated.map((r) => ({
      relay: r.relay,
      name: r.name,
      enabled: Boolean(r.enabled),
      sources: JSON.parse(r.sources),
      triggerLevel: r.triggerLevel,
      energized: Boolean(r.energized),
    }))
  );
}

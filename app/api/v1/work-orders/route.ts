import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const db = await getSeededDb();
  const list = await db.select().from(schema.workOrders).all();

  return NextResponse.json(
    list.map((w) => ({
      id: w.id,
      sourceAlarmId: w.sourceAlarmId ?? undefined,
      title: w.title,
      priority: w.priority,
      status: w.status,
      assigneeId: w.assigneeId,
      dueAt: w.dueAt ?? undefined,
    }))
  );
}

export async function POST(request: Request) {
  const db = await getSeededDb();
  const body = await request.json();

  const id = body.id || `OT-${Date.now().toString().slice(-9)}`;

  await db.insert(schema.workOrders)
    .values({
      id,
      sourceAlarmId: body.sourceAlarmId,
      title: body.title,
      priority: body.priority,
      status: body.status || "pending",
      assigneeId: body.assigneeId,
      dueAt: body.dueAt,
    })
    .run();

  const wo = (await db
    .select()
    .from(schema.workOrders)
    .where(eq(schema.workOrders.id, id))
    .get())!;

  return NextResponse.json({
    id: wo.id,
    sourceAlarmId: wo.sourceAlarmId ?? undefined,
    title: wo.title,
    priority: wo.priority,
    status: wo.status,
    assigneeId: wo.assigneeId,
    dueAt: wo.dueAt ?? undefined,
  }, { status: 201 });
}

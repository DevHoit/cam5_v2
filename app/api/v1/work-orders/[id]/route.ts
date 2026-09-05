import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = await getSeededDb();
  const body = await request.json();

  const wo = await db
    .select()
    .from(schema.workOrders)
    .where(eq(schema.workOrders.id, id))
    .get();

  if (!wo) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }

  await db.update(schema.workOrders)
    .set({
      sourceAlarmId: body.sourceAlarmId ?? wo.sourceAlarmId,
      title: body.title ?? wo.title,
      priority: body.priority ?? wo.priority,
      status: body.status ?? wo.status,
      assigneeId: body.assigneeId ?? wo.assigneeId,
      dueAt: body.dueAt ?? wo.dueAt,
    })
    .where(eq(schema.workOrders.id, id))
    .run();

  const updated = (await db
    .select()
    .from(schema.workOrders)
    .where(eq(schema.workOrders.id, id))
    .get())!;

  return NextResponse.json({
    id: updated.id,
    sourceAlarmId: updated.sourceAlarmId ?? undefined,
    title: updated.title,
    priority: updated.priority,
    status: updated.status,
    assigneeId: updated.assigneeId,
    dueAt: updated.dueAt ?? undefined,
  });
}

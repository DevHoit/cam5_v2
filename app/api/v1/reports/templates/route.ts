import type { NextRequest } from "next/server";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { reportTemplates } from "../../../../../db/schema";
import { apiErrorResponse, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "reports.read");
    const items = await db.select({
      id: reportTemplates.id,
      key: reportTemplates.key,
      name: reportTemplates.name,
      description: reportTemplates.description,
      definition: reportTemplates.definition,
      siteId: reportTemplates.siteId,
    }).from(reportTemplates)
      .where(and(eq(reportTemplates.active, true), or(isNull(reportTemplates.siteId), eq(reportTemplates.siteId, user.siteId))))
      .orderBy(asc(reportTemplates.name));
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

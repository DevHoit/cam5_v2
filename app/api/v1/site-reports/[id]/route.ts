import type { NextRequest } from "next/server";
import { apiErrorResponse, requireApiSession } from "../../_lib/auth";
import { loadSiteReportRun } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "reports.read");
    const row = await loadSiteReportRun(db, (await context.params).id, user);
    return Response.json({ id: row.id, title: row.title, createdAt: row.createdAt.toISOString(), report: row.payload }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

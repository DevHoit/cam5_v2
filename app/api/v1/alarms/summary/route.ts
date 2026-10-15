import type { NextRequest } from "next/server";
import { siteAlarmSummary } from "../../../../../db/portal-alarm-overview";
import { apiErrorResponse, requireApiSession } from "../../_lib/auth";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "alarms.read");
    return Response.json(await siteAlarmSummary(db, user.id, user.siteId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

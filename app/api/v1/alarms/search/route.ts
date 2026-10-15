import type { NextRequest } from "next/server";
import { searchSiteCriticalAlarms } from "../../../../../db/portal-alarm-overview";
import { apiErrorResponse, requireApiSession } from "../../_lib/auth";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "alarms.read");
    return Response.json(await searchSiteCriticalAlarms(db, user.id, user.siteId, request.nextUrl.searchParams.get("q") ?? ""), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

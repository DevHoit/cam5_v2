import type { NextRequest } from "next/server";
import { wideHistory } from "../../../../../db/wide-history";
import { historyCsv } from "../../../../../db/sensor-contract";
import { SensorError } from "../../../../../db/sensor-installation";
import { ApiError, apiErrorResponse, requireApiSession } from "../../_lib/auth";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "history.read");
    const csv = request.nextUrl.searchParams.get("format") === "csv";
    const data = await wideHistory(db, user, request.nextUrl.searchParams, csv);
    if (csv) return new Response(historyCsv(data), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="hoitlive-historico.csv"', "Cache-Control": "no-store" } });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return apiErrorResponse(e instanceof SensorError ? new ApiError(e.status, e.message) : e); }
}

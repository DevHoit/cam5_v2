import type { NextRequest } from "next/server";
import { listMetricRules, saveMetricRule, MetricRuleError } from "../../../../db/metric-rules";
import { apiErrorResponse, ApiError, requireApiSession } from "../_lib/auth";
export const dynamic = "force-dynamic";
function failure(error: unknown) { return apiErrorResponse(error instanceof MetricRuleError ? new ApiError(error.status, error.message) : error); }
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "alarms.read");
    return Response.json(await listMetricRules(db, user, request.nextUrl.searchParams.get("assetId") ?? ""), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.write");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Configuración inválida.");
    return Response.json(await saveMetricRule(db, user, body), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

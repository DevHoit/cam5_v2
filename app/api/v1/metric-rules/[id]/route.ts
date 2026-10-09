import type { NextRequest } from "next/server";
import { saveMetricRule, MetricRuleError } from "../../../../../db/metric-rules";
import { apiErrorResponse, ApiError, requireApiSession } from "../../_lib/auth";
export const dynamic = "force-dynamic";
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "settings.write");
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Configuración inválida.");
    return Response.json(await saveMetricRule(db, user, body, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error instanceof MetricRuleError ? new ApiError(error.status, error.message) : error); }
}

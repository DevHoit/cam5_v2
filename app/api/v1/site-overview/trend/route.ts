import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { loadSiteTrend, SITE_GROUP_KEYS, SITE_TREND_PERIODS, type SiteGroup, type SiteTrendHours } from "../../../../../db/site-overview";
import { userAssetScopes } from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

/** Una variable (grupo) comparada entre los puntos del sitio: ?group=temperature|humidity|discharge&hours=24|168|720 */
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "condition.read");
    const group = request.nextUrl.searchParams.get("group") ?? "temperature";
    const hours = Number(request.nextUrl.searchParams.get("hours") ?? 24);
    if (!SITE_GROUP_KEYS.includes(group as SiteGroup)) throw new ApiError(400, "Variable de comparación inválida.");
    if (!(hours in SITE_TREND_PERIODS)) throw new ApiError(400, "Periodo inválido: usa 24, 168 o 720 horas.");
    const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
    const trend = await loadSiteTrend(db, user.siteId, scopes.map((scope) => scope.assetId), group as SiteGroup, hours as SiteTrendHours);
    return Response.json(trend, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

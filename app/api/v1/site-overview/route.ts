import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { loadSiteOverview } from "../../../../db/site-overview";
import { userAssetScopes } from "../../../../db/schema";
import { apiErrorResponse, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

/** Resumen de todos los puntos de medición del sitio activo, lo más grave primero. */
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "condition.read");
    const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
    const overview = await loadSiteOverview(db, user.siteId, scopes.map((scope) => scope.assetId));
    return Response.json(overview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

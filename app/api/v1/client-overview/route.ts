import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { loadClientOverview } from "../../../../db/client-overview";
import { userAssetScopes } from "../../../../db/schema";
import { apiErrorResponse, requireApiSession, sitePermissionsFor } from "../_lib/auth";

export const dynamic = "force-dynamic";

/**
 * Operación completa del cliente activo: todos sus sitios a los que el usuario tiene acceso de lectura,
 * con lo más grave primero. Los permisos se validan sitio por sitio (el rol puede variar entre sitios).
 */
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "condition.read");
    const candidates = user.sites.filter((site) => site.clientId === user.clientId);
    const readable: string[] = [];
    for (const site of candidates) {
      if ((await sitePermissionsFor(db, user, site.id)).includes("condition.read")) readable.push(site.id);
    }
    const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
    const overview = await loadClientOverview(db, readable, scopes.map((scope) => scope.assetId));
    return Response.json({ client: { id: user.clientId, name: user.clientName }, activeSiteId: user.siteId, ...overview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

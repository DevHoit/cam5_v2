import type { NextRequest } from "next/server";
import { switchPortalSessionSite } from "../../../../../db/auth";
import { apiErrorResponse, ApiError, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const { db, token } = await requireApiSession(request);
    const body = await request.json().catch(() => null) as { siteId?: unknown } | null;
    if (typeof body?.siteId !== "string" || !body.siteId) throw new ApiError(400, "Debes seleccionar un sitio válido.");
    const user = await switchPortalSessionSite(db, token, body.siteId);
    if (!user) throw new ApiError(403, "No tienes acceso al sitio seleccionado.");
    return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

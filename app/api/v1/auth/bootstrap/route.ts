import type { NextRequest } from "next/server";
import { portalHierarchy } from "../../../../../db/portal-hierarchy";
import { apiErrorResponse, requireApiSession } from "../../_lib/auth";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const started = performance.now();
  try {
    const { db, user } = await requireApiSession(request, undefined, { allowPasswordChangeRequired: true });
    const authorizedAt = performance.now();
    const hierarchy = !user.mustChangePassword && user.permissions.includes("assets.read") ? await portalHierarchy(db, user) : null;
    return Response.json({ user, hierarchy }, { headers: { "Cache-Control": "no-store", "Server-Timing": `auth;dur=${(authorizedAt - started).toFixed(1)},hierarchy;dur=${(performance.now() - authorizedAt).toFixed(1)}` } });
  } catch (error) { return apiErrorResponse(error); }
}

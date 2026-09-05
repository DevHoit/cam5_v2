import type { NextRequest } from "next/server";
import { apiErrorResponse, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireApiSession(request);
    return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

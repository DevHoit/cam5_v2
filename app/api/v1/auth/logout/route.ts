import type { NextRequest } from "next/server";
import { revokePortalSession, SESSION_COOKIE_NAME } from "../../../../../db/auth";
import { getDb } from "../../../../../db/index";
import { apiErrorResponse } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (token) await revokePortalSession(getDb(), token);
    const response = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    response.headers.append("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}

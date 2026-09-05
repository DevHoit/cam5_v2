import type { NextRequest } from "next/server";
import { getDb } from "../../../../db/index";
import { resolvePortalSession, SESSION_COOKIE_NAME, type AuthenticatedPortalUser } from "../../../../db/auth";
import type { PortalPermission } from "../../../../db/access-control";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireApiSession(
  request: NextRequest,
  permission?: PortalPermission,
): Promise<{ db: ReturnType<typeof getDb>; user: AuthenticatedPortalUser; token: string }> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new ApiError(401, "Debes iniciar sesión.");
  const db = getDb();
  const user = await resolvePortalSession(db, token);
  if (!user) throw new ApiError(401, "La sesión expiró o ya no es válida.");
  if (permission && !user.permissions.includes(permission)) throw new ApiError(403, "No tienes permisos para realizar esta acción.");
  return { db, user, token };
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  if (typeof error === "object" && error && "code" in error && error.code === "23505") {
    return Response.json({ error: "Ya existe un elemento con ese código o identificador en el mismo nivel." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  if (typeof error === "object" && error && "code" in error && error.code === "23503") {
    return Response.json({ error: "El elemento está relacionado con otros registros y no puede modificarse de esa forma." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  console.error("CAM5 API error", error);
  return Response.json({ error: "No fue posible completar la solicitud." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export function requestMetadata(request: NextRequest) {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: request.headers.get("user-agent"),
  };
}

export function parsePage(request: NextRequest) {
  const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(5, Number.parseInt(request.nextUrl.searchParams.get("pageSize") || "10", 10) || 10));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

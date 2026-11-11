import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { ClientLogoError, MAX_CLIENT_LOGO_BYTES, validateClientLogo } from "../../../../../../db/client-branding";
import { auditLogs, clients } from "../../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession, requireClientPermission } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function clientId(context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) throw new ApiError(404, "El cliente no existe.");
  return id;
}

/** Devuelve el logo a cualquier usuario con acceso a algún sitio del cliente. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request);
    const id = await clientId(context);
    if (!user.sites.some((site) => site.clientId === id)) throw new ApiError(404, "El cliente no tiene logo.");
    const [row] = await db.select({ data: clients.logoData, contentType: clients.logoContentType, updatedAt: clients.logoUpdatedAt })
      .from(clients).where(eq(clients.id, id)).limit(1);
    if (!row?.data || !row.contentType) throw new ApiError(404, "El cliente no tiene logo.");
    const etag = `"logo-${row.updatedAt?.getTime() ?? 0}"`;
    const headers = {
      "Content-Type": row.contentType,
      "Cache-Control": "private, max-age=86400",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      // Si el SVG se abre directamente, el navegador no ejecuta nada.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(Buffer.from(row.data, "base64"), { headers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Reemplaza el logo. El cuerpo es el archivo binario tal cual. */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request);
    const id = await clientId(context);
    await requireClientPermission(db, user.id, id, "users.manage");
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_CLIENT_LOGO_BYTES) throw new ApiError(413, `El logo no puede superar ${Math.round(MAX_CLIENT_LOGO_BYTES / 1024)} KB.`);
    const bytes = new Uint8Array(await request.arrayBuffer());
    let logo: ReturnType<typeof validateClientLogo>;
    try {
      logo = validateClientLogo(bytes);
    } catch (error) {
      if (error instanceof ClientLogoError) throw new ApiError(error.message.includes("superar") ? 413 : 400, error.message);
      throw error;
    }
    const now = new Date();
    const [updated] = await db.update(clients)
      .set({ logoData: logo.base64, logoContentType: logo.contentType, logoUpdatedAt: now, updatedAt: now })
      .where(eq(clients.id, id))
      .returning({ id: clients.id, logoUpdatedAt: clients.logoUpdatedAt });
    if (!updated) throw new ApiError(404, "El cliente no existe.");
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({
      siteId: user.siteId,
      actorUserId: user.id,
      action: "clients.logo.update",
      resourceType: "client",
      resourceId: id,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: { contentType: logo.contentType, bytes: bytes.length },
    });
    return Response.json({ logoUpdatedAt: updated.logoUpdatedAt?.toISOString() ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request);
    const id = await clientId(context);
    await requireClientPermission(db, user.id, id, "users.manage");
    const now = new Date();
    await db.update(clients).set({ logoData: null, logoContentType: null, logoUpdatedAt: null, updatedAt: now }).where(eq(clients.id, id));
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({
      siteId: user.siteId,
      actorUserId: user.id,
      action: "clients.logo.delete",
      resourceType: "client",
      resourceId: id,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

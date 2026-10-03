import type { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import {
  MAINTENANCE_SCOPE_TYPES,
  listMaintenanceWindowsForSite,
  maintenanceWindowStatus,
  resolveMaintenanceScope,
  type MaintenanceScopeType,
} from "../../../../db/maintenance-window-service";
import { auditLogs, maintenanceWindows } from "../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "El cuerpo no es válido.");
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string, maximum = 500) {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, `${label} es obligatorio.`);
  const normalized = value.trim();
  if (normalized.length > maximum) throw new ApiError(400, `${label} es demasiado largo.`);
  return normalized;
}

function timestamp(value: unknown, label: string) {
  if (typeof value !== "string") throw new ApiError(400, `${label} debe usar fecha ISO 8601.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ApiError(400, `${label} no es una fecha válida.`);
  return parsed;
}

function scopeType(value: unknown): MaintenanceScopeType {
  if (!MAINTENANCE_SCOPE_TYPES.includes(value as MaintenanceScopeType)) {
    throw new ApiError(400, "scopeType debe ser tenant, site, area, asset o device.");
  }
  return value as MaintenanceScopeType;
}

function canManageClient(user: Awaited<ReturnType<typeof requireApiSession>>["user"], clientId: string) {
  const scope = user.clientScopes.find((item) => item.id === clientId);
  return scope?.roleKey === "platform_admin" || scope?.roleKey === "client_admin";
}

function serializeWindow(window: typeof maintenanceWindows.$inferSelect, now = new Date()) {
  return {
    ...window,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    cancelledAt: window.cancelledAt?.toISOString() ?? null,
    createdAt: window.createdAt.toISOString(),
    status: maintenanceWindowStatus(window, now),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.read");
    const now = new Date();
    const windows = await listMaintenanceWindowsForSite(db, { clientId: user.clientId, siteId: user.siteId });
    return Response.json({
      siteId: user.siteId,
      clientId: user.clientId,
      windows: windows.map((window) => serializeWindow(window, now)),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.write");
    const body = bodyObject(await request.json().catch(() => null));
    const type = scopeType(body.scopeType);
    const scopeId = type === "tenant"
      ? user.clientId
      : type === "site"
        ? user.siteId
        : requiredText(body.scopeId, "scopeId", 80);

    if (type === "tenant" && !canManageClient(user, user.clientId)) {
      throw new ApiError(403, "Sólo un Administrador HOIT o Administrador de cliente puede programar mantenimiento para todo el cliente.");
    }

    const resolved = await resolveMaintenanceScope(db, {
      clientId: user.clientId,
      siteId: user.siteId,
      scopeType: type,
      scopeId,
    });
    if (!resolved) throw new ApiError(403, "El alcance indicado no pertenece al cliente y sitio activos.");

    const startsAt = timestamp(body.startsAt, "startsAt");
    const endsAt = timestamp(body.endsAt, "endsAt");
    if (endsAt <= startsAt) throw new ApiError(400, "endsAt debe ser posterior a startsAt.");
    const reason = requiredText(body.reason, "La razón", 1000);
    const metadata = requestMetadata(request);

    const created = await db.transaction(async (tx) => {
      const [window] = await tx.insert(maintenanceWindows).values({
        clientId: user.clientId,
        scopeType: type,
        scopeId,
        startsAt,
        endsAt,
        reason,
        createdBy: user.id,
      }).returning();

      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "maintenance_window.create",
        resourceType: "maintenance_window",
        resourceId: window.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: window,
      });
      return window;
    });

    return Response.json({ window: serializeWindow(created) }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.write");
    const body = bodyObject(await request.json().catch(() => null));
    const id = requiredText(body.id, "El identificador", 80);
    if (body.cancel !== true) throw new ApiError(400, "PATCH sólo admite cancel=true para preservar la trazabilidad de una ventana.");

    const [current] = await db.select().from(maintenanceWindows)
      .where(and(eq(maintenanceWindows.id, id), isNull(maintenanceWindows.cancelledAt)))
      .limit(1);
    if (!current) throw new ApiError(404, "La ventana no existe o ya fue cancelada.");

    if (current.scopeType === "tenant" && !canManageClient(user, current.clientId)) {
      throw new ApiError(403, "No administras el alcance de cliente de esta ventana.");
    }

    const resolved = await resolveMaintenanceScope(db, {
      clientId: user.clientId,
      siteId: user.siteId,
      scopeType: current.scopeType,
      scopeId: current.scopeId,
    });
    if (!resolved || current.clientId !== user.clientId) {
      throw new ApiError(403, "La ventana está fuera del cliente y sitio activos.");
    }

    const now = new Date();
    const metadata = requestMetadata(request);
    const [cancelled] = await db.transaction(async (tx) => {
      const rows = await tx.update(maintenanceWindows).set({
        cancelledAt: now,
        cancelledBy: user.id,
      }).where(and(eq(maintenanceWindows.id, current.id), isNull(maintenanceWindows.cancelledAt))).returning();
      const row = rows[0];
      if (!row) throw new ApiError(409, "La ventana fue cancelada por otro proceso.");

      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "maintenance_window.cancel",
        resourceType: "maintenance_window",
        resourceId: row.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: current,
        after: row,
      });
      return [row] as const;
    });

    return Response.json({ window: serializeWindow(cancelled, now) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

import type { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { auditLogs, shiftSchedules, shifts } from "../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

type ScheduleInput = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
};

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "El cuerpo no es válido.");
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string, maximum = 160) {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, `${label} es obligatorio.`);
  const normalized = value.trim();
  if (normalized.length > maximum) throw new ApiError(400, `${label} es demasiado largo.`);
  return normalized;
}

function validateTimezone(value: unknown) {
  const timezone = requiredText(value, "La zona horaria", 80);
  try {
    new Intl.DateTimeFormat("es-CL", { timeZone: timezone }).format(new Date());
  } catch {
    throw new ApiError(400, "La zona horaria no es válida.");
  }
  return timezone;
}

function time(value: unknown, label: string) {
  const normalized = requiredText(value, label, 8);
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(normalized)) throw new ApiError(400, `${label} debe usar HH:MM.`);
  return normalized.length === 5 ? `${normalized}:00` : normalized;
}

function date(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, `${label} debe usar YYYY-MM-DD.`);
  return value;
}

function parseSchedules(value: unknown): ScheduleInput[] {
  if (!Array.isArray(value) || !value.length) throw new ApiError(400, "Define al menos un horario semanal.");
  if (value.length > 21) throw new ApiError(400, "Un turno admite como máximo 21 tramos semanales.");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const row = bodyObject(entry);
    const dayOfWeek = Number(row.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) throw new ApiError(400, `schedules[${index}].dayOfWeek no es válido.`);
    const startTime = time(row.startTime, `schedules[${index}].startTime`);
    const endTime = time(row.endTime, `schedules[${index}].endTime`);
    if (startTime === endTime) throw new ApiError(400, "El inicio y término de un tramo no pueden ser iguales.");
    const validFrom = date(row.validFrom, `schedules[${index}].validFrom`);
    const validTo = date(row.validTo, `schedules[${index}].validTo`);
    if (validFrom && validTo && validTo < validFrom) throw new ApiError(400, "validTo no puede ser anterior a validFrom.");
    const identity = `${dayOfWeek}:${startTime}:${endTime}:${validFrom ?? ""}:${validTo ?? ""}`;
    if (seen.has(identity)) throw new ApiError(400, "Hay tramos de turno duplicados.");
    seen.add(identity);
    return { dayOfWeek, startTime, endTime, validFrom, validTo };
  });
}

function canManageClient(user: Awaited<ReturnType<typeof requireApiSession>>["user"]) {
  return user.clientScopes.some((scope) =>
    scope.id === user.clientId && (scope.roleKey === "platform_admin" || scope.roleKey === "client_admin")
  );
}

async function listForClient(db: Awaited<ReturnType<typeof requireApiSession>>["db"], clientId: string) {
  const shiftRows = await db.select().from(shifts).where(eq(shifts.clientId, clientId)).orderBy(asc(shifts.name));
  const scheduleRows = shiftRows.length
    ? await db.select().from(shiftSchedules).orderBy(asc(shiftSchedules.dayOfWeek), asc(shiftSchedules.startTime))
    : [];
  return shiftRows.map((shift) => ({
    ...shift,
    schedules: scheduleRows
      .filter((schedule) => schedule.shiftId === shift.id)
      .map((schedule) => ({
        id: schedule.id,
        dayOfWeek: schedule.dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        validFrom: schedule.validFrom,
        validTo: schedule.validTo,
      })),
  }));
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.read");
    return Response.json({
      clientId: user.clientId,
      canManage: canManageClient(user),
      shifts: await listForClient(db, user.clientId),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "users.manage");
    if (!canManageClient(user)) throw new ApiError(403, "Sólo un Administrador HOIT o Administrador de cliente puede crear turnos.");
    const body = bodyObject(await request.json().catch(() => null));
    const name = requiredText(body.name, "El nombre");
    const timezone = validateTimezone(body.timezone ?? "America/Santiago");
    const schedules = parseSchedules(body.schedules);
    const metadata = requestMetadata(request);

    const created = await db.transaction(async (tx) => {
      const [shift] = await tx.insert(shifts).values({
        clientId: user.clientId,
        name,
        timezone,
        active: body.active !== false,
      }).returning();
      await tx.insert(shiftSchedules).values(schedules.map((schedule) => ({ shiftId: shift.id, ...schedule })));
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "shift.create",
        resourceType: "shift",
        resourceId: shift.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: { ...shift, schedules },
      });
      return shift;
    });

    const item = (await listForClient(db, user.clientId)).find((shift) => shift.id === created.id);
    return Response.json({ shift: item }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "users.manage");
    if (!canManageClient(user)) throw new ApiError(403, "Sólo un Administrador HOIT o Administrador de cliente puede modificar turnos.");
    const body = bodyObject(await request.json().catch(() => null));
    const id = requiredText(body.id, "El identificador", 80);
    const [current] = await db.select().from(shifts).where(and(eq(shifts.id, id), eq(shifts.clientId, user.clientId))).limit(1);
    if (!current) throw new ApiError(404, "El turno no existe dentro del cliente activo.");

    const name = body.name === undefined ? current.name : requiredText(body.name, "El nombre");
    const timezone = body.timezone === undefined ? current.timezone : validateTimezone(body.timezone);
    const active = typeof body.active === "boolean" ? body.active : current.active;
    const schedules = body.schedules === undefined ? null : parseSchedules(body.schedules);
    const metadata = requestMetadata(request);

    await db.transaction(async (tx) => {
      const [updated] = await tx.update(shifts).set({ name, timezone, active }).where(eq(shifts.id, id)).returning();
      if (schedules) {
        await tx.delete(shiftSchedules).where(eq(shiftSchedules.shiftId, id));
        await tx.insert(shiftSchedules).values(schedules.map((schedule) => ({ shiftId: id, ...schedule })));
      }
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "shift.update",
        resourceType: "shift",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: current,
        after: { ...updated, schedules },
      });
    });

    const item = (await listForClient(db, user.clientId)).find((shift) => shift.id === id);
    return Response.json({ shift: item }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

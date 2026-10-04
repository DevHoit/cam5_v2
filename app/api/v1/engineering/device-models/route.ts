import type { NextRequest } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { auditLogs, deviceModels, devices, metricDefinitions } from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";


function text(body: Record<string, unknown>, key: string, label: string) {
  const value = typeof body[key] === "string" ? body[key].trim() : "";
  if (value.length < 2) throw new ApiError(400, `${label} es obligatorio.`);
  return value;
}
function keys(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))];
}

export async function GET(request: NextRequest) {
  try {
    const { db } = await requireApiSession(request, "settings.read");
    const [models, metrics] = await Promise.all([
      db.select().from(deviceModels).orderBy(asc(deviceModels.manufacturer), asc(deviceModels.name)),
      db.select({ id: metricDefinitions.id, key: metricDefinitions.key, name: metricDefinitions.name, category: metricDefinitions.category, unit: metricDefinitions.unit, dataType: metricDefinitions.dataType }).from(metricDefinitions).orderBy(asc(metricDefinitions.category), asc(metricDefinitions.name)),
    ]);
    return Response.json({ models, metrics }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.write");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron datos.");
    const code = text(body, "code", "El código").toUpperCase();
    const manufacturer = text(body, "manufacturer", "El fabricante");
    const name = text(body, "name", "El nombre");
    const registerMapVersion = text(body, "registerMapVersion", "La versión del mapa");
    const metricKeys = keys(body, "metricKeys");
    const capabilityKeys = keys(body, "capabilityKeys");
    if (metricKeys.length) {
      const found = await db.select({ key: metricDefinitions.key }).from(metricDefinitions).where(inArray(metricDefinitions.key, metricKeys));
      if (found.length !== metricKeys.length) throw new ApiError(400, "Una o más métricas seleccionadas no existen en el catálogo.");
    }
    const [existing] = await db.select({ id: deviceModels.id }).from(deviceModels).where(eq(deviceModels.code, code)).limit(1);
    if (existing) throw new ApiError(409, "Ya existe un modelo con ese código.");
    const metadata = requestMetadata(request);
    const [created] = await db.insert(deviceModels).values({ code, manufacturer, name, registerMapVersion, capabilities: { capabilityKeys, metricKeys } }).returning();
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "device_model.create", resourceType: "device_model", resourceId: created.id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, after: created });
    return Response.json({ item: created }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.write");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron cambios.");
    const id = text(body, "id", "El identificador");
    const [current] = await db.select().from(deviceModels).where(eq(deviceModels.id, id)).limit(1);
    if (!current) throw new ApiError(404, "El modelo no existe.");
    const metricKeys = body.metricKeys === undefined ? current.capabilities.metricKeys ?? [] : keys(body, "metricKeys");
    const capabilityKeys = body.capabilityKeys === undefined ? current.capabilities.capabilityKeys ?? [] : keys(body, "capabilityKeys");
    if (metricKeys.length) {
      const found = await db.select({ key: metricDefinitions.key }).from(metricDefinitions).where(inArray(metricDefinitions.key, metricKeys));
      if (found.length !== metricKeys.length) throw new ApiError(400, "Una o más métricas seleccionadas no existen en el catálogo.");
    }
    const [updated] = await db.update(deviceModels).set({
      ...(typeof body.manufacturer === "string" ? { manufacturer: text(body, "manufacturer", "El fabricante") } : {}),
      ...(typeof body.name === "string" ? { name: text(body, "name", "El nombre") } : {}),
      ...(typeof body.registerMapVersion === "string" ? { registerMapVersion: text(body, "registerMapVersion", "La versión del mapa") } : {}),
      capabilities: { capabilityKeys, metricKeys },
    }).where(eq(deviceModels.id, id)).returning();
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "device_model.update", resourceType: "device_model", resourceId: id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: current, after: updated });
    return Response.json({ item: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.write");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibió el modelo.");
    const id = text(body, "id", "El identificador");
    const [linked] = await db.select({ id: devices.id }).from(devices).where(eq(devices.modelId, id)).limit(1);
    if (linked) throw new ApiError(409, "El modelo está asociado a dispositivos y no puede eliminarse.");
    const [removed] = await db.delete(deviceModels).where(eq(deviceModels.id, id)).returning();
    if (!removed) throw new ApiError(404, "El modelo no existe.");
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "device_model.delete", resourceType: "device_model", resourceId: id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: removed });
    return new Response(null, { status: 204 });
  } catch (error) { return apiErrorResponse(error); }
}

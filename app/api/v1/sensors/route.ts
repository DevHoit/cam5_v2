import type { NextRequest } from "next/server";
import { sensorCatalog, saveSensors, SensorError, sensorInstalled, sensorName } from "../../../../db/sensor-installation";
import { ApiError, apiErrorResponse, requireApiSession } from "../_lib/auth";
export const dynamic = "force-dynamic";
const failure = (e: unknown) => apiErrorResponse(e instanceof SensorError ? new ApiError(e.status, e.message) : e);
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "condition.read");
    const rows = await sensorCatalog(db, user, request.nextUrl.searchParams.get("assetId") ?? "");
    return Response.json({ sensors: rows.map(({ metric, device, definition, latest }) => ({ id: metric.id, deviceId: device.id, deviceName: device.name, deviceCode: device.code, updatedAt: device.updatedAt.toISOString(), code: metric.code, name: metric.name, alias: sensorName(metric.name, metric.metadata), key: definition.key, unit: definition.unit, installed: sensorInstalled(metric.metadata, device.metadata), confirmed: metric.metadata.installation !== undefined, recordedAt: latest?.recordedAt.toISOString() ?? null })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return failure(e); }
}
export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.write");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Configuración inválida.");
    return Response.json(await saveSensors(db, user, body));
  } catch (e) { return failure(e); }
}

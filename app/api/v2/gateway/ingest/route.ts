import type { NextRequest } from "next/server";
import { ingestMeasurements, MeasurementIngestError, parseMeasurementPayload } from "../../../../../db/measurement-ingest";
import { apiErrorResponse, ApiError } from "../../../v1/_lib/auth";
import { requireGatewayCredential } from "../../../v1/gateway/_lib/auth";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Mediciones ya decodificadas por el gateway (beacons BLE vía ESP32 y otros equipos que no envían
 * registros Modbus crudos). Acepta el JSON actual del ESP32 tal cual; ver db/measurement-ingest.ts.
 */
export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new ApiError(413, "El envío supera el máximo de 64 KiB.");
    const { db, credential } = await requireGatewayCredential(request);
    const receivedAt = new Date();
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) throw new ApiError(413, "El envío supera el máximo de 64 KiB.");
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { throw new ApiError(400, "El cuerpo debe ser JSON válido."); }
    const payload = parseMeasurementPayload(body, receivedAt);
    const result = await ingestMeasurements(db, { gatewayId: credential.gatewayId, gatewayCode: credential.gatewayCode, siteId: credential.siteId }, payload, receivedAt);
    return Response.json(result, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MeasurementIngestError) return apiErrorResponse(new ApiError(error.status, error.message));
    return apiErrorResponse(error);
  }
}

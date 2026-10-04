import type { NextRequest } from "next/server";
import { apiErrorResponse, ApiError } from "../../_lib/auth";
import { requireGatewayCredential } from "../_lib/auth";
import { handleSpecIngest } from "../_lib/ingest-spec-v1";
import { handleGenericIngest } from "../_lib/ingest-v2";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new ApiError(413, "El lote supera el máximo de 256 KiB.");

    const { db, credential } = await requireGatewayCredential(request);
    const receivedAt = new Date();
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) throw new ApiError(413, "El lote supera el máximo de 256 KiB.");

    const parsedBody = (() => { try { return JSON.parse(rawBody) as unknown; } catch { return null; } })();
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) throw new ApiError(400, "El cuerpo debe ser JSON válido.");

    const envelope = parsedBody as Record<string, unknown>;
    if (envelope.schema_version === "1.0") {
      return handleSpecIngest({ db, credential, rawPayload: parsedBody, receivedAt });
    }
    if (envelope.schemaVersion === "2.0") {
      return handleGenericIngest({ db, credential, rawPayload: parsedBody, receivedAt });
    }

    throw new ApiError(400, "Formato de ingestión no soportado. Core acepta únicamente telemetría semántica normalizada; la adquisición física y decodificación pertenecen al Gateway Agent.");
  } catch (error) {
    return apiErrorResponse(error);
  }
}

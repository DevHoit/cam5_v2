import type { Cam5Database } from "../../../../../db/index";
import { ApiError } from "../../_lib/auth";
import { handleGenericIngest } from "./ingest-v2";

const MAX_SAMPLES = 100;
const MAX_METRICS_PER_SAMPLE = 256;
const MAX_BACKFILL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const QUALITY_VALUES = ["GOOD", "STALE", "INVALID", "UNKNOWN"] as const;
const TIME_QUALITY_VALUES = ["SYNCED", "ESTIMATED", "UNSYNCED"] as const;

type SpecQuality = (typeof QUALITY_VALUES)[number];
type SpecTimeQuality = (typeof TIME_QUALITY_VALUES)[number];

type GatewayCredential = {
  gatewayId: string;
  gatewayCode: string;
  siteId: string;
};

export type SpecIngestPayload = {
  schemaVersion: "1.0";
  gatewayId: string;
  bootId: string;
  messageId: string;
  sequence: number;
  createdAt: Date;
  timeQuality: SpecTimeQuality;
  samples: Array<{
    deviceId: string;
    sampledAt: Date;
    quality: SpecQuality;
    metrics: Record<string, number | boolean | string>;
  }>;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, `${label} debe ser un objeto.`);
  }
  return value as Record<string, unknown>;
}

function strictKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    throw new ApiError(400, `${label} contiene campos no permitidos: ${unexpected.join(", ")}.`);
  }
}

function requiredString(value: unknown, label: string, maximum = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new ApiError(400, `${label} no es válido.`);
  }
  return value.trim();
}

function safeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ApiError(400, `${label} no es válido.`);
  }
  return Number(value);
}

function timestamp(value: unknown, label: string, now: Date) {
  if (typeof value !== "string") throw new ApiError(400, `${label} debe usar fecha ISO 8601 UTC.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ApiError(400, `${label} no es una fecha válida.`);
  if (parsed.getTime() < now.getTime() - MAX_BACKFILL_MS) {
    throw new ApiError(400, `${label} excede el máximo de 7 días de reenvío.`);
  }
  if (parsed.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
    throw new ApiError(400, `${label} está demasiado adelantado respecto del servidor.`);
  }
  return parsed;
}

function messageId(value: unknown) {
  const id = requiredString(value, "message_id", 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new ApiError(400, "message_id debe ser un UUID válido.");
  }
  return id.toLowerCase();
}

function scalarMetric(value: unknown, key: string): number | boolean | string {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.length <= 500) return value;
  throw new ApiError(400, `metrics.${key} debe ser number, boolean o string.`);
}

export function parseSpecIngestPayload(value: unknown, now: Date): SpecIngestPayload {
  const body = object(value, "El cuerpo");
  strictKeys(body, ["schema_version", "gateway_id", "boot_id", "message_id", "sequence", "created_at", "time_quality", "samples"], "El envelope");
  if (body.schema_version !== "1.0") throw new ApiError(400, "schema_version debe ser 1.0.");

  const timeQuality = body.time_quality;
  if (!TIME_QUALITY_VALUES.includes(timeQuality as SpecTimeQuality)) {
    throw new ApiError(400, "time_quality no es válido.");
  }

  if (!Array.isArray(body.samples) || body.samples.length === 0) {
    throw new ApiError(400, "samples debe contener al menos una muestra.");
  }
  if (body.samples.length > MAX_SAMPLES) {
    throw new ApiError(413, `Un mensaje admite como máximo ${MAX_SAMPLES} muestras.`);
  }

  const seenSamples = new Set<string>();
  const samples = body.samples.map((entry, index) => {
    const sample = object(entry, `samples[${index}]`);
    strictKeys(sample, ["device_id", "sampled_at", "quality", "metrics"], `samples[${index}]`);
    const quality = sample.quality;
    if (!QUALITY_VALUES.includes(quality as SpecQuality)) {
      throw new ApiError(400, `samples[${index}].quality no es válida.`);
    }

    const metricsObject = object(sample.metrics, `samples[${index}].metrics`);
    const metricEntries = Object.entries(metricsObject);
    if (!metricEntries.length) throw new ApiError(400, `samples[${index}].metrics no puede estar vacío.`);
    if (metricEntries.length > MAX_METRICS_PER_SAMPLE) {
      throw new ApiError(413, `samples[${index}] supera el máximo de ${MAX_METRICS_PER_SAMPLE} métricas.`);
    }

    const metrics: Record<string, number | boolean | string> = {};
    for (const [key, raw] of metricEntries) {
      if (!key || key.length > 160) throw new ApiError(400, `samples[${index}] contiene una clave de métrica inválida.`);
      metrics[key] = scalarMetric(raw, key);
    }

    const deviceId = requiredString(sample.device_id, `samples[${index}].device_id`, 60).toUpperCase();
    const sampledAt = timestamp(sample.sampled_at, `samples[${index}].sampled_at`, now);
    const identity = `${deviceId}\u0000${sampledAt.toISOString()}`;
    if (seenSamples.has(identity)) {
      throw new ApiError(400, `samples[${index}] duplica device_id + sampled_at dentro del mensaje.`);
    }
    seenSamples.add(identity);

    return {
      deviceId,
      sampledAt,
      quality: quality as SpecQuality,
      metrics,
    };
  });

  return {
    schemaVersion: "1.0",
    gatewayId: requiredString(body.gateway_id, "gateway_id", 60).toUpperCase(),
    bootId: requiredString(body.boot_id, "boot_id", 80),
    messageId: messageId(body.message_id),
    sequence: safeInteger(body.sequence, "sequence"),
    createdAt: timestamp(body.created_at, "created_at", now),
    timeQuality: timeQuality as SpecTimeQuality,
    samples,
  };
}

function mappedQuality(quality: SpecQuality) {
  if (quality === "GOOD") return { quality: "good" as const, qualityFlags: [] as string[] };
  if (quality === "STALE") return { quality: "stale" as const, qualityFlags: [] as string[] };
  if (quality === "INVALID") return { quality: "bad" as const, qualityFlags: ["spec_quality_invalid"] };
  return { quality: "bad" as const, qualityFlags: ["spec_quality_unknown"] };
}

export function specIngestToGenericPayloads(payload: SpecIngestPayload) {
  return payload.samples.map((sample) => {
    const quality = mappedQuality(sample.quality);
    return {
      schemaVersion: "2.0" as const,
      batchKey: `${payload.messageId}:${sample.deviceId}:${sample.sampledAt.toISOString()}`,
      sentAt: payload.createdAt.toISOString(),
      sampledAt: sample.sampledAt.toISOString(),
      timeQuality: payload.timeQuality.toLowerCase() as "synced" | "estimated" | "unsynced",
      quality: quality.quality,
      qualityFlags: quality.qualityFlags,
      gateway: {
        code: payload.gatewayId,
        bootId: payload.bootId,
        sequence: payload.sequence,
      },
      device: {
        code: sample.deviceId,
      },
      metrics: sample.metrics,
    };
  });
}

export async function handleSpecIngest(input: {
  db: Cam5Database;
  credential: GatewayCredential;
  rawPayload: unknown;
  receivedAt: Date;
}) {
  const payload = parseSpecIngestPayload(input.rawPayload, input.receivedAt);
  const genericPayloads = specIngestToGenericPayloads(payload);

  for (const genericPayload of genericPayloads) {
    await handleGenericIngest({
      db: input.db,
      credential: input.credential,
      rawPayload: genericPayload,
      receivedAt: input.receivedAt,
    });
  }

  return Response.json({
    accepted: true,
    message_id: payload.messageId,
    server_time: input.receivedAt.toISOString(),
  }, {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}

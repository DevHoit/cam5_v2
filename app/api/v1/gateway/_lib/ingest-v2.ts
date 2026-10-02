import { and, eq, inArray, sql } from "drizzle-orm";
import type { Cam5Database } from "../../../../../db/index";
import {
  assets,
  deviceMetrics,
  devices,
  gateways,
  gatewayDeviceBindings,
  latestMetricReadings,
  metricDefinitions,
  metricReadings,
  telemetryBatches,
} from "../../../../../db/schema";
import { ApiError } from "../../_lib/auth";

const MAX_METRICS = 256;
const MAX_BACKFILL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const QUALITY_VALUES = ["good", "stale", "bad"] as const;
const TIME_QUALITY_VALUES = ["synced", "estimated", "unsynced"] as const;

type GenericQuality = (typeof QUALITY_VALUES)[number];
type TimeQuality = (typeof TIME_QUALITY_VALUES)[number];

type GenericPayload = {
  schemaVersion: "2.0";
  batchKey: string;
  sentAt: Date;
  sampledAt: Date;
  timeQuality: TimeQuality;
  quality: GenericQuality;
  qualityFlags: string[];
  gateway: {
    code: string;
    bootId: string;
    sequence: number;
  };
  device: {
    code: string;
    driver?: string;
  };
  metrics: Record<string, number | boolean | string>;
};

type GatewayCredential = {
  gatewayId: string;
  gatewayCode: string;
  siteId: string;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, `${label} debe ser un objeto.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, maximum = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new ApiError(400, `${label} no es válido.`);
  return value.trim();
}

function safeInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new ApiError(400, `${label} no es válido.`);
  return Number(value);
}

function timestamp(value: unknown, label: string, now: Date): Date {
  if (typeof value !== "string") throw new ApiError(400, `${label} debe usar fecha ISO 8601 UTC.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ApiError(400, `${label} no es una fecha válida.`);
  if (parsed.getTime() < now.getTime() - MAX_BACKFILL_MS) throw new ApiError(400, `${label} excede el máximo de 7 días de reenvío.`);
  if (parsed.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) throw new ApiError(400, `${label} está demasiado adelantado respecto del servidor.`);
  return parsed;
}

function parseMetricValue(value: unknown, key: string): number | boolean | string {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.length <= 500) return value;
  throw new ApiError(400, `metrics.${key} debe ser number, boolean o string.`);
}

export function parseGenericIngestPayload(value: unknown, now: Date): GenericPayload {
  const body = object(value, "El cuerpo");
  if (body.schemaVersion !== "2.0") throw new ApiError(400, "schemaVersion debe ser 2.0.");
  const gateway = object(body.gateway, "gateway");
  const device = object(body.device, "device");
  const metricObject = object(body.metrics, "metrics");
  const metricEntries = Object.entries(metricObject);
  if (!metricEntries.length) throw new ApiError(400, "metrics debe contener al menos una métrica.");
  if (metricEntries.length > MAX_METRICS) throw new ApiError(413, `Un lote admite como máximo ${MAX_METRICS} métricas.`);

  const quality = body.quality === undefined ? "good" : body.quality;
  if (!QUALITY_VALUES.includes(quality as GenericQuality)) throw new ApiError(400, "quality no es válida.");
  const timeQuality = body.timeQuality === undefined ? "synced" : body.timeQuality;
  if (!TIME_QUALITY_VALUES.includes(timeQuality as TimeQuality)) throw new ApiError(400, "timeQuality no es válida.");

  const qualityFlagsRaw = body.qualityFlags === undefined ? [] : body.qualityFlags;
  if (!Array.isArray(qualityFlagsRaw) || qualityFlagsRaw.some((flag) => typeof flag !== "string" || flag.length > 80)) {
    throw new ApiError(400, "qualityFlags no es válido.");
  }

  const metrics: Record<string, number | boolean | string> = {};
  for (const [key, raw] of metricEntries) {
    if (!key || key.length > 160) throw new ApiError(400, "Una clave de metrics no es válida.");
    metrics[key] = parseMetricValue(raw, key);
  }

  return {
    schemaVersion: "2.0",
    batchKey: requiredString(body.batchKey, "batchKey"),
    sentAt: timestamp(body.sentAt, "sentAt", now),
    sampledAt: timestamp(body.sampledAt, "sampledAt", now),
    timeQuality: timeQuality as TimeQuality,
    quality: quality as GenericQuality,
    qualityFlags: [...new Set(qualityFlagsRaw as string[])],
    gateway: {
      code: requiredString(gateway.code, "gateway.code", 60).toUpperCase(),
      bootId: requiredString(gateway.bootId, "gateway.bootId", 80),
      sequence: safeInteger(gateway.sequence, "gateway.sequence", 0, Number.MAX_SAFE_INTEGER),
    },
    device: {
      code: requiredString(device.code, "device.code", 60).toUpperCase(),
      driver: device.driver === undefined ? undefined : requiredString(device.driver, "device.driver", 80),
    },
    metrics,
  };
}

function typedValue(value: number | boolean | string, dataType: string, metricKey: string) {
  if (dataType === "float") {
    if (typeof value !== "number") throw new ApiError(422, `${metricKey} requiere un valor numérico.`);
    return { valueNumeric: String(value), valueBoolean: null, valueText: null };
  }
  if (dataType === "integer") {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new ApiError(422, `${metricKey} requiere un entero.`);
    return { valueNumeric: String(value), valueBoolean: null, valueText: null };
  }
  if (dataType === "boolean") {
    if (typeof value !== "boolean") throw new ApiError(422, `${metricKey} requiere un booleano.`);
    return { valueNumeric: null, valueBoolean: value, valueText: null };
  }
  if (dataType === "string" || dataType === "enum") {
    if (typeof value !== "string") throw new ApiError(422, `${metricKey} requiere texto.`);
    return { valueNumeric: null, valueBoolean: null, valueText: value };
  }
  throw new ApiError(422, `La métrica ${metricKey} tiene un data_type no soportado.`);
}

export async function handleGenericIngest(input: {
  db: Cam5Database;
  credential: GatewayCredential;
  rawPayload: unknown;
  receivedAt: Date;
}) {
  const { db, credential, receivedAt } = input;
  const payload = parseGenericIngestPayload(input.rawPayload, receivedAt);
  if (payload.gateway.code !== credential.gatewayCode) throw new ApiError(403, "El código del gateway no corresponde a la credencial utilizada.");

  const [device] = await db.select({
    id: devices.id,
    assetId: devices.assetId,
    code: devices.code,
    driver: devices.driver,
  }).from(devices)
    .innerJoin(assets, eq(assets.id, devices.assetId))
    .innerJoin(gatewayDeviceBindings, and(
      eq(gatewayDeviceBindings.deviceId, devices.id),
      eq(gatewayDeviceBindings.gatewayId, credential.gatewayId),
      eq(gatewayDeviceBindings.enabled, true),
    ))
    .where(and(
      eq(devices.code, payload.device.code),
      eq(devices.active, true),
      eq(assets.active, true),
    ))
    .limit(1);

  if (!device) throw new ApiError(404, "El dispositivo no está habilitado para este gateway.");
  if (payload.device.driver && payload.device.driver !== device.driver) throw new ApiError(422, "El driver informado no coincide con el dispositivo configurado.");

  const [existing] = await db.select({
    id: telemetryBatches.id,
    metricCount: telemetryBatches.metricCount,
    success: telemetryBatches.success,
  }).from(telemetryBatches)
    .where(and(eq(telemetryBatches.gatewayId, credential.gatewayId), eq(telemetryBatches.batchKey, payload.batchKey)))
    .limit(1);

  if (existing) {
    return Response.json({
      status: "duplicate",
      batchId: existing.id,
      accepted: existing.metricCount,
      success: existing.success,
      schemaVersion: "2.0",
      serverTime: receivedAt.toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const metricKeys = Object.keys(payload.metrics);
  const configuredMetrics = await db.select({
    deviceMetricId: deviceMetrics.id,
    metricKey: metricDefinitions.key,
    dataType: metricDefinitions.dataType,
    enabled: deviceMetrics.enabled,
  }).from(deviceMetrics)
    .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
    .where(and(
      eq(deviceMetrics.deviceId, device.id),
      eq(deviceMetrics.enabled, true),
      inArray(metricDefinitions.key, metricKeys),
    ));

  const configuredByKey = new Map(configuredMetrics.map((entry) => [entry.metricKey, entry]));
  const unknown = metricKeys.filter((key) => !configuredByKey.has(key));
  if (unknown.length) throw new ApiError(422, `Métricas no configuradas para ${device.code}: ${unknown.join(", ")}.`);

  const prepared = metricKeys.map((key) => {
    const configured = configuredByKey.get(key)!;
    return {
      key,
      configured,
      value: typedValue(payload.metrics[key], configured.dataType, key),
    };
  });

  const result = await db.transaction(async (tx) => {
    const [batch] = await tx.insert(telemetryBatches).values({
      gatewayId: credential.gatewayId,
      deviceId: device.id,
      batchKey: payload.batchKey,
      schemaVersion: payload.schemaVersion,
      gatewayBootId: payload.gateway.bootId,
      gatewaySequence: payload.gateway.sequence,
      sentAt: payload.sentAt,
      sampledAt: payload.sampledAt,
      receivedAt,
      quality: payload.quality,
      timeQuality: payload.timeQuality,
      metricCount: prepared.length,
      success: true,
    }).onConflictDoNothing({
      target: [telemetryBatches.gatewayId, telemetryBatches.batchKey],
    }).returning({ id: telemetryBatches.id });

    if (!batch) {
      const [duplicate] = await tx.select({
        id: telemetryBatches.id,
        metricCount: telemetryBatches.metricCount,
        success: telemetryBatches.success,
      }).from(telemetryBatches)
        .where(and(eq(telemetryBatches.gatewayId, credential.gatewayId), eq(telemetryBatches.batchKey, payload.batchKey)))
        .limit(1);
      if (!duplicate) throw new ApiError(409, "El lote ya está siendo procesado; reintenta con el mismo batchKey.");
      return { duplicate: true, id: duplicate.id, accepted: duplicate.metricCount, success: duplicate.success };
    }

    const inserted = await tx.insert(metricReadings).values(prepared.map((entry) => ({
      batchId: batch.id,
      deviceMetricId: entry.configured.deviceMetricId,
      recordedAt: payload.sampledAt,
      receivedAt,
      ...entry.value,
      quality: payload.quality,
      qualityFlags: payload.qualityFlags,
      timeQuality: payload.timeQuality,
      sequence: payload.gateway.sequence,
    }))).returning({
      id: metricReadings.id,
      deviceMetricId: metricReadings.deviceMetricId,
      recordedAt: metricReadings.recordedAt,
      receivedAt: metricReadings.receivedAt,
      valueNumeric: metricReadings.valueNumeric,
      valueBoolean: metricReadings.valueBoolean,
      valueText: metricReadings.valueText,
      quality: metricReadings.quality,
      qualityFlags: metricReadings.qualityFlags,
      timeQuality: metricReadings.timeQuality,
      sequence: metricReadings.sequence,
    });

    await tx.insert(latestMetricReadings).values(inserted.map((reading) => ({
      deviceMetricId: reading.deviceMetricId,
      readingId: reading.id,
      recordedAt: reading.recordedAt,
      receivedAt: reading.receivedAt,
      valueNumeric: reading.valueNumeric,
      valueBoolean: reading.valueBoolean,
      valueText: reading.valueText,
      quality: reading.quality,
      qualityFlags: reading.qualityFlags,
      timeQuality: reading.timeQuality,
      sequence: reading.sequence,
    }))).onConflictDoUpdate({
      target: latestMetricReadings.deviceMetricId,
      set: {
        readingId: sql`excluded.reading_id`,
        recordedAt: sql`excluded.recorded_at`,
        receivedAt: sql`excluded.received_at`,
        valueNumeric: sql`excluded.value_numeric`,
        valueBoolean: sql`excluded.value_boolean`,
        valueText: sql`excluded.value_text`,
        quality: sql`excluded.quality`,
        qualityFlags: sql`excluded.quality_flags`,
        timeQuality: sql`excluded.time_quality`,
        sequence: sql`excluded.sequence`,
      },
      setWhere: sql`excluded.recorded_at >= ${latestMetricReadings.recordedAt}`,
    });

    await tx.update(gateways).set({
      state: "online",
      lastSeenAt: receivedAt,
      updatedAt: receivedAt,
    }).where(eq(gateways.id, credential.gatewayId));

    await tx.update(devices).set({
      state: "active",
      lastReadAt: payload.sampledAt,
      clockOffsetMs: receivedAt.getTime() - payload.sentAt.getTime(),
      updatedAt: receivedAt,
    }).where(eq(devices.id, device.id));

    await tx.update(assets).set({
      state: payload.quality === "bad" ? "warning" : "normal",
      updatedAt: receivedAt,
    }).where(eq(assets.id, device.assetId));

    return { duplicate: false, id: batch.id, accepted: inserted.length, success: true };
  });

  return Response.json({
    status: result.duplicate ? "duplicate" : "accepted",
    batchId: result.id,
    accepted: result.accepted,
    success: result.success,
    schemaVersion: "2.0",
    serverTime: receivedAt.toISOString(),
  }, {
    status: result.duplicate ? 200 : 202,
    headers: { "Cache-Control": "no-store" },
  });
}

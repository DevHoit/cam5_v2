import type { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { evaluateAlarmReadings, evaluateStaleCommunications } from "../../../../../db/alarm-engine";
import {
  assets,
  channels,
  deviceRegisterSamples,
  devices,
  gateways,
  ingestionBatches,
  latestReadings,
  readings,
  registerDefinitions,
} from "../../../../../db/schema";
import { apiErrorResponse, ApiError } from "../../_lib/auth";
import { requireGatewayCredential } from "../_lib/auth";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_REGISTERS = 105;
const MAX_BACKFILL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const QUALITY_VALUES = ["good", "stale", "bad"] as const;
const QUALITY_FLAGS = ["restart", "communication_lost", "local_forced", "remote_forced", "over_range"] as const;
type InputQuality = typeof QUALITY_VALUES[number];
type QualityFlag = typeof QUALITY_FLAGS[number];
type StoredQuality = typeof readings.$inferInsert.quality;

type GatewayReading = {
  register: number;
  rawValue: number;
  recordedAt: Date;
  sequence: number;
  quality: InputQuality;
  flags: QualityFlag[];
};

type IngestionPayload = {
  schemaVersion: "1.0";
  batchKey: string;
  sentAt: Date;
  gateway: { code: string; bootId: string; sequence: number; uptimeSeconds?: number };
  device: { code: string; unitId: number; serialNumber?: string; firmwareVersion?: string; dataVersion?: number };
  poll: { startedAt: Date; completedAt: Date; expectedRegisters: number; latencyMs: number; error?: { code: string; message: string } };
  readings: GatewayReading[];
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, `${label} debe ser un objeto.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, maximum = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new ApiError(400, `${label} no es válido.`);
  return value.trim();
}

function optionalString(value: unknown, label: string, maximum = 160): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, label, maximum);
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

function parsePayload(value: unknown, now: Date): IngestionPayload {
  const body = object(value, "El cuerpo");
  if (body.schemaVersion !== "1.0") throw new ApiError(400, "schemaVersion debe ser 1.0.");
  const gateway = object(body.gateway, "gateway");
  const device = object(body.device, "device");
  const poll = object(body.poll, "poll");
  if (!Array.isArray(body.readings)) throw new ApiError(400, "readings debe ser un arreglo.");
  if (body.readings.length > MAX_REGISTERS) throw new ApiError(413, `Un lote admite como máximo ${MAX_REGISTERS} registros.`);

  const sentAt = timestamp(body.sentAt, "sentAt", now);
  const startedAt = timestamp(poll.startedAt, "poll.startedAt", now);
  const completedAt = timestamp(poll.completedAt, "poll.completedAt", now);
  if (completedAt < startedAt) throw new ApiError(400, "poll.completedAt no puede ser anterior a poll.startedAt.");
  const expectedRegisters = safeInteger(poll.expectedRegisters, "poll.expectedRegisters", 1, MAX_REGISTERS);
  if (body.readings.length > expectedRegisters) throw new ApiError(400, "readings contiene más elementos que poll.expectedRegisters.");

  let pollError: IngestionPayload["poll"]["error"];
  if (poll.error !== undefined && poll.error !== null) {
    const error = object(poll.error, "poll.error");
    pollError = { code: requiredString(error.code, "poll.error.code", 60), message: requiredString(error.message, "poll.error.message", 500) };
  }
  if (!pollError && body.readings.length !== expectedRegisters) throw new ApiError(400, "Un lote sin error debe contener todos los registros esperados.");

  const defaultSequence = safeInteger(gateway.sequence, "gateway.sequence", 0, Number.MAX_SAFE_INTEGER);
  const seenRegisters = new Set<number>();
  const parsedReadings = body.readings.map((entry, index) => {
    const reading = object(entry, `readings[${index}]`);
    const register = safeInteger(reading.register, `readings[${index}].register`, 0, 65535);
    if (seenRegisters.has(register)) throw new ApiError(400, `El registro ${register} está duplicado en el lote.`);
    seenRegisters.add(register);
    const quality = reading.quality === undefined ? "good" : reading.quality;
    if (!QUALITY_VALUES.includes(quality as InputQuality)) throw new ApiError(400, `readings[${index}].quality no es válida.`);
    const flags = reading.flags === undefined ? [] : reading.flags;
    if (!Array.isArray(flags) || flags.some((flag) => !QUALITY_FLAGS.includes(flag as QualityFlag))) throw new ApiError(400, `readings[${index}].flags contiene un valor no válido.`);
    return {
      register,
      rawValue: safeInteger(reading.rawValue, `readings[${index}].rawValue`, 0, 65535),
      recordedAt: reading.recordedAt === undefined ? completedAt : timestamp(reading.recordedAt, `readings[${index}].recordedAt`, now),
      sequence: reading.sequence === undefined ? defaultSequence : safeInteger(reading.sequence, `readings[${index}].sequence`, 0, Number.MAX_SAFE_INTEGER),
      quality: quality as InputQuality,
      flags: [...new Set(flags as QualityFlag[])],
    };
  });

  const measuredLatency = Math.max(0, completedAt.getTime() - startedAt.getTime());
  return {
    schemaVersion: "1.0",
    batchKey: requiredString(body.batchKey, "batchKey"),
    sentAt,
    gateway: {
      code: requiredString(gateway.code, "gateway.code", 60).toUpperCase(),
      bootId: requiredString(gateway.bootId, "gateway.bootId", 80),
      sequence: defaultSequence,
      uptimeSeconds: gateway.uptimeSeconds === undefined ? undefined : safeInteger(gateway.uptimeSeconds, "gateway.uptimeSeconds", 0, Number.MAX_SAFE_INTEGER),
    },
    device: {
      code: requiredString(device.code, "device.code", 60).toUpperCase(),
      unitId: safeInteger(device.unitId, "device.unitId", 1, 247),
      serialNumber: optionalString(device.serialNumber, "device.serialNumber", 120),
      firmwareVersion: optionalString(device.firmwareVersion, "device.firmwareVersion", 80),
      dataVersion: device.dataVersion === undefined ? undefined : safeInteger(device.dataVersion, "device.dataVersion", 0, 65534),
    },
    poll: {
      startedAt,
      completedAt,
      expectedRegisters,
      latencyMs: poll.latencyMs === undefined ? measuredLatency : safeInteger(poll.latencyMs, "poll.latencyMs", 0, 600_000),
      error: pollError,
    },
    readings: parsedReadings,
  };
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new ApiError(413, "El lote supera el máximo de 256 KiB.");
    const { db, credential } = await requireGatewayCredential(request);
    const receivedAt = new Date();
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) throw new ApiError(413, "El lote supera el máximo de 256 KiB.");
    const payload = parsePayload((() => { try { return JSON.parse(rawBody) as unknown; } catch { return null; } })(), receivedAt);
    if (payload.gateway.code !== credential.gatewayCode) throw new ApiError(403, "El código del gateway no corresponde a la credencial utilizada.");

    const [device] = await db.select({
      id: devices.id,
      assetId: devices.assetId,
      modelId: devices.modelId,
      code: devices.code,
    }).from(devices)
      .innerJoin(assets, eq(assets.id, devices.assetId))
      .where(and(
      eq(devices.gatewayId, credential.gatewayId),
      eq(devices.code, payload.device.code),
      eq(devices.unitId, payload.device.unitId),
      eq(devices.active, true),
      eq(assets.active, true),
    )).limit(1);
    if (!device) throw new ApiError(404, "El controlador no está registrado para este gateway y Unit ID.");

    const [existing] = await db.select({ id: ingestionBatches.id, success: ingestionBatches.success, receivedRegisters: ingestionBatches.receivedRegisters })
      .from(ingestionBatches)
      .where(and(eq(ingestionBatches.gatewayId, credential.gatewayId), eq(ingestionBatches.batchKey, payload.batchKey)))
      .limit(1);
    if (existing) {
      return Response.json({ status: "duplicate", batchId: existing.id, accepted: existing.receivedRegisters, success: existing.success, serverTime: receivedAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
    }

    const catalog = await db.select({
      id: registerDefinitions.id,
      nativeRegister: registerDefinitions.nativeRegister,
      dataType: registerDefinitions.dataType,
      scaleFactor: registerDefinitions.scaleFactor,
      errorRawValue: registerDefinitions.errorRawValue,
      minimumValue: registerDefinitions.minimumValue,
      maximumValue: registerDefinitions.maximumValue,
      channelId: channels.id,
      channelEnabled: channels.enabled,
    }).from(registerDefinitions)
      .leftJoin(channels, and(eq(channels.deviceId, device.id), eq(channels.registerDefinitionId, registerDefinitions.id)))
      .where(eq(registerDefinitions.modelId, device.modelId));
    const catalogByRegister = new Map(catalog.map((entry) => [entry.nativeRegister, entry]));
    const unknownRegisters = payload.readings.filter((reading) => !catalogByRegister.has(reading.register)).map((reading) => reading.register);
    if (unknownRegisters.length) throw new ApiError(422, `Registros fuera del mapa del controlador: ${unknownRegisters.join(", ")}.`);

    const transformed = payload.readings.map((reading) => {
      const definition = catalogByRegister.get(reading.register)!;
      const flags = new Set<QualityFlag>(reading.flags);
      const isErrorCode = definition.errorRawValue !== null && reading.rawValue === definition.errorRawValue;
      const signedRaw = definition.dataType === "int16" && reading.rawValue > 32767 ? reading.rawValue - 65536 : reading.rawValue;
      const scaled = signedRaw * Number(definition.scaleFactor);
      const outsideRange = (definition.minimumValue !== null && scaled < Number(definition.minimumValue)) || (definition.maximumValue !== null && scaled > Number(definition.maximumValue));
      if (outsideRange) flags.add("over_range");
      const quality: InputQuality = isErrorCode || outsideRange || flags.has("communication_lost") ? "bad" : reading.quality;
      const value = quality === "bad" ? null : scaled;
      return { reading, definition, flags: Array.from(flags), quality, value };
    });

    const complete = !payload.poll.error && transformed.length === payload.poll.expectedRegisters;
    const result = await db.transaction(async (tx) => {
      const [batch] = await tx.insert(ingestionBatches).values({
        gatewayId: credential.gatewayId,
        deviceId: device.id,
        batchKey: payload.batchKey,
        gatewayBootId: payload.gateway.bootId,
        gatewaySequence: payload.gateway.sequence,
        gatewayUptimeSeconds: payload.gateway.uptimeSeconds,
        sentAt: payload.sentAt,
        receivedAt,
        startedAt: payload.poll.startedAt,
        completedAt: payload.poll.completedAt,
        expectedRegisters: payload.poll.expectedRegisters,
        receivedRegisters: transformed.length,
        goodRegisters: transformed.filter((entry) => entry.quality === "good").length,
        staleRegisters: transformed.filter((entry) => entry.quality === "stale").length,
        badRegisters: transformed.filter((entry) => entry.quality === "bad").length,
        latencyMs: payload.poll.latencyMs,
        success: complete,
        errorMessage: payload.poll.error ? `${payload.poll.error.code}: ${payload.poll.error.message}` : null,
      }).onConflictDoNothing({ target: [ingestionBatches.gatewayId, ingestionBatches.batchKey] }).returning({ id: ingestionBatches.id });
      if (!batch) {
        const [duplicate] = await tx.select({ id: ingestionBatches.id, success: ingestionBatches.success, receivedRegisters: ingestionBatches.receivedRegisters })
          .from(ingestionBatches)
          .where(and(eq(ingestionBatches.gatewayId, credential.gatewayId), eq(ingestionBatches.batchKey, payload.batchKey)))
          .limit(1);
        if (!duplicate) throw new ApiError(409, "El lote ya está siendo procesado; reintenta con el mismo batchKey.");
        return { id: duplicate.id, duplicate: true, success: duplicate.success, accepted: duplicate.receivedRegisters };
      }

      if (transformed.length) {
        await tx.insert(deviceRegisterSamples).values(transformed.map((entry) => ({
          batchId: batch.id,
          deviceId: device.id,
          registerDefinitionId: entry.definition.id,
          recordedAt: entry.reading.recordedAt,
          rawValue: entry.reading.rawValue,
          value: entry.value === null ? null : String(entry.value),
          quality: entry.quality,
          qualityFlags: entry.flags,
          sequence: entry.reading.sequence,
          receivedAt,
        })));
      }

      const operational = transformed.filter((entry) => entry.definition.channelId);
      if (operational.length) {
        const insertedReadings = await tx.insert(readings).values(operational.map((entry) => ({
          channelId: entry.definition.channelId!,
          batchId: batch.id,
          recordedAt: entry.reading.recordedAt,
          receivedAt,
          rawValue: entry.reading.rawValue,
          value: entry.definition.channelEnabled && entry.value !== null ? String(entry.value) : null,
          quality: (entry.definition.channelEnabled ? entry.quality : "disabled") as StoredQuality,
          qualityFlags: entry.flags,
          sequence: entry.reading.sequence,
        }))).returning({
          id: readings.id,
          channelId: readings.channelId,
          recordedAt: readings.recordedAt,
          receivedAt: readings.receivedAt,
          rawValue: readings.rawValue,
          value: readings.value,
          quality: readings.quality,
          qualityFlags: readings.qualityFlags,
          sequence: readings.sequence,
        });
        await tx.insert(latestReadings).values(insertedReadings.map((reading) => ({
          channelId: reading.channelId,
          readingId: reading.id,
          recordedAt: reading.recordedAt,
          receivedAt: reading.receivedAt,
          rawValue: reading.rawValue,
          value: reading.value,
          quality: reading.quality,
          qualityFlags: reading.qualityFlags,
          sequence: reading.sequence,
        }))).onConflictDoUpdate({
          target: latestReadings.channelId,
          set: {
            readingId: sql`excluded.reading_id`,
            recordedAt: sql`excluded.recorded_at`,
            receivedAt: sql`excluded.received_at`,
            rawValue: sql`excluded.raw_value`,
            value: sql`excluded.value`,
            quality: sql`excluded.quality`,
            qualityFlags: sql`excluded.quality_flags`,
            sequence: sql`excluded.sequence`,
          },
          setWhere: sql`excluded.recorded_at >= ${latestReadings.recordedAt}`,
        });
      }

      await tx.update(gateways).set({ state: "online", lastSeenAt: receivedAt, updatedAt: receivedAt }).where(eq(gateways.id, credential.gatewayId));
      await tx.update(devices).set({
        state: transformed.length ? "active" : "offline",
        ...(transformed.length ? { lastReadAt: payload.poll.completedAt } : {}),
        serialNumber: payload.device.serialNumber,
        firmwareVersion: payload.device.firmwareVersion,
        dataVersion: payload.device.dataVersion,
        clockOffsetMs: receivedAt.getTime() - payload.sentAt.getTime(),
        updatedAt: receivedAt,
      }).where(eq(devices.id, device.id));
      await tx.update(assets).set({ state: transformed.length ? "normal" : "offline", updatedAt: receivedAt }).where(eq(assets.id, device.assetId));
      return { id: batch.id, duplicate: false, success: complete, accepted: transformed.length };
    });

    if (result.duplicate) {
      return Response.json({ status: "duplicate", batchId: result.id, accepted: result.accepted, success: result.success, serverTime: receivedAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
    }

    let alarmEvaluation = { opened: 0, updated: 0, resolved: 0 };
    try {
      alarmEvaluation = await evaluateAlarmReadings(db, device.assetId, transformed
        .filter((entry) => entry.definition.channelId)
        .map((entry) => ({
          channelId: entry.definition.channelId!,
          value: entry.definition.channelEnabled ? entry.value : null,
          quality: entry.definition.channelEnabled ? entry.quality : "disabled",
          qualityFlags: entry.flags,
        })), receivedAt);
      await evaluateStaleCommunications(db, credential.siteId, receivedAt);
    } catch (alarmError) {
      console.error("No fue posible evaluar las alarmas del lote", alarmError);
    }

    return Response.json({
      status: "accepted",
      batchId: result.id,
      accepted: transformed.length,
      operationalReadings: transformed.filter((entry) => entry.definition.channelId).length,
      success: complete,
      alarms: alarmEvaluation,
      serverTime: receivedAt.toISOString(),
      nextUploadInMs: complete ? 2_000 : 10_000,
    }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

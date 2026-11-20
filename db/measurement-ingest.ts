import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { evaluateAlarmReadings, evaluateStaleCommunications } from "./alarm-engine";
import type { Cam5Database } from "./index";
import {
  assets,
  channels,
  detectedDevices,
  devices,
  gateways,
  ingestionBatches,
  latestReadings,
  readingProfiles,
  readings,
  registerDefinitions,
} from "./schema";

/**
 * Ingesta de mediciones ya decodificadas por el gateway (beacons BLE leídos por un ESP32, y a futuro
 * cualquier equipo cuyo gateway entregue valores en vez de registros Modbus crudos).
 *
 * El gateway envía, por equipo, su identidad externa (MAC) y un mapa clave → valor. La plantilla del
 * modelo (register_definitions.source_key) traduce cada clave a un canal con magnitud, unidad y escala.
 * Equipos que nadie ha asignado quedan en detected_devices para que el administrador los ubique.
 */

export class MeasurementIngestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const MAX_DEVICES = 50;
const MAX_VALUES_PER_DEVICE = 40;
const MAX_BACKFILL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_HEALTH_KEYS = 40;
/** Tolerancia para el intervalo de guardado: un ESP32 que envía cada 30 s no debe saltarse lecturas por milisegundos. */
const STORAGE_TOLERANCE = 0.9;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,59}$/;
const ID_PATTERN = /^[A-Za-z0-9:._-]{1,120}$/;
/** Campos del formato del ESP32 que describen la lectura y no son mediciones. */
const ESP32_META_FIELDS = new Set(["mac", "age_ms", "ts"]);

export type MeasurementDevice = {
  externalId: string;
  recordedAt: Date;
  rssi: number | null;
  values: Record<string, number>;
};

export type MeasurementPayload = {
  gatewayCode: string;
  sequence: number;
  bootId: string | null;
  uptimeMs: number | null;
  devices: MeasurementDevice[];
  health: Record<string, string | number | boolean> | null;
};

function fail(message: string, status = 400): never {
  throw new MeasurementIngestError(status, message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} debe ser un objeto.`);
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label} no es válido.`);
  return Number(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e12;
}

/** MAC u otro identificador: sin espacios, en mayúsculas para que "c3:00:…" y "C3:00:…" sean el mismo equipo. */
export function normalizeExternalId(value: unknown, label = "id") {
  if (typeof value !== "string" || !ID_PATTERN.test(value.trim())) fail(`${label} no es un identificador válido.`);
  return value.trim().toUpperCase();
}

function recordedAtOf(entry: Record<string, unknown>, label: string, now: Date) {
  let recordedAt = now;
  if (entry.ts !== undefined && entry.ts !== null) {
    if (typeof entry.ts !== "string" || !Number.isFinite(new Date(entry.ts).getTime())) fail(`${label}.ts debe ser una fecha ISO 8601.`);
    recordedAt = new Date(entry.ts);
  } else if (entry.age_ms !== undefined && entry.age_ms !== null) {
    recordedAt = new Date(now.getTime() - integer(entry.age_ms, `${label}.age_ms`, 0, MAX_BACKFILL_MS));
  }
  if (recordedAt.getTime() < now.getTime() - MAX_BACKFILL_MS) fail(`${label} excede el máximo de 7 días de reenvío.`);
  if (recordedAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) fail(`${label} está demasiado adelantado respecto del servidor.`);
  return recordedAt;
}

function measurementValues(source: Record<string, unknown>, label: string, skip: Set<string>) {
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    if (skip.has(key) || value === null || value === undefined) continue;
    if (!KEY_PATTERN.test(key)) fail(`${label}: la clave "${key.slice(0, 60)}" no es válida (minúsculas, números y _).`);
    if (!finite(value)) fail(`${label}.${key} debe ser numérico.`);
    values[key] = value;
  }
  if (Object.keys(values).length > MAX_VALUES_PER_DEVICE) fail(`${label} admite como máximo ${MAX_VALUES_PER_DEVICE} mediciones.`);
  return values;
}

function parseHealth(value: unknown, uptimeMs: number | null) {
  const clean: Record<string, string | number | boolean> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value).slice(0, MAX_HEALTH_KEYS)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
      if (typeof entry === "string") clean[key] = entry.slice(0, 120);
      else if (finite(entry)) clean[key] = entry;
      else if (typeof entry === "boolean") clean[key] = entry;
    }
  }
  if (uptimeMs !== null && clean.uptimeS === undefined) clean.uptimeS = Math.floor(uptimeMs / 1000);
  return Object.keys(clean).length ? clean : null;
}

/**
 * Acepta dos formas equivalentes:
 * - ESP32 actual: {"gateway","sequence","uptime_ms","beacons":[{"mac","temperature","humidity","battery_percent","battery_mv","rssi","age_ms"}]}
 * - Genérica:     {"gateway","sequence","bootId"?,"health"?,"devices":[{"id","ts"|"age_ms","rssi"?,"m":{clave: valor}}]}
 */
export function parseMeasurementPayload(value: unknown, now = new Date()): MeasurementPayload {
  const body = object(value, "El cuerpo");
  const gatewayCode = typeof (body.gateway ?? body.gw) === "string" ? String(body.gateway ?? body.gw).trim().toUpperCase() : "";
  if (!gatewayCode || gatewayCode.length > 60) fail("gateway es obligatorio.");
  const sequence = integer(body.sequence ?? body.seq, "sequence", 0, Number.MAX_SAFE_INTEGER);
  const uptimeMs = body.uptime_ms === undefined || body.uptime_ms === null ? null : integer(body.uptime_ms, "uptime_ms", 0, Number.MAX_SAFE_INTEGER);
  const bootId = body.bootId === undefined || body.bootId === null ? null : String(body.bootId).trim().slice(0, 80) || null;

  const list = body.devices ?? body.beacons;
  if (body.devices !== undefined && body.beacons !== undefined) fail("Usa devices o beacons, no ambos.");
  if (!Array.isArray(list)) fail("devices debe ser un arreglo.");
  if (list.length > MAX_DEVICES) fail(`Un envío admite como máximo ${MAX_DEVICES} equipos.`, 413);

  const seen = new Set<string>();
  const parsed = list.map((raw, index): MeasurementDevice => {
    const label = `${body.devices !== undefined ? "devices" : "beacons"}[${index}]`;
    const entry = object(raw, label);
    const isBeacon = body.beacons !== undefined;
    const externalId = normalizeExternalId(isBeacon ? entry.mac : entry.id, `${label}.${isBeacon ? "mac" : "id"}`);
    if (seen.has(externalId)) fail(`El equipo ${externalId} está duplicado en el envío.`);
    seen.add(externalId);
    const values = isBeacon
      ? measurementValues(entry, label, ESP32_META_FIELDS)
      : measurementValues(object(entry.m, `${label}.m`), `${label}.m`, new Set());
    const rssiSource = entry.rssi ?? values.rssi;
    const rssi = finite(rssiSource) ? Math.round(rssiSource) : null;
    if (!isBeacon && rssi !== null && values.rssi === undefined) values.rssi = rssi;
    return { externalId, recordedAt: recordedAtOf(entry, label, now), rssi, values };
  });

  return { gatewayCode, sequence, bootId, uptimeMs, devices: parsed, health: parseHealth(body.health, uptimeMs) };
}

export type MeasurementGateway = { gatewayId: string; gatewayCode: string; siteId: string };

export type MeasurementIngestResult = {
  status: "accepted";
  devices: number;
  stored: number;
  observed: number;
  duplicates: number;
  unknown: string[];
  ignoredKeys: Record<string, string[]>;
  alarms: { opened: number; updated: number; resolved: number };
  serverTime: string;
};

function batchKeyOf(payload: MeasurementPayload, device: MeasurementDevice) {
  const boot = payload.bootId ?? (payload.uptimeMs !== null ? `u${payload.uptimeMs}` : `t${device.recordedAt.getTime()}`);
  return `m:${boot}:${payload.sequence}:${device.externalId}`.slice(0, 160);
}

export async function ingestMeasurements(
  db: Cam5Database,
  gateway: MeasurementGateway,
  payload: MeasurementPayload,
  receivedAt = new Date(),
): Promise<MeasurementIngestResult> {
  if (payload.gatewayCode !== gateway.gatewayCode.toUpperCase()) fail("El código del gateway no corresponde a la credencial utilizada.", 403);

  await db.update(gateways).set({
    state: "online",
    lastSeenAt: receivedAt,
    updatedAt: receivedAt,
    ...(payload.health ? {
      metadata: sql`coalesce(${gateways.metadata}, '{}'::jsonb) || ${JSON.stringify({ health: { ...payload.health, receivedAt: receivedAt.toISOString() } })}::jsonb`,
      ...(typeof payload.health.fw === "string" ? { softwareVersion: payload.health.fw.slice(0, 80) } : typeof payload.health.version === "string" ? { softwareVersion: payload.health.version.slice(0, 80) } : {}),
    } : {}),
  }).where(eq(gateways.id, gateway.gatewayId));

  const result: MeasurementIngestResult = { status: "accepted", devices: 0, stored: 0, observed: 0, duplicates: 0, unknown: [], ignoredKeys: {}, alarms: { opened: 0, updated: 0, resolved: 0 }, serverTime: receivedAt.toISOString() };
  if (!payload.devices.length) return result;

  const ids = payload.devices.map((device) => device.externalId);
  const registered = await db.select({
    id: devices.id,
    externalId: devices.externalId,
    assetId: devices.assetId,
    modelId: devices.modelId,
    active: devices.active,
    assetActive: assets.active,
    storageIntervalSeconds: readingProfiles.storageIntervalSeconds,
  }).from(devices)
    .innerJoin(assets, eq(assets.id, devices.assetId))
    .leftJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
    .where(and(eq(devices.gatewayId, gateway.gatewayId), inArray(devices.externalId, ids)));
  const byExternalId = new Map(registered.map((row) => [row.externalId!, row]));

  // Equipos sin asignar: quedan visibles en la bandeja de detectados (los descartados solo actualizan su última vez visto).
  const unknown = payload.devices.filter((device) => !byExternalId.has(device.externalId));
  for (const device of unknown) {
    await db.insert(detectedDevices).values({
      gatewayId: gateway.gatewayId,
      externalId: device.externalId,
      firstSeenAt: receivedAt,
      lastSeenAt: receivedAt,
      lastRssi: device.rssi,
      lastValues: device.values,
    }).onConflictDoUpdate({
      target: [detectedDevices.gatewayId, detectedDevices.externalId],
      set: {
        lastSeenAt: receivedAt,
        seenCount: sql`${detectedDevices.seenCount} + 1`,
        lastRssi: device.rssi,
        lastValues: device.values,
      },
    });
  }
  result.unknown = unknown.map((device) => device.externalId);

  const known = payload.devices.filter((device) => {
    const row = byExternalId.get(device.externalId);
    return row?.active && row.assetActive;
  });
  if (!known.length) return result;

  const modelIds = [...new Set(known.map((device) => byExternalId.get(device.externalId)!.modelId))];
  const deviceIds = known.map((device) => byExternalId.get(device.externalId)!.id);
  const [definitions, channelRows] = await Promise.all([
    db.select({
      id: registerDefinitions.id,
      modelId: registerDefinitions.modelId,
      sourceKey: registerDefinitions.sourceKey,
      scaleFactor: registerDefinitions.scaleFactor,
      minimumValue: registerDefinitions.minimumValue,
      maximumValue: registerDefinitions.maximumValue,
    }).from(registerDefinitions).where(and(inArray(registerDefinitions.modelId, modelIds), isNotNull(registerDefinitions.sourceKey))),
    db.select({ id: channels.id, deviceId: channels.deviceId, definitionId: channels.registerDefinitionId, enabled: channels.enabled, latestAt: latestReadings.recordedAt })
      .from(channels)
      .leftJoin(latestReadings, eq(latestReadings.channelId, channels.id))
      .where(inArray(channels.deviceId, deviceIds)),
  ]);

  const evaluations = new Map<string, Parameters<typeof evaluateAlarmReadings>[2]>();
  for (const device of known) {
    const row = byExternalId.get(device.externalId)!;
    const modelDefinitions = definitions.filter((definition) => definition.modelId === row.modelId);
    const definitionByKey = new Map(modelDefinitions.map((definition) => [definition.sourceKey!, definition]));
    const ignored = Object.keys(device.values).filter((key) => !definitionByKey.has(key));
    if (ignored.length) result.ignoredKeys[device.externalId] = ignored;

    const entries = Object.entries(device.values).flatMap(([key, rawValue]) => {
      const definition = definitionByKey.get(key);
      const channel = definition && channelRows.find((candidate) => candidate.deviceId === row.id && candidate.definitionId === definition.id);
      if (!definition || !channel) return [];
      const scaled = rawValue * Number(definition.scaleFactor);
      const outsideRange = (definition.minimumValue !== null && scaled < Number(definition.minimumValue))
        || (definition.maximumValue !== null && scaled > Number(definition.maximumValue));
      return [{ channel, scaled, outsideRange, rawValue }];
    });
    result.observed += entries.length;
    result.devices += 1;

    const storageMs = (row.storageIntervalSeconds ?? 60) * 1000 * STORAGE_TOLERANCE;
    const due = entries.filter(({ channel }) => channel.enabled && (!channel.latestAt || device.recordedAt.getTime() - channel.latestAt.getTime() >= storageMs));

    const stored = await db.transaction(async (tx) => {
      if (due.length) {
        const [batch] = await tx.insert(ingestionBatches).values({
          gatewayId: gateway.gatewayId,
          deviceId: row.id,
          batchKey: batchKeyOf(payload, device),
          gatewayBootId: payload.bootId,
          gatewaySequence: payload.sequence,
          gatewayUptimeSeconds: payload.uptimeMs === null ? null : Math.floor(payload.uptimeMs / 1000),
          receivedAt,
          startedAt: device.recordedAt,
          completedAt: device.recordedAt,
          expectedRegisters: due.length,
          receivedRegisters: due.length,
          goodRegisters: due.filter((entry) => !entry.outsideRange).length,
          badRegisters: due.filter((entry) => entry.outsideRange).length,
          success: true,
        }).onConflictDoNothing({ target: [ingestionBatches.gatewayId, ingestionBatches.batchKey] }).returning({ id: ingestionBatches.id });
        if (!batch) return null;

        const inserted = await tx.insert(readings).values(due.map((entry) => ({
          channelId: entry.channel.id,
          batchId: batch.id,
          recordedAt: device.recordedAt,
          receivedAt,
          rawValue: Number.isSafeInteger(entry.rawValue) && Math.abs(entry.rawValue) <= 2_147_483_647 ? entry.rawValue : null,
          value: entry.outsideRange ? null : String(entry.scaled),
          quality: (entry.outsideRange ? "bad" : "good") as "bad" | "good",
          qualityFlags: entry.outsideRange ? ["over_range"] : [],
          sequence: payload.sequence,
        }))).returning();
        await tx.insert(latestReadings).values(inserted.map((reading) => ({
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
      await tx.update(devices).set({ state: "active", lastReadAt: device.recordedAt, updatedAt: receivedAt }).where(eq(devices.id, row.id));
      await tx.update(assets).set({ state: "normal", updatedAt: receivedAt }).where(and(eq(assets.id, row.assetId), eq(assets.state, "offline")));
      return due.length;
    });
    if (stored === null) {
      result.duplicates += 1;
      continue;
    }
    result.stored += stored;

    const pending = evaluations.get(row.assetId) ?? [];
    pending.push(...entries.filter((entry) => entry.channel.enabled).map((entry) => ({
      channelId: entry.channel.id,
      value: entry.outsideRange ? null : entry.scaled,
      quality: (entry.outsideRange ? "bad" : "good") as "bad" | "good",
      qualityFlags: entry.outsideRange ? ["over_range"] : [],
    })));
    evaluations.set(row.assetId, pending);
  }

  try {
    for (const [assetId, assetReadings] of evaluations) {
      const evaluation = await evaluateAlarmReadings(db, assetId, assetReadings, receivedAt);
      result.alarms.opened += evaluation.opened;
      result.alarms.updated += evaluation.updated;
      result.alarms.resolved += evaluation.resolved;
    }
    if (evaluations.size) await evaluateStaleCommunications(db, gateway.siteId, receivedAt);
  } catch (error) {
    console.error("No fue posible evaluar las alarmas de las mediciones", error);
  }
  return result;
}

import { and, eq } from "drizzle-orm";
import type { Cam5Database } from "../../../../../db/index";
import { assets, devices, gatewayDeviceBindings, gateways, readingProfiles } from "../../../../../db/schema";
import { ApiError } from "../../_lib/auth";

const DEVICE_STATES = ["ONLINE", "DEGRADED", "OFFLINE", "UNKNOWN"] as const;
type DeviceHealthState = (typeof DEVICE_STATES)[number];

type GatewayCredential = {
  gatewayId: string;
  gatewayCode: string;
  siteId: string;
};

export type SpecHeartbeatPayload = {
  schemaVersion: "1.0";
  gatewayId: string;
  bootId: string;
  softwareVersion: string;
  uptimeSeconds: number;
  buffer: {
    pendingMessages: number;
    bytes: number;
    usagePercent: number;
  };
  network: {
    activeInterface: string;
    rssiDbm: number | null;
    ipAvailable: boolean;
  };
  system: {
    cpuPercent: number;
    memoryPercent: number;
    diskPercent: number;
  };
  interfaces: Record<string, string>;
  devices: Array<{
    deviceId: string;
    status: DeviceHealthState;
    latencyMs: number | null;
    lastSuccessAt: Date | null;
    consecutiveErrors: number;
  }>;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, `${label} debe ser un objeto.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, maximum = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new ApiError(400, `${label} no es válido.`);
  }
  return value.trim();
}

function nonNegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ApiError(400, `${label} no es válido.`);
  return Number(value);
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ApiError(400, `${label} no es válido.`);
  return value;
}

function percentage(value: unknown, label: string) {
  const parsed = finiteNumber(value, label);
  if (parsed < 0 || parsed > 100) throw new ApiError(400, `${label} debe estar entre 0 y 100.`);
  return parsed;
}

function optionalTimestamp(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ApiError(400, `${label} debe usar fecha ISO 8601 UTC.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ApiError(400, `${label} no es una fecha válida.`);
  return parsed;
}

export function parseSpecHeartbeatPayload(value: unknown): SpecHeartbeatPayload {
  const body = object(value, "El cuerpo");
  if (body.schema_version !== "1.0") throw new ApiError(400, "schema_version debe ser 1.0.");

  const buffer = object(body.buffer, "buffer");
  const network = object(body.network, "network");
  const system = object(body.system, "system");
  const interfacesRaw = object(body.interfaces, "interfaces");
  if (!Array.isArray(body.devices)) throw new ApiError(400, "devices debe ser un arreglo.");
  if (body.devices.length > 256) throw new ApiError(413, "Un heartbeat admite como máximo 256 devices.");

  const interfaces: Record<string, string> = {};
  for (const [key, raw] of Object.entries(interfacesRaw)) {
    if (!key || key.length > 80 || typeof raw !== "string" || !raw.trim() || raw.length > 80) {
      throw new ApiError(400, "interfaces contiene un estado inválido.");
    }
    interfaces[key] = raw.trim().toUpperCase();
  }

  const seenDevices = new Set<string>();
  const parsedDevices = body.devices.map((entry, index) => {
    const device = object(entry, `devices[${index}]`);
    const deviceId = requiredString(device.device_id, `devices[${index}].device_id`, 60).toUpperCase();
    if (seenDevices.has(deviceId)) throw new ApiError(400, `devices[${index}].device_id está duplicado.`);
    seenDevices.add(deviceId);

    if (!DEVICE_STATES.includes(device.status as DeviceHealthState)) {
      throw new ApiError(400, `devices[${index}].status no es válido.`);
    }
    const latencyMs = device.latency_ms === null || device.latency_ms === undefined
      ? null
      : finiteNumber(device.latency_ms, `devices[${index}].latency_ms`);
    if (latencyMs !== null && latencyMs < 0) throw new ApiError(400, `devices[${index}].latency_ms no es válido.`);

    return {
      deviceId,
      status: device.status as DeviceHealthState,
      latencyMs,
      lastSuccessAt: optionalTimestamp(device.last_success_at, `devices[${index}].last_success_at`),
      consecutiveErrors: nonNegativeInteger(device.consecutive_errors, `devices[${index}].consecutive_errors`),
    };
  });

  const rssi = network.rssi_dbm === null || network.rssi_dbm === undefined
    ? null
    : finiteNumber(network.rssi_dbm, "network.rssi_dbm");
  if (typeof network.ip_available !== "boolean") throw new ApiError(400, "network.ip_available debe ser boolean.");

  return {
    schemaVersion: "1.0",
    gatewayId: requiredString(body.gateway_id, "gateway_id", 60).toUpperCase(),
    bootId: requiredString(body.boot_id, "boot_id", 80),
    softwareVersion: requiredString(body.software_version, "software_version", 80),
    uptimeSeconds: nonNegativeInteger(body.uptime_seconds, "uptime_seconds"),
    buffer: {
      pendingMessages: nonNegativeInteger(buffer.pending_messages, "buffer.pending_messages"),
      bytes: nonNegativeInteger(buffer.bytes, "buffer.bytes"),
      usagePercent: percentage(buffer.usage_percent, "buffer.usage_percent"),
    },
    network: {
      activeInterface: requiredString(network.active_interface, "network.active_interface", 80),
      rssiDbm: rssi,
      ipAvailable: network.ip_available,
    },
    system: {
      cpuPercent: percentage(system.cpu_percent, "system.cpu_percent"),
      memoryPercent: percentage(system.memory_percent, "system.memory_percent"),
      diskPercent: percentage(system.disk_percent, "system.disk_percent"),
    },
    interfaces,
    devices: parsedDevices,
  };
}

export async function handleSpecHeartbeat(input: {
  db: Cam5Database;
  credential: GatewayCredential;
  rawPayload: unknown;
  receivedAt: Date;
}) {
  const payload = parseSpecHeartbeatPayload(input.rawPayload);
  if (payload.gatewayId !== input.credential.gatewayCode) {
    throw new ApiError(403, "gateway_id no corresponde a la credencial utilizada.");
  }

  const [[currentGateway], [policy]] = await Promise.all([
    input.db.select({ metadata: gateways.metadata }).from(gateways)
      .where(eq(gateways.id, input.credential.gatewayId)).limit(1),
    input.db.select({ heartbeatIntervalSeconds: readingProfiles.heartbeatIntervalSeconds })
      .from(gatewayDeviceBindings)
      .innerJoin(devices, eq(devices.id, gatewayDeviceBindings.deviceId))
      .innerJoin(assets, eq(assets.id, devices.assetId))
      .leftJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
      .where(and(
        eq(gatewayDeviceBindings.gatewayId, input.credential.gatewayId),
        eq(gatewayDeviceBindings.enabled, true),
        eq(devices.active, true),
        eq(assets.active, true),
      ))
      .limit(1),
  ]);
  if (!currentGateway) throw new ApiError(404, "El gateway no existe.");

  const previousMetadata = currentGateway.metadata && typeof currentGateway.metadata === "object"
    ? currentGateway.metadata
    : {};
  const health = {
    schemaVersion: payload.schemaVersion,
    bootId: payload.bootId,
    uptimeSeconds: payload.uptimeSeconds,
    buffer: payload.buffer,
    network: payload.network,
    system: payload.system,
    interfaces: payload.interfaces,
    devices: payload.devices.map((device) => ({
      deviceId: device.deviceId,
      status: device.status,
      latencyMs: device.latencyMs,
      lastSuccessAt: device.lastSuccessAt?.toISOString() ?? null,
      consecutiveErrors: device.consecutiveErrors,
    })),
    receivedAt: input.receivedAt.toISOString(),
  };

  await input.db.update(gateways).set({
    state: "online",
    softwareVersion: payload.softwareVersion,
    lastSeenAt: input.receivedAt,
    metadata: { ...previousMetadata, health },
    updatedAt: input.receivedAt,
  }).where(eq(gateways.id, input.credential.gatewayId));

  return Response.json({
    accepted: true,
    gateway_id: payload.gatewayId,
    server_time: input.receivedAt.toISOString(),
    next_heartbeat_seconds: policy?.heartbeatIntervalSeconds ?? 30,
  }, {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}

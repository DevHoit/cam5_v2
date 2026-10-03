import { and, eq } from "drizzle-orm";
import type { Cam5Database } from "../../../../../db/index";
import { assets, devices, gatewayDeviceBindings } from "../../../../../db/schema";
import { ApiError } from "../../_lib/auth";

type GatewayCredential = {
  gatewayId: string;
  gatewayCode: string;
  siteId: string;
};

type BindingRow = {
  bindingId: string;
  interfaceType: string;
  interfaceKey: string | null;
  address: number | null;
  baudRate: number | null;
  parity: string | null;
  dataBits: number | null;
  stopBits: number | null;
  config: Record<string, unknown>;
  updatedAt: Date;
  deviceCode: string;
  driver: string;
  protocol: string;
  enabled: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function configuredString(config: Record<string, unknown>, key: string) {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedDriver(driver: string) {
  if (driver === "schneider_pm5560") return "pm5560";
  if (driver === "dse8660_mkii") return "dse8660";
  if (driver === "eddystone_tlm") return "ble_eddystone_tlm";
  return driver;
}

function pollProfile(driver: string, config: Record<string, unknown>) {
  const explicit = configuredString(config, "poll_profile") ?? configuredString(config, "pollProfile");
  if (explicit) return explicit;
  if (driver === "schneider_pm5560") return "pm5560_default";
  if (driver === "dse8660_mkii") return "dse8660_default";
  return null;
}

function parityCode(value: string | null) {
  if (value === "even") return "E";
  if (value === "odd") return "O";
  if (value === "none") return "N";
  return null;
}

function rs485Transport(row: BindingRow) {
  const config = record(row.config);
  const port = configuredString(config, "port");
  const baud = row.baudRate;
  const parity = parityCode(row.parity);
  const stopBits = row.stopBits;
  const slaveId = row.address;

  if (!port || !port.startsWith("/dev/")) {
    throw new ApiError(409, `El dispositivo ${row.deviceCode} no tiene un puerto Linux RS-485 válido configurado.`);
  }
  if (!baud || !parity || !stopBits || !slaveId) {
    throw new ApiError(409, `La configuración RS-485 de ${row.deviceCode} está incompleta.`);
  }

  return {
    type: "modbus_rtu",
    port,
    baud,
    parity,
    stop_bits: stopBits,
    slave_id: slaveId,
  };
}

function bleTransport(row: BindingRow) {
  const config = record(row.config);
  const namespaceId = configuredString(config, "namespace_id")
    ?? configuredString(record(config.identity), "namespace_id");
  const instanceId = configuredString(config, "instance_id")
    ?? configuredString(record(config.identity), "instance_id");
  const protocol = configuredString(config, "protocol") ?? "eddystone_tlm";

  if (!namespaceId || !instanceId) {
    throw new ApiError(409, `La identidad BLE de ${row.deviceCode} está incompleta.`);
  }

  return {
    type: "ble",
    protocol,
    identity: {
      namespace_id: namespaceId,
      instance_id: instanceId,
    },
  };
}

function transportFor(row: BindingRow) {
  if (row.interfaceType === "rs485") return rs485Transport(row);
  if (row.interfaceType === "ble") return bleTransport(row);
  throw new ApiError(409, `La interfaz ${row.interfaceType} de ${row.deviceCode} aún no tiene contrato HOIT V1.`);
}

async function bindingRows(db: Cam5Database, gatewayId: string): Promise<BindingRow[]> {
  return db.select({
    bindingId: gatewayDeviceBindings.id,
    interfaceType: gatewayDeviceBindings.interfaceType,
    interfaceKey: gatewayDeviceBindings.interfaceKey,
    address: gatewayDeviceBindings.address,
    baudRate: gatewayDeviceBindings.baudRate,
    parity: gatewayDeviceBindings.parity,
    dataBits: gatewayDeviceBindings.dataBits,
    stopBits: gatewayDeviceBindings.stopBits,
    config: gatewayDeviceBindings.config,
    updatedAt: gatewayDeviceBindings.updatedAt,
    deviceCode: devices.code,
    driver: devices.driver,
    protocol: devices.protocol,
    enabled: devices.active,
  }).from(gatewayDeviceBindings)
    .innerJoin(devices, eq(devices.id, gatewayDeviceBindings.deviceId))
    .innerJoin(assets, eq(assets.id, devices.assetId))
    .where(and(
      eq(gatewayDeviceBindings.gatewayId, gatewayId),
      eq(gatewayDeviceBindings.enabled, true),
      eq(devices.active, true),
      eq(assets.active, true),
    ))
    .orderBy(devices.code);
}

export async function hasSpecGatewayConfig(db: Cam5Database, gatewayId: string) {
  const [row] = await db.select({ id: gatewayDeviceBindings.id })
    .from(gatewayDeviceBindings)
    .innerJoin(devices, eq(devices.id, gatewayDeviceBindings.deviceId))
    .innerJoin(assets, eq(assets.id, devices.assetId))
    .where(and(
      eq(gatewayDeviceBindings.gatewayId, gatewayId),
      eq(gatewayDeviceBindings.enabled, true),
      eq(devices.active, true),
      eq(assets.active, true),
    ))
    .limit(1);
  return Boolean(row);
}

export async function buildSpecGatewayConfig(db: Cam5Database, credential: GatewayCredential) {
  const rows = await bindingRows(db, credential.gatewayId);
  if (!rows.length) throw new ApiError(404, "El gateway no tiene devices HOIT configurados.");

  const configVersion = Math.max(...rows.map((row) => row.updatedAt.getTime()));
  return {
    schema_version: "1.0",
    config_version: configVersion,
    gateway_id: credential.gatewayCode,
    upload: {
      interval_seconds: 5,
      max_batch_samples: 100,
    },
    devices: rows.map((row) => {
      const config = record(row.config);
      const profile = pollProfile(row.driver, config);
      return {
        device_id: row.deviceCode,
        driver: normalizedDriver(row.driver),
        enabled: row.enabled,
        transport: transportFor(row),
        ...(profile ? { poll_profile: profile } : {}),
      };
    }),
  };
}

export async function handleSpecGatewayConfig(db: Cam5Database, credential: GatewayCredential) {
  const payload = await buildSpecGatewayConfig(db, credential);
  return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}

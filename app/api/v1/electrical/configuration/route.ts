import type { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  assets,
  auditLogs,
  deviceCapabilities,
  deviceMetrics,
  devices,
  gatewayDeviceBindings,
  gateways,
  metricDefinitions,
} from "../../../../../db/schema";
import { parseElectricalAlarmConfig, validateElectricalAlarmConfig } from "../../../../../db/electrical";
import { PM5560_CAPABILITIES, PM5560_CORE_METRIC_KEYS, PM5560_DEFAULT_RS485, pm5560MetricCode } from "../../../../../db/pm5560";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, label + " no es válido.");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min) throw new ApiError(400, label + " es obligatorio.");
  return value.trim();
}
function linuxDevicePath(value: unknown): string {
  const path = text(value, "El puerto Linux", 5);
  if (path.length > 255 || !/^\/dev\/[A-Za-z0-9._/-]+$/.test(path)) {
    throw new ApiError(400, "El puerto Linux debe ser una ruta /dev/... válida.");
  }
  return path;
}
function optionalNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ApiError(400, label + " debe ser numérico.");
  return value;
}
function integer(value: unknown, label: string, fallback: number, minimum: number, maximum: number) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ApiError(400, `${label} debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "assets.read");
    const [points, gatewayRows, meterRows] = await Promise.all([
      db.select({
        id: assets.id,
        code: assets.code,
        name: assets.name,
        area: assets.area,
        state: assets.state,
        nominalVoltageKv: assets.nominalVoltageKv,
        metadata: assets.metadata,
      }).from(assets)
        .where(and(eq(assets.siteId, user.siteId), eq(assets.assetType, "electrical_point"), eq(assets.active, true)))
        .orderBy(assets.code),
      db.select({
        id: gateways.id,
        code: gateways.code,
        name: gateways.name,
        state: gateways.state,
        active: gateways.active,
      }).from(gateways)
        .where(and(eq(gateways.siteId, user.siteId), eq(gateways.active, true)))
        .orderBy(gateways.code),
      db.select({
        id: devices.id,
        assetId: devices.assetId,
        code: devices.code,
        name: devices.name,
        state: devices.state,
        unitId: devices.unitId,
        driver: devices.driver,
        metadata: devices.metadata,
        gatewayId: gatewayDeviceBindings.gatewayId,
        busKey: gatewayDeviceBindings.interfaceKey,
        address: gatewayDeviceBindings.address,
        baudRate: gatewayDeviceBindings.baudRate,
        parity: gatewayDeviceBindings.parity,
        dataBits: gatewayDeviceBindings.dataBits,
        stopBits: gatewayDeviceBindings.stopBits,
        bindingConfig: gatewayDeviceBindings.config,
      }).from(devices)
        .innerJoin(assets, eq(assets.id, devices.assetId))
        .leftJoin(gatewayDeviceBindings, and(eq(gatewayDeviceBindings.deviceId, devices.id), eq(gatewayDeviceBindings.enabled, true)))
        .where(and(
          eq(assets.siteId, user.siteId),
          eq(assets.assetType, "electrical_point"),
          eq(devices.deviceType, "power_meter"),
          eq(devices.driver, "schneider_pm5560"),
          eq(devices.active, true),
        ))
        .orderBy(devices.code),
    ]);

    return Response.json({ points, gateways: gatewayRows, meters: meterRows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request);
    const body = object(await request.json().catch(() => null), "El cuerpo");
    const action = text(body.action, "action");
    const meta = requestMetadata(request);

    if (action === "create_point") {
      if (!user.permissions.includes("assets.write")) throw new ApiError(403, "No tienes permisos para crear puntos eléctricos.");
      const code = text(body.code, "El código", 2).toUpperCase();
      const name = text(body.name, "El nombre", 2);
      const nominalVoltageKv = optionalNumber(body.nominalVoltageKv, "nominalVoltageKv");
      if (nominalVoltageKv !== null && nominalVoltageKv <= 0) throw new ApiError(400, "nominalVoltageKv debe ser mayor que cero.");

      const [row] = await db.insert(assets).values({
        siteId: user.siteId,
        code,
        name,
        area: typeof body.area === "string" && body.area.trim() ? body.area.trim() : null,
        assetType: "electrical_point",
        nominalVoltageKv: nominalVoltageKv === null ? null : String(nominalVoltageKv),
        state: "offline",
        metadata: {
          electrical: {
            phases: 3,
            readOnly: true,
            alarms: {
              staleAfterSeconds: 30,
              thresholdDelaySeconds: 0,
              voltageMinV: null,
              voltageMaxV: null,
              currentMaxA: null,
              frequencyMinHz: null,
              frequencyMaxHz: null,
              powerFactorMin: null,
              voltageHysteresisV: 0,
              currentHysteresisA: 0,
              frequencyHysteresisHz: 0,
              powerFactorHysteresis: 0,
            },
          },
        },
      }).returning();

      await db.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "electrical.point.create",
        resourceType: "asset",
        resourceId: row.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        after: row,
      });
      return Response.json({ point: row }, { status: 201 });
    }

    if (action === "create_pm5560") {
      if (!user.permissions.includes("settings.write")) throw new ApiError(403, "No tienes permisos para configurar medidores.");
      const pointId = text(body.pointId, "El punto eléctrico");
      const gatewayId = text(body.gatewayId, "El gateway");
      const code = text(body.code, "El código", 2).toUpperCase();
      const name = text(body.name, "El nombre", 2);
      const port = linuxDevicePath(body.port);
      const unitId = integer(body.unitId, "unitId", 1, 1, 247);
      const busKey = typeof body.busKey === "string" && body.busKey.trim() ? body.busKey.trim().toLowerCase() : "rs485-1";
      if (!/^[a-z0-9._-]{1,64}$/.test(busKey)) throw new ApiError(400, "busKey sólo admite letras, números, punto, guion y guion bajo.");
      const baudRate = integer(body.baudRate, "baudRate", PM5560_DEFAULT_RS485.baudRate, 1200, 115200);
      const pollIntervalMs = integer(body.pollIntervalMs, "pollIntervalMs", PM5560_DEFAULT_RS485.pollIntervalMs, 250, 60000);
      const parity = typeof body.parity === "string" ? body.parity.toLowerCase() : PM5560_DEFAULT_RS485.parity;
      if (!["none", "even", "odd"].includes(parity)) throw new ApiError(400, "parity debe ser none, even u odd.");

      const [[point], [gateway]] = await Promise.all([
        db.select({ id: assets.id }).from(assets).where(and(
          eq(assets.id, pointId),
          eq(assets.siteId, user.siteId),
          eq(assets.assetType, "electrical_point"),
          eq(assets.active, true),
        )).limit(1),
        db.select({ id: gateways.id }).from(gateways).where(and(
          eq(gateways.id, gatewayId),
          eq(gateways.siteId, user.siteId),
          eq(gateways.active, true),
        )).limit(1),
      ]);
      if (!point) throw new ApiError(404, "El punto eléctrico no existe en el sitio activo.");
      if (!gateway) throw new ApiError(404, "El gateway no existe en el sitio activo.");

      const [duplicateAddress] = await db.select({ code: devices.code }).from(gatewayDeviceBindings)
        .innerJoin(devices, eq(devices.id, gatewayDeviceBindings.deviceId))
        .where(and(
          eq(gatewayDeviceBindings.gatewayId, gatewayId),
          eq(gatewayDeviceBindings.interfaceType, "rs485"),
          eq(gatewayDeviceBindings.interfaceKey, busKey),
          eq(gatewayDeviceBindings.address, unitId),
          eq(gatewayDeviceBindings.enabled, true),
          eq(devices.active, true),
        )).limit(1);
      if (duplicateAddress) throw new ApiError(409, `La dirección Modbus ${unitId} ya está asignada a ${duplicateAddress.code} en el bus ${busKey}.`);

      const [busPeer] = await db.select({
        code: devices.code,
        baudRate: gatewayDeviceBindings.baudRate,
        parity: gatewayDeviceBindings.parity,
        dataBits: gatewayDeviceBindings.dataBits,
        stopBits: gatewayDeviceBindings.stopBits,
        config: gatewayDeviceBindings.config,
      }).from(gatewayDeviceBindings)
        .innerJoin(devices, eq(devices.id, gatewayDeviceBindings.deviceId))
        .where(and(
          eq(gatewayDeviceBindings.gatewayId, gatewayId),
          eq(gatewayDeviceBindings.interfaceType, "rs485"),
          eq(gatewayDeviceBindings.interfaceKey, busKey),
          eq(gatewayDeviceBindings.enabled, true),
          eq(devices.active, true),
        )).limit(1);
      if (busPeer && (
        (busPeer.baudRate !== null && busPeer.baudRate !== baudRate)
        || (busPeer.parity !== null && busPeer.parity !== parity)
        || (busPeer.dataBits !== null && busPeer.dataBits !== 8)
        || (busPeer.stopBits !== null && busPeer.stopBits !== 1)
      )) {
        throw new ApiError(409, `El bus ${busKey} ya usa otra configuración serial en ${busPeer.code}. Todos los equipos del mismo bus deben compartir baud rate, paridad, bits de datos y stop bits.`);
      }
      const peerPort = busPeer?.config && typeof busPeer.config === "object" && !Array.isArray(busPeer.config)
        ? (busPeer.config as Record<string, unknown>).port
        : null;
      if (typeof peerPort === "string" && peerPort.trim() && peerPort.trim() !== port) {
        throw new ApiError(409, `El bus ${busKey} ya está asociado al puerto Linux ${peerPort.trim()} en ${busPeer?.code}. Usa el mismo puerto para todos los equipos del bus.`);
      }

      const metrics = await db.select({ id: metricDefinitions.id, key: metricDefinitions.key, name: metricDefinitions.name })
        .from(metricDefinitions)
        .where(inArray(metricDefinitions.key, [...PM5560_CORE_METRIC_KEYS]));
      if (metrics.length !== PM5560_CORE_METRIC_KEYS.length) {
        throw new ApiError(409, "El catálogo PM5560 no está inicializado. Aplica la migración 0018.");
      }
      const byKey = new Map(metrics.map((metric) => [metric.key, metric]));

      const meter = await db.transaction(async (tx) => {
        const [row] = await tx.insert(devices).values({
          assetId: pointId,
          gatewayId: null,
          modelId: null,
          readingProfileId: null,
          code,
          name,
          deviceType: "power_meter",
          driver: "schneider_pm5560",
          protocol: "modbus_rtu",
          host: null,
          port: null,
          unitId,
          timeoutMs: 1000,
          retries: 2,
          state: "commissioning",
          metadata: {
            manufacturer: "Schneider Electric",
            model: "PowerLogic PM5560",
            readOnly: true,
          },
        }).returning();

        await tx.insert(gatewayDeviceBindings).values({
          gatewayId,
          deviceId: row.id,
          interfaceType: "rs485",
          interfaceKey: busKey,
          address: unitId,
          baudRate,
          parity,
          dataBits: 8,
          stopBits: 1,
          config: {
            protocol: "modbus_rtu",
            port,
            poll_profile: "pm5560_default",
            interfaceKey: busKey,
            unitId,
            baudRate,
            parity,
            dataBits: 8,
            stopBits: 1,
            pollIntervalMs,
            readOnly: true,
          },
        });
        await tx.insert(deviceCapabilities).values(PM5560_CAPABILITIES.map((capabilityKey) => ({
          deviceId: row.id,
          capabilityKey,
        })));
        await tx.insert(deviceMetrics).values(PM5560_CORE_METRIC_KEYS.map((key, index) => {
          const metric = byKey.get(key);
          if (!metric) throw new ApiError(409, "Falta la métrica " + key + ".");
          return {
            deviceId: row.id,
            metricDefinitionId: metric.id,
            code: pm5560MetricCode(key),
            name: metric.name,
            displayOrder: index,
          };
        }));
        await tx.insert(auditLogs).values({
          siteId: user.siteId,
          actorUserId: user.id,
          action: "electrical.pm5560.create",
          resourceType: "device",
          resourceId: row.id,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          after: {
            ...row,
            acquisition: { gatewayId, interfaceType: "rs485", busKey, port, unitId, baudRate, parity, dataBits: 8, stopBits: 1, pollIntervalMs, readOnly: true },
          },
        });
        return row;
      });

      return Response.json({ meter }, { status: 201 });
    }

    throw new ApiError(400, "La acción no es válida.");
  } catch (error) {
    return apiErrorResponse(error);
  }
}


export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "assets.write");
    const body = object(await request.json().catch(() => null), "El cuerpo");
    const pointId = text(body.pointId, "El punto eléctrico");
    const meta = requestMetadata(request);

    const [current] = await db.select().from(assets).where(and(
      eq(assets.id, pointId),
      eq(assets.siteId, user.siteId),
      eq(assets.assetType, "electrical_point"),
      eq(assets.active, true),
    )).limit(1);
    if (!current) throw new ApiError(404, "El punto eléctrico no existe en el sitio activo.");

    const currentMetadata = current.metadata ?? {};
    const currentElectrical = currentMetadata.electrical && typeof currentMetadata.electrical === "object" && !Array.isArray(currentMetadata.electrical)
      ? currentMetadata.electrical as Record<string, unknown>
      : {};
    const existing = parseElectricalAlarmConfig(currentMetadata);
    const next = {
      ...existing,
      ...(body.staleAfterSeconds !== undefined ? { staleAfterSeconds: integer(body.staleAfterSeconds, "staleAfterSeconds", existing.staleAfterSeconds, 5, 86400) } : {}),
      ...(body.thresholdDelaySeconds !== undefined ? { thresholdDelaySeconds: integer(body.thresholdDelaySeconds, "thresholdDelaySeconds", existing.thresholdDelaySeconds, 0, 86400) } : {}),
      ...(body.voltageMinV !== undefined ? { voltageMinV: optionalNumber(body.voltageMinV, "voltageMinV") } : {}),
      ...(body.voltageMaxV !== undefined ? { voltageMaxV: optionalNumber(body.voltageMaxV, "voltageMaxV") } : {}),
      ...(body.currentMaxA !== undefined ? { currentMaxA: optionalNumber(body.currentMaxA, "currentMaxA") } : {}),
      ...(body.frequencyMinHz !== undefined ? { frequencyMinHz: optionalNumber(body.frequencyMinHz, "frequencyMinHz") } : {}),
      ...(body.frequencyMaxHz !== undefined ? { frequencyMaxHz: optionalNumber(body.frequencyMaxHz, "frequencyMaxHz") } : {}),
      ...(body.powerFactorMin !== undefined ? { powerFactorMin: optionalNumber(body.powerFactorMin, "powerFactorMin") } : {}),
      ...(body.voltageHysteresisV !== undefined ? { voltageHysteresisV: optionalNumber(body.voltageHysteresisV, "voltageHysteresisV") ?? 0 } : {}),
      ...(body.currentHysteresisA !== undefined ? { currentHysteresisA: optionalNumber(body.currentHysteresisA, "currentHysteresisA") ?? 0 } : {}),
      ...(body.frequencyHysteresisHz !== undefined ? { frequencyHysteresisHz: optionalNumber(body.frequencyHysteresisHz, "frequencyHysteresisHz") ?? 0 } : {}),
      ...(body.powerFactorHysteresis !== undefined ? { powerFactorHysteresis: optionalNumber(body.powerFactorHysteresis, "powerFactorHysteresis") ?? 0 } : {}),
    };
    try {
      validateElectricalAlarmConfig(next);
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : "La configuración de alarmas no es válida.");
    }

    const [updated] = await db.update(assets).set({
      ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
      ...(typeof body.area === "string" ? { area: body.area.trim() || null } : {}),
      ...(body.nominalVoltageKv !== undefined ? {
        nominalVoltageKv: optionalNumber(body.nominalVoltageKv, "nominalVoltageKv") === null
          ? null
          : String(optionalNumber(body.nominalVoltageKv, "nominalVoltageKv")),
      } : {}),
      metadata: {
        ...currentMetadata,
        electrical: {
          ...currentElectrical,
          alarms: next,
        },
      },
      updatedAt: new Date(),
    }).where(eq(assets.id, pointId)).returning();

    await db.insert(auditLogs).values({
      siteId: user.siteId,
      actorUserId: user.id,
      action: "electrical.point.update",
      resourceType: "asset",
      resourceId: pointId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      before: current,
      after: updated,
    });

    return Response.json({ point: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

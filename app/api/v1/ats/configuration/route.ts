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
import { parseAtsConfig } from "../../../../../db/ats";
import {
  DSE8660_CAPABILITIES,
  DSE8660_CORE_METRIC_KEYS,
  DSE8660_DEFAULT_ACQUISITION,
  dse8660MetricCode,
} from "../../../../../db/dse8660";
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
function integer(value: unknown, label: string, fallback: number, minimum: number, maximum: number) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ApiError(400, `${label} debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return value;
}
function requiredInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ApiError(400, `${label} debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return value;
}
function boolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "assets.read");
    const [units, gatewayRows, controllerRows] = await Promise.all([
      db.select({
        id: assets.id,
        code: assets.code,
        name: assets.name,
        area: assets.area,
        state: assets.state,
        metadata: assets.metadata,
      }).from(assets)
        .where(and(eq(assets.siteId, user.siteId), eq(assets.assetType, "ats"), eq(assets.active, true)))
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
        metadata: devices.metadata,
        gatewayId: gatewayDeviceBindings.gatewayId,
        bindingConfig: gatewayDeviceBindings.config,
      }).from(devices)
        .innerJoin(assets, eq(assets.id, devices.assetId))
        .leftJoin(gatewayDeviceBindings, and(eq(gatewayDeviceBindings.deviceId, devices.id), eq(gatewayDeviceBindings.enabled, true)))
        .where(and(
          eq(assets.siteId, user.siteId),
          eq(assets.assetType, "ats"),
          eq(devices.deviceType, "ats_controller"),
          eq(devices.driver, "dse8660_mkii"),
          eq(devices.active, true),
        ))
        .orderBy(devices.code),
    ]);

    return Response.json({ units, gateways: gatewayRows, controllers: controllerRows }, { headers: { "Cache-Control": "no-store" } });
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

    if (action === "create_ats") {
      if (!user.permissions.includes("assets.write")) throw new ApiError(403, "No tienes permisos para crear ATS.");
      const code = text(body.code, "El código", 2).toUpperCase();
      const name = text(body.name, "El nombre", 2);
      const source1Label = typeof body.source1Label === "string" && body.source1Label.trim() ? body.source1Label.trim() : "Fuente 1";
      const source2Label = typeof body.source2Label === "string" && body.source2Label.trim() ? body.source2Label.trim() : "Fuente 2";

      const [row] = await db.insert(assets).values({
        siteId: user.siteId,
        code,
        name,
        area: typeof body.area === "string" && body.area.trim() ? body.area.trim() : null,
        assetType: "ats",
        state: "offline",
        metadata: {
          ats: {
            source1Label,
            source2Label,
            readOnly: true,
            expectedPosition: null,
            alarms: {
              staleAfterSeconds: 30,
              source1Required: false,
              source2Required: false,
              sourceUnavailableDelaySeconds: 5,
              commonAlarmDelaySeconds: 0,
              unexpectedPositionDelaySeconds: 10,
            },
          },
        },
      }).returning();

      await db.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "ats.asset.create",
        resourceType: "asset",
        resourceId: row.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        after: row,
      });
      return Response.json({ unit: row }, { status: 201 });
    }

    if (action === "create_dse8660") {
      if (!user.permissions.includes("settings.write")) throw new ApiError(403, "No tienes permisos para configurar controladores ATS.");
      const assetId = text(body.assetId, "El ATS");
      const gatewayId = text(body.gatewayId, "El gateway");
      const code = text(body.code, "El código", 2).toUpperCase();
      const name = text(body.name, "El nombre", 2);
      const unitId = requiredInteger(body.unitId, "unitId", 1, 247);
      const baudRate = requiredInteger(body.baudRate, "baudRate", 1200, 115200);
      const pollIntervalMs = integer(body.pollIntervalMs, "pollIntervalMs", DSE8660_DEFAULT_ACQUISITION.pollIntervalMs, 250, 60000);
      const parity = typeof body.parity === "string" ? body.parity.toLowerCase() : "";
      if (!["none", "even", "odd"].includes(parity)) throw new ApiError(400, "Selecciona parity: none, even u odd.");

      const [[unit], [gateway]] = await Promise.all([
        db.select({ id: assets.id }).from(assets).where(and(
          eq(assets.id, assetId),
          eq(assets.siteId, user.siteId),
          eq(assets.assetType, "ats"),
          eq(assets.active, true),
        )).limit(1),
        db.select({ id: gateways.id }).from(gateways).where(and(
          eq(gateways.id, gatewayId),
          eq(gateways.siteId, user.siteId),
          eq(gateways.active, true),
        )).limit(1),
      ]);
      if (!unit) throw new ApiError(404, "El ATS no existe en el sitio activo.");
      if (!gateway) throw new ApiError(404, "El gateway no existe en el sitio activo.");

      const [duplicateAddress] = await db.select({ code: devices.code }).from(gatewayDeviceBindings)
        .innerJoin(devices, eq(devices.id, gatewayDeviceBindings.deviceId))
        .where(and(
          eq(gatewayDeviceBindings.gatewayId, gatewayId),
          eq(gatewayDeviceBindings.interfaceType, "rs485"),
          eq(gatewayDeviceBindings.enabled, true),
          eq(devices.unitId, unitId),
          eq(devices.active, true),
        )).limit(1);
      if (duplicateAddress) throw new ApiError(409, `La dirección Modbus ${unitId} ya está asignada a ${duplicateAddress.code} en este gateway.`);

      const metrics = await db.select({ id: metricDefinitions.id, key: metricDefinitions.key, name: metricDefinitions.name })
        .from(metricDefinitions)
        .where(inArray(metricDefinitions.key, [...DSE8660_CORE_METRIC_KEYS]));
      if (metrics.length !== DSE8660_CORE_METRIC_KEYS.length) {
        throw new ApiError(409, "El catálogo DSE8660 no está inicializado. Aplica la migración 0021.");
      }
      const byKey = new Map(metrics.map((metric) => [metric.key, metric]));

      const controller = await db.transaction(async (tx) => {
        const [row] = await tx.insert(devices).values({
          assetId,
          gatewayId: null,
          modelId: null,
          readingProfileId: null,
          code,
          name,
          deviceType: "ats_controller",
          driver: "dse8660_mkii",
          protocol: "modbus_rtu",
          host: null,
          port: null,
          unitId,
          timeoutMs: 1000,
          retries: 2,
          state: "commissioning",
          metadata: {
            manufacturer: "Deep Sea Electronics",
            model: "DSE8660 MKII",
            readOnly: true,
            registerMapVerified: false,
          },
        }).returning();

        await tx.insert(gatewayDeviceBindings).values({
          gatewayId,
          deviceId: row.id,
          interfaceType: "rs485",
          config: {
            protocol: "modbus_rtu",
            unitId,
            baudRate,
            parity,
            dataBits: DSE8660_DEFAULT_ACQUISITION.dataBits,
            stopBits: DSE8660_DEFAULT_ACQUISITION.stopBits,
            pollIntervalMs,
            readOnly: true,
          },
        });
        await tx.insert(deviceCapabilities).values(DSE8660_CAPABILITIES.map((capabilityKey) => ({
          deviceId: row.id,
          capabilityKey,
        })));
        await tx.insert(deviceMetrics).values(DSE8660_CORE_METRIC_KEYS.map((key, index) => {
          const metric = byKey.get(key);
          if (!metric) throw new ApiError(409, "Falta la métrica " + key + ".");
          return {
            deviceId: row.id,
            metricDefinitionId: metric.id,
            code: dse8660MetricCode(key),
            name: metric.name,
            displayOrder: index,
          };
        }));
        await tx.insert(auditLogs).values({
          siteId: user.siteId,
          actorUserId: user.id,
          action: "ats.dse8660.create",
          resourceType: "device",
          resourceId: row.id,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          after: {
            ...row,
            acquisition: { gatewayId, interfaceType: "rs485", unitId, baudRate, parity, pollIntervalMs, readOnly: true },
          },
        });
        return row;
      });

      return Response.json({ controller }, { status: 201 });
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
    const assetId = text(body.assetId, "El ATS");
    const meta = requestMetadata(request);

    const [current] = await db.select().from(assets).where(and(
      eq(assets.id, assetId),
      eq(assets.siteId, user.siteId),
      eq(assets.assetType, "ats"),
      eq(assets.active, true),
    )).limit(1);
    if (!current) throw new ApiError(404, "El ATS no existe en el sitio activo.");

    const metadata = current.metadata ?? {};
    const ats = metadata.ats && typeof metadata.ats === "object" && !Array.isArray(metadata.ats)
      ? metadata.ats as Record<string, unknown>
      : {};
    const currentConfig = parseAtsConfig(metadata);

    const source1Label = typeof body.source1Label === "string" && body.source1Label.trim() ? body.source1Label.trim() : currentConfig.source1Label;
    const source2Label = typeof body.source2Label === "string" && body.source2Label.trim() ? body.source2Label.trim() : currentConfig.source2Label;
    const expectedPosition = body.expectedPosition === null || body.expectedPosition === ""
      ? null
      : body.expectedPosition === "source1" || body.expectedPosition === "source2"
        ? body.expectedPosition
        : currentConfig.expectedPosition;

    const alarms = {
      staleAfterSeconds: integer(body.staleAfterSeconds, "staleAfterSeconds", currentConfig.staleAfterSeconds, 5, 86400),
      source1Required: boolean(body.source1Required, currentConfig.source1Required),
      source2Required: boolean(body.source2Required, currentConfig.source2Required),
      sourceUnavailableDelaySeconds: integer(body.sourceUnavailableDelaySeconds, "sourceUnavailableDelaySeconds", currentConfig.sourceUnavailableDelaySeconds, 0, 86400),
      commonAlarmDelaySeconds: integer(body.commonAlarmDelaySeconds, "commonAlarmDelaySeconds", currentConfig.commonAlarmDelaySeconds, 0, 86400),
      unexpectedPositionDelaySeconds: integer(body.unexpectedPositionDelaySeconds, "unexpectedPositionDelaySeconds", currentConfig.unexpectedPositionDelaySeconds, 0, 86400),
    };

    const [updated] = await db.update(assets).set({
      ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
      ...(typeof body.area === "string" ? { area: body.area.trim() || null } : {}),
      metadata: {
        ...metadata,
        ats: {
          ...ats,
          source1Label,
          source2Label,
          expectedPosition,
          readOnly: true,
          alarms,
        },
      },
      updatedAt: new Date(),
    }).where(eq(assets.id, assetId)).returning();

    await db.insert(auditLogs).values({
      siteId: user.siteId,
      actorUserId: user.id,
      action: "ats.asset.update",
      resourceType: "asset",
      resourceId: assetId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      before: current,
      after: updated,
    });

    return Response.json({ unit: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

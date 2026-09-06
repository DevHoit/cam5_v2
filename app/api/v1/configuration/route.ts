import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Cam5Database } from "../../../../db/index";
import {
  alarmEvents,
  alarmRules,
  alarmRuleStates,
  alarms,
  assets,
  auditLogs,
  channels,
  configurationSnapshots,
  deviceModels,
  devices,
  gateways,
  physicalInputs,
  readingProfileRanges,
  readingProfiles,
  registerDefinitions,
  sites,
  userAssetScopes,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

type ConfigurationSection = "asset" | "acquisition" | "channels";

function requiredText(value: unknown, label: string, minimum = 2) {
  if (typeof value !== "string" || value.trim().length < minimum) throw new ApiError(400, `${label} es obligatorio.`);
  return value.trim();
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown, label: string, minimum?: number, maximum?: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || (minimum !== undefined && parsed < minimum) || (maximum !== undefined && parsed > maximum)) {
    throw new ApiError(400, `${label} no es válido.`);
  }
  return parsed;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  const parsed = finiteNumber(value, label, minimum, maximum);
  if (!Number.isInteger(parsed)) throw new ApiError(400, `${label} debe ser un número entero.`);
  return parsed;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function assertAssetAccess(db: Cam5Database, user: Awaited<ReturnType<typeof requireApiSession>>["user"], assetId: string) {
  const [asset] = await db.select({ id: assets.id, siteId: assets.siteId }).from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.siteId, user.siteId)))
    .limit(1);
  if (!asset) throw new ApiError(404, "El punto de medición no existe en el sitio activo.");
  const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
  if (scopes.length && !scopes.some((scope) => scope.assetId === assetId)) throw new ApiError(403, "No tienes acceso al punto de medición indicado.");
  return asset;
}

async function snapshotPayload(db: Cam5Database, deviceId: string) {
  const [[device], ranges, channelRows] = await Promise.all([
    db.select({
      id: devices.id,
      assetId: devices.assetId,
      gatewayId: devices.gatewayId,
      readingProfileId: devices.readingProfileId,
      name: devices.name,
      host: devices.host,
      port: devices.port,
      unitId: devices.unitId,
      timeoutMs: devices.timeoutMs,
      retries: devices.retries,
      protocol: devices.protocol,
      registerConvention: devices.registerConvention,
      assetCode: assets.code,
      assetName: assets.name,
      assetArea: assets.area,
      nominalVoltageKv: assets.nominalVoltageKv,
    }).from(devices).innerJoin(assets, eq(assets.id, devices.assetId)).where(eq(devices.id, deviceId)).limit(1),
    db.select({
      id: readingProfileRanges.id,
      name: readingProfileRanges.name,
      startRegister: readingProfileRanges.startRegister,
      endRegister: readingProfileRanges.endRegister,
      functionCode: readingProfileRanges.functionCode,
      intervalMs: readingProfileRanges.intervalMs,
      priority: readingProfileRanges.priority,
      enabled: readingProfileRanges.enabled,
    }).from(readingProfileRanges)
      .innerJoin(devices, eq(devices.readingProfileId, readingProfileRanges.profileId))
      .where(eq(devices.id, deviceId))
      .orderBy(readingProfileRanges.priority),
    db.select({
      id: channels.id,
      code: channels.code,
      enabled: channels.enabled,
      warningThreshold: alarmRules.warningThreshold,
      criticalThreshold: alarmRules.criticalThreshold,
      hysteresis: alarmRules.hysteresis,
      activationSamples: alarmRules.activationSamples,
      recoverySamples: alarmRules.recoverySamples,
      staleAfterSeconds: alarmRules.staleAfterSeconds,
    }).from(channels).leftJoin(alarmRules, eq(alarmRules.channelId, channels.id))
      .where(eq(channels.deviceId, deviceId))
      .orderBy(channels.displayOrder),
  ]);
  if (!device) throw new ApiError(404, "El controlador no existe.");
  const [profile] = device.readingProfileId
    ? await db.select({
      id: readingProfiles.id,
      key: readingProfiles.key,
      name: readingProfiles.name,
      staleAfterSeconds: readingProfiles.staleAfterSeconds,
      rawRetentionDays: readingProfiles.rawRetentionDays,
      aggregateRetentionDays: readingProfiles.aggregateRetentionDays,
    }).from(readingProfiles).where(eq(readingProfiles.id, device.readingProfileId)).limit(1)
    : [];
  return {
    device,
    profile: profile ?? null,
    ranges,
    channels: channelRows.map((channel) => ({
      ...channel,
      warningThreshold: channel.warningThreshold === null ? null : Number(channel.warningThreshold),
      criticalThreshold: channel.criticalThreshold === null ? null : Number(channel.criticalThreshold),
      hysteresis: channel.hysteresis === null ? null : Number(channel.hysteresis),
    })),
  };
}

async function createSnapshot(db: Cam5Database, deviceId: string, userId: string, section: ConfigurationSection) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${deviceId}))`);
  const payload = await snapshotPayload(db, deviceId);
  const checksumSha256 = createHash("sha256").update(canonicalJson(payload)).digest("hex");
  const [latest] = await db.select({ version: configurationSnapshots.version }).from(configurationSnapshots)
    .where(eq(configurationSnapshots.deviceId, deviceId))
    .orderBy(desc(configurationSnapshots.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  await db.insert(configurationSnapshots).values({
    deviceId,
    kind: "manual",
    version,
    checksumSha256,
    storageKey: `database://configuration/${deviceId}/${version}`,
    metadata: { section, payload },
    createdBy: userId,
  });
  return { version, checksumSha256 };
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.read");
    const assetId = request.nextUrl.searchParams.get("assetId") || "";
    if (!assetId) throw new ApiError(400, "Selecciona un punto de medición.");
    await assertAssetAccess(db, user, assetId);

    const [asset] = await db.select({
      id: assets.id,
      code: assets.code,
      name: assets.name,
      area: assets.area,
      nominalVoltageKv: assets.nominalVoltageKv,
      state: assets.state,
      active: assets.active,
      siteId: sites.id,
      siteCode: sites.code,
      siteName: sites.name,
      siteTimezone: sites.timezone,
    }).from(assets).innerJoin(sites, eq(sites.id, assets.siteId)).where(eq(assets.id, assetId)).limit(1);
    if (!asset) throw new ApiError(404, "El punto de medición no existe.");

    const [controller] = await db.select({
      id: devices.id,
      code: devices.code,
      name: devices.name,
      serialNumber: devices.serialNumber,
      firmwareVersion: devices.firmwareVersion,
      dataVersion: devices.dataVersion,
      state: devices.state,
      active: devices.active,
      protocol: devices.protocol,
      host: devices.host,
      port: devices.port,
      unitId: devices.unitId,
      timeoutMs: devices.timeoutMs,
      retries: devices.retries,
      registerConvention: devices.registerConvention,
      lastReadAt: devices.lastReadAt,
      updatedAt: devices.updatedAt,
      modelId: deviceModels.id,
      modelCode: deviceModels.code,
      modelName: deviceModels.name,
      registerMapVersion: deviceModels.registerMapVersion,
      profileId: readingProfiles.id,
      profileKey: readingProfiles.key,
      profileName: readingProfiles.name,
      profileDescription: readingProfiles.description,
      staleAfterSeconds: readingProfiles.staleAfterSeconds,
      rawRetentionDays: readingProfiles.rawRetentionDays,
      aggregateRetentionDays: readingProfiles.aggregateRetentionDays,
      gatewayId: gateways.id,
      gatewayCode: gateways.code,
      gatewayName: gateways.name,
      gatewayIpAddress: gateways.ipAddress,
      gatewayState: gateways.state,
      gatewayLastSeenAt: gateways.lastSeenAt,
    }).from(devices)
      .innerJoin(deviceModels, eq(deviceModels.id, devices.modelId))
      .innerJoin(gateways, eq(gateways.id, devices.gatewayId))
      .leftJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
      .where(and(eq(devices.assetId, assetId), eq(devices.active, true)))
      .orderBy(devices.createdAt)
      .limit(1);

    const siteGateways = await db.select({
      id: gateways.id,
      code: gateways.code,
      name: gateways.name,
      state: gateways.state,
      active: gateways.active,
      ipAddress: gateways.ipAddress,
      lastSeenAt: gateways.lastSeenAt,
    }).from(gateways).where(and(eq(gateways.siteId, asset.siteId), eq(gateways.active, true))).orderBy(gateways.code);

    const ranges = controller?.profileId
      ? await db.select({
        id: readingProfileRanges.id,
        name: readingProfileRanges.name,
        startRegister: readingProfileRanges.startRegister,
        endRegister: readingProfileRanges.endRegister,
        functionCode: readingProfileRanges.functionCode,
        intervalMs: readingProfileRanges.intervalMs,
        priority: readingProfileRanges.priority,
        enabled: readingProfileRanges.enabled,
      }).from(readingProfileRanges).where(eq(readingProfileRanges.profileId, controller.profileId)).orderBy(readingProfileRanges.priority)
      : [];

    const channelRows = controller ? await db.select({
      id: channels.id,
      code: channels.code,
      name: channels.name,
      zone: channels.zone,
      metric: channels.metric,
      unit: channels.unit,
      enabled: channels.enabled,
      displayOrder: channels.displayOrder,
      register: registerDefinitions.nativeRegister,
      reference: registerDefinitions.humanReference,
      warningThreshold: alarmRules.warningThreshold,
      criticalThreshold: alarmRules.criticalThreshold,
      hysteresis: alarmRules.hysteresis,
      activationSamples: alarmRules.activationSamples,
      recoverySamples: alarmRules.recoverySamples,
      staleAfterSeconds: alarmRules.staleAfterSeconds,
      ruleId: alarmRules.id,
    }).from(channels)
      .innerJoin(registerDefinitions, eq(registerDefinitions.id, channels.registerDefinitionId))
      .leftJoin(alarmRules, eq(alarmRules.channelId, channels.id))
      .where(eq(channels.deviceId, controller.id))
      .orderBy(channels.displayOrder) : [];

    const registers = controller ? await db.select({
      id: registerDefinitions.id,
      nativeRegister: registerDefinitions.nativeRegister,
      humanReference: registerDefinitions.humanReference,
      name: registerDefinitions.name,
      group: registerDefinitions.registerGroup,
      metric: registerDefinitions.metric,
      dataType: registerDefinitions.dataType,
      scaleFactor: registerDefinitions.scaleFactor,
      scaleNote: registerDefinitions.scaleNote,
      unit: registerDefinitions.unit,
      errorRawValue: registerDefinitions.errorRawValue,
      minimumValue: registerDefinitions.minimumValue,
      maximumValue: registerDefinitions.maximumValue,
      writable: registerDefinitions.writable,
    }).from(registerDefinitions).where(eq(registerDefinitions.modelId, controller.modelId)).orderBy(registerDefinitions.nativeRegister) : [];

    const snapshots = controller ? await db.select({
      id: configurationSnapshots.id,
      version: configurationSnapshots.version,
      kind: configurationSnapshots.kind,
      checksumSha256: configurationSnapshots.checksumSha256,
      metadata: configurationSnapshots.metadata,
      createdAt: configurationSnapshots.createdAt,
    }).from(configurationSnapshots).where(eq(configurationSnapshots.deviceId, controller.id)).orderBy(desc(configurationSnapshots.version)).limit(20) : [];

    const warnings: string[] = [];
    if (!controller) warnings.push("El punto no tiene un controlador CAM5 activo.");
    if (!siteGateways.length) warnings.push("El sitio no tiene un gateway activo.");
    if (controller && !controller.profileId) warnings.push("El controlador no tiene un perfil de lectura asignado.");
    if (controller && channelRows.every((channel) => !channel.enabled)) warnings.push("No hay canales habilitados para adquisición.");
    if (controller && !controller.gatewayLastSeenAt) warnings.push("El gateway todavía no ha reportado actividad.");
    const mapValid = registers.length === 105
      && registers[0]?.nativeRegister === 418
      && registers.at(-1)?.nativeRegister === 522
      && new Set(registers.map((register) => register.nativeRegister)).size === registers.length;
    if (controller && !mapValid) warnings.push("El catálogo Modbus no coincide con el mapa CAM5 R1.6 esperado.");

    return Response.json({
      asset: { ...asset, nominalVoltageKv: asset.nominalVoltageKv === null ? null : Number(asset.nominalVoltageKv) },
      controller: controller ? {
        ...controller,
        lastReadAt: controller.lastReadAt?.toISOString() ?? null,
        updatedAt: controller.updatedAt.toISOString(),
        gatewayLastSeenAt: controller.gatewayLastSeenAt?.toISOString() ?? null,
      } : null,
      gateways: siteGateways.map((gateway) => ({ ...gateway, lastSeenAt: gateway.lastSeenAt?.toISOString() ?? null })),
      profile: controller?.profileId ? {
        id: controller.profileId,
        key: controller.profileKey,
        name: controller.profileName,
        description: controller.profileDescription,
        staleAfterSeconds: controller.staleAfterSeconds,
        rawRetentionDays: controller.rawRetentionDays,
        aggregateRetentionDays: controller.aggregateRetentionDays,
        ranges,
      } : null,
      channels: channelRows.map((channel) => ({
        ...channel,
        warningThreshold: channel.warningThreshold === null ? null : Number(channel.warningThreshold),
        criticalThreshold: channel.criticalThreshold === null ? null : Number(channel.criticalThreshold),
        hysteresis: channel.hysteresis === null ? 0 : Number(channel.hysteresis),
      })),
      registers: registers.map((register) => ({
        ...register,
        scaleFactor: Number(register.scaleFactor),
        minimumValue: register.minimumValue === null ? null : Number(register.minimumValue),
        maximumValue: register.maximumValue === null ? null : Number(register.maximumValue),
      })),
      snapshots: snapshots.map((snapshot) => ({
        id: snapshot.id,
        version: snapshot.version,
        kind: snapshot.kind,
        checksumSha256: snapshot.checksumSha256,
        section: typeof snapshot.metadata === "object" && snapshot.metadata && "section" in snapshot.metadata ? String(snapshot.metadata.section) : "configuration",
        createdAt: snapshot.createdAt.toISOString(),
      })),
      validation: { valid: warnings.length === 0, warnings, mapValid },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.write");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron cambios.");
    const assetId = requiredText(body.assetId, "El punto de medición");
    const section = body.section as ConfigurationSection;
    if (!(section === "asset" || section === "acquisition" || section === "channels")) throw new ApiError(400, "La sección de configuración no es válida.");
    const asset = await assertAssetAccess(db, user, assetId);
    const metadata = requestMetadata(request);

    const [controller] = await db.select({ id: devices.id, profileId: devices.readingProfileId }).from(devices)
      .where(and(eq(devices.assetId, assetId), eq(devices.active, true)))
      .orderBy(devices.createdAt)
      .limit(1);

    let before: Record<string, unknown> = {};
    let after: Record<string, unknown> = {};
    let snapshot: { version: number; checksumSha256: string } | null = null;

    await db.transaction(async (tx) => {
      if (section === "asset") {
        const [current] = await tx.select().from(assets).where(eq(assets.id, assetId)).limit(1);
        if (!current) throw new ApiError(404, "El punto de medición no existe.");
        before = current;
        const name = requiredText(body.name, "El nombre");
        const area = optionalText(body.area);
        const nominalVoltageKv = body.nominalVoltageKv === null || body.nominalVoltageKv === ""
          ? null
          : String(finiteNumber(body.nominalVoltageKv, "La tensión nominal", 0.001, 1000));
        const [updated] = await tx.update(assets).set({ name, area, nominalVoltageKv, updatedAt: new Date() }).where(eq(assets.id, assetId)).returning();
        after = updated;
      } else if (section === "acquisition") {
        if (!controller) throw new ApiError(409, "El punto no tiene un controlador activo para configurar.");
        const [current] = await tx.select().from(devices).where(eq(devices.id, controller.id)).limit(1);
        if (!current) throw new ApiError(404, "El controlador no existe.");
        const gatewayId = requiredText(body.gatewayId, "El gateway");
        const [gateway] = await tx.select({ id: gateways.id }).from(gateways)
          .where(and(eq(gateways.id, gatewayId), eq(gateways.siteId, asset.siteId), eq(gateways.active, true)))
          .limit(1);
        if (!gateway) throw new ApiError(400, "El gateway no pertenece al sitio activo o está deshabilitado.");
        const name = requiredText(body.name, "El nombre del controlador");
        const host = requiredText(body.host, "La dirección del controlador");
        const port = integer(body.port, "El puerto", 1, 65_535);
        const unitId = integer(body.unitId, "El Unit ID", 0, 247);
        const timeoutMs = integer(body.timeoutMs, "El timeout", 100, 60_000);
        const retries = integer(body.retries, "Los reintentos", 0, 10);
        const rawRetentionDays = integer(body.rawRetentionDays, "La retención de datos crudos", 1, 3_650);
        const aggregateRetentionDays = integer(body.aggregateRetentionDays, "La retención de agregados", rawRetentionDays, 36_500);
        const staleAfterSeconds = integer(body.staleAfterSeconds, "El límite de dato atrasado", 1, 86_400);
        const ranges = Array.isArray(body.ranges) ? body.ranges : [];
        if (!controller.profileId || !ranges.length) throw new ApiError(400, "El perfil de lectura debe conservar al menos un rango.");
        const parsedRanges = ranges.map((item, index) => {
          if (!item || typeof item !== "object") throw new ApiError(400, `El rango ${index + 1} no es válido.`);
          const range = item as Record<string, unknown>;
          const id = requiredText(range.id, `El identificador del rango ${index + 1}`);
          const startRegister = integer(range.startRegister, `El inicio del rango ${index + 1}`, 0, 65_535);
          const endRegister = integer(range.endRegister, `El fin del rango ${index + 1}`, startRegister, 65_535);
          const intervalMs = integer(range.intervalMs, `El intervalo del rango ${index + 1}`, 500, 3_600_000);
          const functionCode = integer(range.functionCode, `La función del rango ${index + 1}`, 3, 4);
          if (!(functionCode === 3 || functionCode === 4)) throw new ApiError(400, `La función del rango ${index + 1} debe ser 03 o 04.`);
          return { id, startRegister, endRegister, intervalMs, functionCode, enabled: range.enabled !== false };
        });
        if (new Set(parsedRanges.map((range) => range.id)).size !== parsedRanges.length) throw new ApiError(400, "El perfil contiene rangos repetidos.");
        const existingRanges = await tx.select().from(readingProfileRanges).where(eq(readingProfileRanges.profileId, controller.profileId));
        if (existingRanges.length !== parsedRanges.length || parsedRanges.some((range) => !existingRanges.some((existing) => existing.id === range.id))) {
          throw new ApiError(400, "Los rangos recibidos no coinciden con el perfil configurado.");
        }
        before = { controller: current, ranges: existingRanges };
        let effectiveProfileId = controller.profileId;
        let effectiveRanges = parsedRanges;
        const [profileUsage] = await tx.select({ value: count() }).from(devices).where(eq(devices.readingProfileId, controller.profileId));
        if (Number(profileUsage.value) > 1) {
          const [sourceProfile] = await tx.select().from(readingProfiles).where(eq(readingProfiles.id, controller.profileId)).limit(1);
          if (!sourceProfile) throw new ApiError(409, "El perfil de lectura no existe.");
          const [privateProfile] = await tx.insert(readingProfiles).values({
            key: `${sourceProfile.key}-${current.code.toLowerCase()}-${Date.now().toString(36)}`.slice(0, 60),
            name: `${sourceProfile.name} · ${current.code}`.slice(0, 120),
            description: `Perfil dedicado del controlador ${current.code}.`,
            staleAfterSeconds: sourceProfile.staleAfterSeconds,
            rawRetentionDays: sourceProfile.rawRetentionDays,
            aggregateRetentionDays: sourceProfile.aggregateRetentionDays,
            enabled: true,
          }).returning();
          effectiveProfileId = privateProfile.id;
          const replacementIds = new Map<string, string>();
          for (const sourceRange of existingRanges) {
            const [privateRange] = await tx.insert(readingProfileRanges).values({
              profileId: privateProfile.id,
              name: sourceRange.name,
              startRegister: sourceRange.startRegister,
              endRegister: sourceRange.endRegister,
              functionCode: sourceRange.functionCode,
              intervalMs: sourceRange.intervalMs,
              priority: sourceRange.priority,
              enabled: sourceRange.enabled,
            }).returning();
            replacementIds.set(sourceRange.id, privateRange.id);
          }
          effectiveRanges = parsedRanges.map((range) => ({ ...range, id: replacementIds.get(range.id) ?? range.id }));
        }
        const [updated] = await tx.update(devices).set({ name, gatewayId, readingProfileId: effectiveProfileId, host, port, unitId, timeoutMs, retries, updatedAt: new Date() }).where(eq(devices.id, controller.id)).returning();
        await tx.update(readingProfiles).set({ staleAfterSeconds, rawRetentionDays, aggregateRetentionDays, updatedAt: new Date() }).where(eq(readingProfiles.id, effectiveProfileId));
        for (const range of effectiveRanges) {
          await tx.update(readingProfileRanges).set({ startRegister: range.startRegister, endRegister: range.endRegister, intervalMs: range.intervalMs, functionCode: range.functionCode, enabled: range.enabled }).where(and(eq(readingProfileRanges.id, range.id), eq(readingProfileRanges.profileId, effectiveProfileId)));
        }
        after = { controller: updated, profile: { id: effectiveProfileId, staleAfterSeconds, rawRetentionDays, aggregateRetentionDays }, ranges: effectiveRanges };
      } else {
        if (!controller) throw new ApiError(409, "El punto no tiene un controlador activo para configurar.");
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length || items.length > 50) throw new ApiError(400, "Envía entre 1 y 50 canales por actualización.");
        const ids = items.map((item, index) => requiredText(item && typeof item === "object" ? (item as Record<string, unknown>).id : null, `El canal ${index + 1}`));
        if (new Set(ids).size !== ids.length) throw new ApiError(400, "La actualización contiene canales repetidos.");
        const currentRows = await tx.select({
          id: channels.id,
          physicalInputId: channels.physicalInputId,
          enabled: channels.enabled,
          ruleId: alarmRules.id,
          ruleEnabled: alarmRules.enabled,
          warningThreshold: alarmRules.warningThreshold,
          criticalThreshold: alarmRules.criticalThreshold,
          hysteresis: alarmRules.hysteresis,
          activationSamples: alarmRules.activationSamples,
          recoverySamples: alarmRules.recoverySamples,
          staleAfterSeconds: alarmRules.staleAfterSeconds,
        }).from(channels).leftJoin(alarmRules, eq(alarmRules.channelId, channels.id))
          .where(and(eq(channels.deviceId, controller.id), inArray(channels.id, ids)));
        if (currentRows.length !== ids.length || currentRows.some((row) => !row.ruleId)) throw new ApiError(400, "Uno o más canales no pertenecen al controlador o no tienen regla de alarma.");
        before = { channels: currentRows };
        const updatedItems: Array<Record<string, unknown>> = [];
        const affectedInputIds = new Set<string>();
        for (const item of items) {
          const update = item as Record<string, unknown>;
          const id = requiredText(update.id, "El canal");
          const enabled = update.enabled === true;
          const warningThreshold = finiteNumber(update.warningThreshold, "El umbral de advertencia");
          const criticalThreshold = finiteNumber(update.criticalThreshold, "El umbral crítico");
          const hysteresis = finiteNumber(update.hysteresis, "La histéresis", 0);
          const activationSamples = integer(update.activationSamples, "Las muestras de activación", 1, 100);
          const recoverySamples = integer(update.recoverySamples, "Las muestras de recuperación", 1, 100);
          const staleAfterSeconds = integer(update.staleAfterSeconds, "El tiempo de dato atrasado", 1, 86_400);
          if (warningThreshold >= criticalThreshold) throw new ApiError(400, "El umbral de advertencia debe ser menor que el crítico.");
          const current = currentRows.find((row) => row.id === id)!;
          await tx.update(channels).set({ enabled, updatedAt: new Date() }).where(eq(channels.id, id));
          if (current.physicalInputId) affectedInputIds.add(current.physicalInputId);
          await tx.update(alarmRules).set({
            enabled,
            warningThreshold: String(warningThreshold),
            criticalThreshold: String(criticalThreshold),
            hysteresis: String(hysteresis),
            activationSamples,
            recoverySamples,
            staleAfterSeconds,
            updatedBy: user.id,
            updatedAt: new Date(),
          }).where(eq(alarmRules.channelId, id));
          if (!enabled && current.ruleId) {
            const [state] = await tx.select({ activeAlarmId: alarmRuleStates.activeAlarmId }).from(alarmRuleStates).where(eq(alarmRuleStates.ruleId, current.ruleId)).limit(1);
            if (state?.activeAlarmId) {
              const [activeAlarm] = await tx.select({ status: alarms.status }).from(alarms).where(eq(alarms.id, state.activeAlarmId)).limit(1);
              if (activeAlarm && activeAlarm.status !== "closed" && activeAlarm.status !== "resolved") {
                await tx.update(alarms).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: user.id }).where(eq(alarms.id, state.activeAlarmId));
                await tx.insert(alarmEvents).values({ alarmId: state.activeAlarmId, eventType: "resolved_channel_disabled", actorUserId: user.id, note: "Canal desactivado por configuración." });
              }
            }
            await tx.insert(alarmRuleStates).values({ ruleId: current.ruleId, activeAlarmId: null, currentSeverity: "normal", breachCount: 0, recoveryCount: 0, updatedAt: new Date() })
              .onConflictDoUpdate({ target: alarmRuleStates.ruleId, set: { activeAlarmId: null, currentSeverity: "normal", breachCount: 0, recoveryCount: 0, updatedAt: new Date() } });
          }
          updatedItems.push({ id, enabled, warningThreshold, criticalThreshold, hysteresis, activationSamples, recoverySamples, staleAfterSeconds });
        }
        for (const physicalInputId of affectedInputIds) {
          const [enabledChannels] = await tx.select({ value: count() }).from(channels).where(and(eq(channels.physicalInputId, physicalInputId), eq(channels.enabled, true)));
          await tx.update(physicalInputs).set({ enabled: Number(enabledChannels.value) > 0, updatedAt: new Date() }).where(eq(physicalInputs.id, physicalInputId));
        }
        after = { channels: updatedItems };
      }

      await tx.insert(auditLogs).values({
        siteId: asset.siteId,
        actorUserId: user.id,
        action: `configuration.${section}.update`,
        resourceType: section === "asset" ? "asset" : section === "channels" ? "channel_configuration" : "device_configuration",
        resourceId: section === "asset" ? assetId : controller?.id ?? assetId,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before,
        after,
      });
      if (controller) snapshot = await createSnapshot(tx as unknown as Cam5Database, controller.id, user.id, section);
    });

    return Response.json({ ok: true, snapshot }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

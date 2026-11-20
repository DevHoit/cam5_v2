import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { Cam5Executor } from "./cam5-provisioning";
import { alarmRules, channels, detectedDevices, deviceModels, devices, readingProfiles, registerDefinitions } from "./schema";

export class MeasurementProvisioningError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** Perfil de lectura por protocolo: define cada cuánto se guarda y cuándo se alarma por falta de datos. */
const PROFILE_BY_PROTOCOL: Record<string, string> = { ble: "ble-beacon-v1" };

export function deviceCodeFor(externalId: string, prefix = "BLE") {
  const compact = externalId.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `${prefix}-${compact.slice(-6) || compact}`.slice(0, 60);
}

/**
 * Da de alta un equipo que entrega mediciones decodificadas (p. ej. un beacon BLE) a partir de su
 * plantilla: un canal habilitado por cada clave del modelo y una regla de alarma sin umbrales para
 * que el administrador los defina. Si venía de la bandeja de detectados, lo retira de ella.
 */
export async function provisionMeasurementDevice(tx: Cam5Executor, input: {
  gatewayId: string;
  assetId: string;
  modelId: string;
  externalId: string;
  name: string;
  code?: string;
}) {
  const [model] = await tx.select({ id: deviceModels.id, protocol: deviceModels.protocol }).from(deviceModels).where(eq(deviceModels.id, input.modelId)).limit(1);
  if (!model) throw new MeasurementProvisioningError(404, "La plantilla de equipo no existe.");
  if (model.protocol === "modbus_tcp") throw new MeasurementProvisioningError(400, "Esa plantilla es de un controlador Modbus; agrégalo desde Controladores.");

  // Primero las mediciones del proceso y al final las del propio equipo (batería, señal).
  const definitions = (await tx.select().from(registerDefinitions)
    .where(and(eq(registerDefinitions.modelId, model.id), isNotNull(registerDefinitions.sourceKey)))
    .orderBy(asc(registerDefinitions.name)))
    .sort((a, b) => Number(a.registerGroup === "Equipo") - Number(b.registerGroup === "Equipo"));
  if (!definitions.length) throw new MeasurementProvisioningError(409, "La plantilla no tiene mediciones definidas.");

  const [existing] = await tx.select({ code: devices.code }).from(devices)
    .where(and(eq(devices.gatewayId, input.gatewayId), eq(devices.externalId, input.externalId))).limit(1);
  if (existing) throw new MeasurementProvisioningError(409, `El equipo ${input.externalId} ya está asignado como ${existing.code}.`);

  const code = (input.code?.trim() || deviceCodeFor(input.externalId)).toUpperCase().slice(0, 60);
  const [sameCode] = await tx.select({ id: devices.id }).from(devices).where(and(eq(devices.gatewayId, input.gatewayId), eq(devices.code, code))).limit(1);
  if (sameCode) throw new MeasurementProvisioningError(409, `El código ${code} ya está en uso en este gateway.`);

  const profileKey = PROFILE_BY_PROTOCOL[model.protocol];
  const [profile] = profileKey ? await tx.select({ id: readingProfiles.id }).from(readingProfiles).where(eq(readingProfiles.key, profileKey)).limit(1) : [];

  const [device] = await tx.insert(devices).values({
    assetId: input.assetId,
    gatewayId: input.gatewayId,
    modelId: model.id,
    readingProfileId: profile?.id ?? null,
    code,
    name: input.name.trim().slice(0, 160),
    externalId: input.externalId,
    protocol: model.protocol,
    // La dirección del equipo en su protocolo: para BLE, la MAC.
    host: input.externalId,
    state: "commissioning",
  }).returning();

  const codes = new Map<string, number>();
  for (const definition of definitions) codes.set(definition.humanReference, (codes.get(definition.humanReference) ?? 0) + 1);
  const created = await tx.insert(channels).values(definitions.map((definition, index) => ({
    deviceId: device.id,
    assetId: input.assetId,
    registerDefinitionId: definition.id,
    // Código corto que define la plantilla (TEMP, HR, BAT…); si se repitiera, la clave de origen.
    code: (codes.get(definition.humanReference) === 1 ? definition.humanReference : definition.sourceKey!).toUpperCase().slice(0, 40),
    name: definition.name,
    zone: input.name.trim().slice(0, 160),
    metric: definition.metric,
    unit: definition.unit,
    enabled: true,
    displayOrder: index,
    metadata: { sourceKey: definition.sourceKey },
  }))).returning({ id: channels.id });
  await tx.insert(alarmRules).values(created.map((channel) => ({ channelId: channel.id, enabled: true }))).onConflictDoNothing();
  await tx.delete(detectedDevices).where(and(eq(detectedDevices.gatewayId, input.gatewayId), eq(detectedDevices.externalId, input.externalId)));
  return { device, channels: created.length };
}

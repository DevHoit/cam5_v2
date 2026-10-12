import { and, eq } from "drizzle-orm";
import type { Cam5Database } from "./index";
import * as s from "./schema";

export class SensorError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type SensorActor = { id: string; siteId: string; permissions: string[] };
export { sensorInstalled, sensorName } from "./sensor-contract";
export async function sensorAssetScope(db: Cam5Database, actor: SensorActor, assetId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) throw new SensorError(400, "Selecciona un activo válido.");
  const [asset] = await db.select().from(s.assets).where(and(eq(s.assets.id, assetId), eq(s.assets.siteId, actor.siteId), eq(s.assets.active, true)));
  if (!asset) throw new SensorError(404, "Activo no disponible.");
  const scopes = await db.select().from(s.userAssetScopes).where(eq(s.userAssetScopes.userId, actor.id));
  if (scopes.length && !scopes.some((scope) => scope.assetId === assetId)) throw new SensorError(403, "No tienes acceso a este activo.");
}
export async function sensorCatalog(db: Cam5Database, actor: SensorActor, assetId: string) {
  await sensorAssetScope(db, actor, assetId);
  return db.select({ metric: s.deviceMetrics, device: s.devices, definition: s.metricDefinitions, latest: s.latestMetricReadings })
    .from(s.deviceMetrics).innerJoin(s.devices, eq(s.devices.id, s.deviceMetrics.deviceId))
    .innerJoin(s.metricDefinitions, eq(s.metricDefinitions.id, s.deviceMetrics.metricDefinitionId))
    .leftJoin(s.latestMetricReadings, eq(s.latestMetricReadings.deviceMetricId, s.deviceMetrics.id))
    .where(and(eq(s.devices.assetId, assetId), eq(s.devices.active, true)))
    .orderBy(s.devices.code, s.deviceMetrics.displayOrder, s.deviceMetrics.code);
}
export async function saveSensors(db: Cam5Database, actor: SensorActor, body: Record<string, unknown>) {
  if (!actor.permissions.includes("settings.write")) throw new SensorError(403, "No tienes permiso para configurar sensores.");
  if (typeof body.assetId !== "string" || typeof body.deviceId !== "string" || !Array.isArray(body.sensors)) throw new SensorError(400, "Configuración inválida.");
  await sensorAssetScope(db, actor, body.assetId);
  const deviceId = body.deviceId;
  return db.transaction(async (tx) => {
    const [device] = await tx.select().from(s.devices).where(and(eq(s.devices.id, deviceId), eq(s.devices.assetId, body.assetId as string), eq(s.devices.active, true))).for("update");
    if (!device) throw new SensorError(404, "Equipo no disponible.");
    if (body.updatedAt !== device.updatedAt.toISOString()) throw new SensorError(409, "La configuración cambió. Actualiza antes de guardar.");
    const metrics = await tx.select().from(s.deviceMetrics).where(eq(s.deviceMetrics.deviceId, deviceId));
    const inputs = body.sensors as Array<{ id: string; installed: boolean; alias: string }>;
    if (inputs.length !== metrics.length || new Set(inputs.map((m) => m?.id)).size !== metrics.length || inputs.some((m) => !m || !metrics.some((r) => r.id === m.id) || typeof m.installed !== "boolean" || typeof m.alias !== "string" || m.alias.trim().length > 120)) throw new SensorError(400, "Revisa la lista completa de sensores y sus nombres (máximo 120 caracteres).");
    // Never silently retire alarms or leave an active rule attached to an excluded sensor.
    const enabledRules = await tx.select().from(s.rules).where(and(eq(s.rules.siteId, actor.siteId), eq(s.rules.enabled, true)));
    const definitions = await tx.select().from(s.metricDefinitions);
    const removedKeys = inputs.filter((m) => !m.installed).map((m) => definitions.find((d) => d.id === metrics.find((r) => r.id === m.id)!.metricDefinitionId)?.key).filter(Boolean) as string[];
    if (enabledRules.some((rule) => (rule.scopeType !== "device" || rule.scopeId === deviceId) && removedKeys.some((key) => JSON.stringify(rule.expression).includes(JSON.stringify(key))))) throw new SensorError(409, "Desactiva primero las reglas habilitadas que usan los sensores que deseas excluir.");
    const now = new Date();
    for (const input of inputs) {
      const metric = metrics.find((m) => m.id === input.id)!;
      await tx.update(s.deviceMetrics).set({ metadata: { ...metric.metadata, installation: input.installed ? "installed" : "excluded", sensorAlias: input.alias.trim() }, updatedAt: now }).where(eq(s.deviceMetrics.id, input.id));
    }
    await tx.update(s.devices).set({ metadata: { ...device.metadata, sensorConfiguration: 1 }, updatedAt: now }).where(eq(s.devices.id, deviceId));
    await tx.insert(s.auditLogs).values({ siteId: actor.siteId, actorUserId: actor.id, action: "sensors.configure", resourceType: "device", resourceId: deviceId, before: { sensors: metrics.map((m) => ({ id: m.id, metadata: m.metadata })) }, after: { sensors: inputs } });
    return { updatedAt: now.toISOString() };
  });
}

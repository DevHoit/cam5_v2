import { and, count, eq, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { pathToFileURL } from "node:url";
import { closeDb, getDb, type Cam5Database } from "./index";
import { loadDatabaseEnvironment } from "./load-env";
import {
  alarmEvents, alarmRuleStates, alarmRules, alarms, assets, auditLogs, channels, clients, detectedDevices, deviceRegisterSamples,
  devices, gateways, ingestionBatches, latestReadings, notificationDeliveries, physicalInputs, pointRangeStates, readingAggregates,
  readings, reportRuns, sites, workOrderAlarms, workOrders,
} from "./schema";

/**
 * Borrón del historial operativo de uno o más sitios: lecturas, tendencias, alertas, órdenes de trabajo,
 * notificaciones enviadas, informes generados y equipos detectados. La configuración (puntos, equipos,
 * canales, umbrales, gateways, usuarios, programación de informes y notificaciones) y la auditoría se conservan.
 * Pensado para dejar un sitio en cero al pasar de datos simulados a equipos reales.
 */
export type ResetCounts = Record<string, number>;

export async function resetOperationalData(db: Cam5Database, siteIds: string[], options: { apply: boolean; note?: string }) {
  if (!siteIds.length) throw new Error("Debes indicar al menos un sitio.");
  const siteAssets = db.select({ id: assets.id }).from(assets).where(inArray(assets.siteId, siteIds));
  const siteChannels = db.select({ id: channels.id }).from(channels).where(inArray(channels.assetId, siteAssets));
  const siteDevices = db.select({ id: devices.id }).from(devices).where(inArray(devices.assetId, siteAssets));
  const siteGateways = db.select({ id: gateways.id }).from(gateways).where(inArray(gateways.siteId, siteIds));
  const siteAlarms = db.select({ id: alarms.id }).from(alarms).where(inArray(alarms.siteId, siteIds));
  const siteRules = db.select({ id: alarmRules.id }).from(alarmRules).where(inArray(alarmRules.channelId, siteChannels));
  const siteBatches = db.select({ id: ingestionBatches.id }).from(ingestionBatches)
    .where(or(inArray(ingestionBatches.gatewayId, siteGateways), inArray(ingestionBatches.deviceId, siteDevices)));

  // Orden de borrado: primero lo que referencia (restrict) a lo que se borra después.
  const steps: Array<{ label: string; table: PgTable; where: SQL | undefined }> = [
    { label: "Notificaciones enviadas", table: notificationDeliveries, where: inArray(notificationDeliveries.alarmId, siteAlarms) },
    { label: "Alertas en órdenes de trabajo", table: workOrderAlarms, where: inArray(workOrderAlarms.alarmId, siteAlarms) },
    { label: "Órdenes de trabajo", table: workOrders, where: inArray(workOrders.siteId, siteIds) },
    { label: "Estado de reglas de alerta", table: alarmRuleStates, where: inArray(alarmRuleStates.ruleId, siteRules) },
    { label: "Estado de rangos por punto", table: pointRangeStates, where: inArray(pointRangeStates.assetId, siteAssets) },
    { label: "Eventos de alertas", table: alarmEvents, where: inArray(alarmEvents.alarmId, siteAlarms) },
    { label: "Alertas", table: alarms, where: inArray(alarms.siteId, siteIds) },
    { label: "Últimas lecturas", table: latestReadings, where: inArray(latestReadings.channelId, siteChannels) },
    { label: "Tendencias (agregados)", table: readingAggregates, where: inArray(readingAggregates.channelId, siteChannels) },
    { label: "Lecturas", table: readings, where: inArray(readings.channelId, siteChannels) },
    { label: "Registros crudos", table: deviceRegisterSamples, where: or(inArray(deviceRegisterSamples.deviceId, siteDevices), inArray(deviceRegisterSamples.batchId, siteBatches)) },
    { label: "Lotes recibidos", table: ingestionBatches, where: or(inArray(ingestionBatches.gatewayId, siteGateways), inArray(ingestionBatches.deviceId, siteDevices)) },
    { label: "Informes generados", table: reportRuns, where: inArray(reportRuns.siteId, siteIds) },
    { label: "Equipos detectados", table: detectedDevices, where: inArray(detectedDevices.gatewayId, siteGateways) },
  ];

  const run = async (tx: Cam5Database) => {
    const counts: ResetCounts = {};
    for (const step of steps) {
      const [row] = await tx.select({ value: count() }).from(step.table).where(step.where);
      counts[step.label] = Number(row?.value ?? 0);
      if (options.apply && counts[step.label] > 0) await tx.delete(step.table).where(step.where);
    }
    if (options.apply) {
      // Estado en vivo derivado de los datos borrados: los puntos vuelven a "sin datos" hasta la primera lectura real.
      await tx.update(devices).set({ lastReadAt: null, clockOffsetMs: null, updatedAt: new Date() }).where(inArray(devices.assetId, siteAssets));
      await tx.update(physicalInputs).set({ signalStrength: null, humidityIndex: null }).where(inArray(physicalInputs.deviceId, siteDevices));
      await tx.update(assets).set({ state: "offline", updatedAt: new Date() })
        .where(and(inArray(assets.siteId, siteIds), inArray(assets.state, ["normal", "warning", "critical"])));
      await tx.insert(auditLogs).values(siteIds.map((siteId) => ({
        siteId, action: "site.operational_data_reset", resourceType: "site", resourceId: siteId,
        metadata: { counts, note: options.note ?? null, source: "db/reset-operational-data.ts" },
      })));
    }
    return counts;
  };
  return options.apply ? db.transaction((tx) => run(tx as unknown as Cam5Database)) : run(db);
}

/** Sitios por código o nombre (sin distinguir mayúsculas), o todos los sitios de un cliente. */
export async function findSites(db: Cam5Database, query: { site?: string; client?: string }) {
  const filters: SQL[] = [];
  if (query.site) filters.push(or(eq(sql`upper(${sites.code})`, query.site.trim().toUpperCase()), ilike(sites.name, query.site.trim()))!);
  if (query.client) filters.push(or(eq(sql`upper(${clients.name})`, query.client.trim().toUpperCase()), ilike(clients.name, query.client.trim()))!);
  return db.select({ id: sites.id, code: sites.code, name: sites.name, client: clients.name })
    .from(sites).innerJoin(clients, eq(clients.id, sites.clientId))
    .where(filters.length ? and(...filters) : isNotNull(sites.id))
    .orderBy(clients.name, sites.name);
}

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  loadDatabaseEnvironment();
  const site = argValue("--site");
  const client = argValue("--client");
  const apply = process.argv.includes("--apply");
  const confirm = argValue("--confirm");
  const db = getDb();
  (async () => {
    const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return "?"; } })();
    console.log(`Base de datos: ${host}`);
    const matches = await findSites(db, { site, client });
    if (!site && !client) {
      console.log("Indica --site <código o nombre> o --client <nombre>. Sitios disponibles:");
      for (const row of matches) console.log(`  ${row.client} / ${row.name}  (código ${row.code})`);
      return;
    }
    if (!matches.length) throw new Error("Ningún sitio coincide con el filtro.");
    console.log(`Sitios: ${matches.map((row) => `${row.client} / ${row.name}`).join(", ")}`);
    if (apply && confirm !== String(matches.length)) {
      throw new Error(`Para borrar, agrega --confirm ${matches.length} (cantidad de sitios afectados).`);
    }
    const counts = await resetOperationalData(db, matches.map((row) => row.id), { apply, note: argValue("--note") });
    for (const [label, value] of Object.entries(counts)) console.log(`  ${label.padEnd(30)} ${value.toLocaleString("es-CL")}`);
    console.log(apply ? "Historial borrado. La configuración se conservó." : "Simulación: no se borró nada. Agrega --apply --confirm N para borrar.");
  })()
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
    .finally(closeDb);
}


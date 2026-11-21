import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { loadClientOverview, summarizeSite } from "../db/client-overview";
import { ingestMeasurements, parseMeasurementPayload } from "../db/measurement-ingest";
import { provisionMeasurementDevice } from "../db/measurement-provisioning";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import type { SitePoint, SystemSummary } from "../db/site-overview";
import { createMigratedTestDatabase } from "./helpers/database";

const NOW = new Date("2026-11-21T03:30:00Z");

test("summarizes a site: worst status, demand of its meters and the most demanding cold room", () => {
  const point = (id: string, system: SitePoint["system"], status: SitePoint["status"], value: number | null, deviation: number | null = 0): SitePoint => ({
    id, code: id, name: id, area: null, type: system === "energy" ? "electrical_panel" : "cold_room", typeName: "", system, history: null, sensorsDetail: [], electrical: null, deviceCode: null, status, lastReadAt: "2026-11-21T03:29:00.000Z", openAlarms: 0, alarmSeverity: null,
    condition: value === null ? null : { status: deviation ? "out_of_range" : "in_range", value, deviation, unit: system === "energy" ? "kW" : "°C", decimals: 1, quantityName: null, decisivePosition: null, sensors: 1, reporting: 1, rangeMin: 0, rangeMax: 5, aggregation: "max", secondary: null },
    groups: { temperature: { value: null, unit: null, channelCode: null, channelName: null, severity: "normal" }, humidity: { value: null, unit: null, channelCode: null, channelName: null, severity: "normal" }, discharge: { value: null, unit: null, channelCode: null, channelName: null, severity: "normal" } },
  });
  const systems: SystemSummary[] = [{ system: "cold", name: "Frío", points: 2, attention: 1, offline: 0 }, { system: "energy", name: "Energía", points: 2, attention: 0, offline: 1 }];
  const summary = summarizeSite({ id: "s", code: "S", name: "Casino" }, [
    point("CF-01", "cold", "warning", 7.4, 2.4), point("CF-02", "cold", "normal", 3.1), point("TG", "energy", "normal", 250.4), point("TC", "energy", "offline", 18),
  ], systems, [{ pointId: "CF-01", pointName: "CF-01", system: "cold", severity: "warning", reason: "out_of_range", detail: "" }, { pointId: "TG", pointName: "TG", system: "energy", severity: "warning", reason: "low_power_factor", detail: "" }], 2);
  assert.equal(summary.status, "warning");
  // CF-01 fuera de rango y TG con factor de potencia bajo cuentan como observaciones; TC no entrega datos.
  assert.deepEqual([summary.total, summary.normal, summary.attention, summary.offline], [4, 1, 2, 1]);
  assert.equal(summary.demandKw, 250.4, "a meter without fresh data does not add to the demand");
  assert.deepEqual([summary.worstCold?.pointName, summary.worstCold?.outOfRange], ["CF-01", true]);
  assert.equal(summary.healthIssues, 2);
});

test("joins the sites of a client: points, attention and sites carry their site", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const [base] = await db.select().from(schema.sites).limit(1);
    const [infante, rancagua, other] = await db.insert(schema.sites).values([
      { clientId: base.clientId, code: "EMP-INF", name: "Empalme Infante", timezone: "America/Santiago" },
      { clientId: base.clientId, code: "EMP-RAN", name: "Empalme Rancagua", timezone: "America/Santiago" },
      { clientId: base.clientId, code: "OTRO", name: "Sitio sin acceso", timezone: "America/Santiago" },
    ]).returning();
    const [model] = await db.select().from(schema.deviceModels).where(eq(schema.deviceModels.code, "PM5330"));
    const meters = [{ site: infante, id: "PM5330-INF", kw: 251.2 }, { site: rancagua, id: "PM5330-RAN", kw: 86.4 }, { site: other, id: "PM5330-OTR", kw: 40 }];
    for (const [index, meter] of meters.entries()) {
      const [point] = await db.insert(schema.assets).values({ siteId: meter.site.id, code: `EMP-${index}`, name: meter.site.name, assetType: "electrical_panel", state: "normal" }).returning();
      const [gateway] = await db.insert(schema.gateways).values({ siteId: meter.site.id, code: `HOIT-EMU-${index}`, name: "Emulador" }).returning();
      await db.transaction((tx) => provisionMeasurementDevice(tx, { gatewayId: gateway.id, assetId: point.id, modelId: model.id, externalId: meter.id, name: meter.id, position: "Acometida" }));
      const payload = { gateway: gateway.code, sequence: 1, devices: [{ id: meter.id, ts: new Date(NOW.getTime() - 20_000).toISOString(), m: { p_kw: meter.kw, pf: meter.id === "PM5330-RAN" ? 0.88 : 0.96 } }] };
      await ingestMeasurements(db, { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: meter.site.id }, parseMeasurementPayload(payload, NOW), NOW);
    }

    const overview = await loadClientOverview(db, [infante.id, rancagua.id], [], NOW);
    assert.deepEqual(overview.sites.map((site) => site.name).sort(), ["Empalme Infante", "Empalme Rancagua"], "only the sites passed in");
    assert.equal(overview.points.length, 2);
    assert.ok(overview.points.every((point) => point.siteId === infante.id || point.siteId === rancagua.id));
    assert.equal(overview.systems.find((system) => system.system === "energy")?.points, 2);
    const ran = overview.sites.find((site) => site.id === rancagua.id)!;
    assert.equal(ran.demandKw, 86.4);
    // El factor de potencia bajo de Rancagua aparece en "Requiere atención" con su sitio, y su sitio queda con observaciones.
    const lowPf = overview.attention.find((item) => item.reason === "low_power_factor");
    assert.equal(lowPf?.siteName, "Empalme Rancagua");
    assert.equal(overview.sites[0].id, rancagua.id, "the site with observations comes first");
    assert.equal(overview.truncated, false);

    const inactive = await db.update(schema.sites).set({ active: false }).where(eq(schema.sites.id, infante.id)).returning();
    assert.equal(inactive.length, 1);
    assert.deepEqual((await loadClientOverview(db, [infante.id, rancagua.id], [], NOW)).sites.map((site) => site.name), ["Empalme Rancagua"], "inactive sites are left out");
  } finally {
    await client.close();
  }
});

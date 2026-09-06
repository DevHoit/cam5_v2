import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createReportRun, nextCronRun, type ReportSnapshot } from "../db/report-engine";
import { reportCsv, reportPdf } from "../db/report-export";
import { seedCam5Database } from "../db/seed";
import type { Cam5Database } from "../db/index";
import * as schema from "../db/schema";

const snapshot: ReportSnapshot = {
  generatedAt: "2026-08-11T12:00:00.000Z",
  generatedBy: "Administrador",
  template: { id: "template", key: "condition-summary", name: "Condición del activo", description: "Resumen técnico" },
  client: { code: "CLIENTE", name: "Cliente principal" },
  site: { code: "SITE", name: "Subestación Norte", timezone: "America/Santiago" },
  asset: { id: "asset", code: "MCC-01", name: "Alimentador Norte", area: "Sala eléctrica", nominalVoltageKv: 13.8 },
  period: { start: "2026-08-10T12:00:00.000Z", end: "2026-08-11T12:00:00.000Z" },
  summary: { condition: "warning", channelCount: 1, sampleCount: 2, validSampleCount: 2, qualityPercent: 100, alarmCount: 1, warningCount: 1, criticalCount: 0 },
  channels: [{ code: "T01", name: "Temperatura fase L1", zone: "Barras", unit: "°C", sampleCount: 2, validSampleCount: 2, minimum: 42, average: 43, maximum: 44, latest: 44, latestAt: "2026-08-11T11:59:00.000Z" }],
  alarms: [{ code: "ALM-001", title: "Temperatura elevada", severity: "warning", status: "open", openedAt: "2026-08-11T10:00:00.000Z", channelCode: "T01", triggerValue: 44, thresholdValue: 43 }],
};

test("calculates the next report run in the configured timezone", () => {
  const next = nextCronRun("0 8 * * 1", "America/Santiago", new Date("2026-08-11T12:00:00.000Z"));
  assert.equal(next.toISOString(), "2026-08-17T12:00:00.000Z");
});

test("exports report snapshots as CSV and valid PDF bytes", async () => {
  const csv = reportCsv(snapshot);
  assert.match(csv, /HOITLIVE CORE/);
  assert.match(csv, /T01/);
  assert.match(csv, /ALM-001/);
  const pdf = await reportPdf(snapshot);
  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  assert.ok(pdf.length > 1_000);
});

test("creates an immutable report snapshot from the operational database", async () => {
  const client = new PGlite();
  try {
    for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql", "0006_smiling_frightful_four.sql", "0007_big_frightful_four.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
      await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    }
    const database = drizzle(client, { schema }) as unknown as Cam5Database;
    await seedCam5Database(database, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Cam5-Prueba-2026", log: false });
    const [asset] = await database.select().from(schema.assets).limit(1);
    const [template] = await database.select().from(schema.reportTemplates).limit(1);
    const [user] = await database.select().from(schema.users).limit(1);
    const result = await createReportRun(database, { templateId: template.id, assetId: asset.id, requestedBy: user.id, generatedBy: user.displayName, periodStart: new Date("2026-08-10T00:00:00.000Z"), periodEnd: new Date("2026-08-11T00:00:00.000Z"), format: "pdf" });
    assert.equal(result.run.status, "completed");
    assert.deepEqual(result.run.payload, result.snapshot);
    assert.equal(result.snapshot.asset.code, "MCC-01");
    assert.ok(result.snapshot.channels.length > 0);
  } finally {
    await client.close();
  }
});

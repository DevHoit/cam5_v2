import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createSiteReportRun, nextSiteReportRun, processSiteReportSchedules, siteReportPdf } from "../db/site-report-output";
import { createMigratedTestDatabase } from "./helpers/database";

const environment = { RESEND_API_KEY: "re_test", REPORT_FROM_EMAIL: "informes@hoit.test", APP_URL: "https://core.example.test" };

test("next run is Monday or the 1st at the chosen hour in the site's timezone", () => {
  const after = new Date("2026-11-18T15:00:00Z"); // miércoles
  assert.equal(nextSiteReportRun("weekly", 8, "America/Santiago", after).toISOString(), "2026-11-23T11:00:00.000Z");
  assert.equal(nextSiteReportRun("monthly", 8, "America/Santiago", after).toISOString(), "2026-12-01T11:00:00.000Z");
});

test("a due schedule builds the previous period's report and emails it with the PDF; empty periods can be skipped", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { log: false });
    const [site] = await db.select().from(schema.sites).limit(1);
    const now = new Date("2026-11-23T11:05:00Z");

    const run = await createSiteReportRun(db, { siteId: site.id, kind: "weekly", periodStart: new Date("2026-11-16T03:00:00Z"), periodEnd: new Date("2026-11-23T03:00:00Z"), now });
    assert.equal(run.report.site.id, site.id);
    const [stored] = await db.select().from(schema.reportRuns).where(eq(schema.reportRuns.id, run.id));
    assert.equal(stored.siteId, site.id);
    assert.equal(stored.kind, "weekly");
    const pdf = await siteReportPdf(run.report);
    assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), "%PDF-");

    const [sendAll] = await db.insert(schema.siteReportSchedules).values({ siteId: site.id, kind: "weekly", hour: 8, recipients: [{ email: "jefe@saesa.test" }, { email: "operaciones@saesa.test" }], nextRunAt: new Date("2026-11-23T11:00:00Z") }).returning();
    const [onlyFindings] = await db.insert(schema.siteReportSchedules).values({ siteId: site.id, kind: "monthly", hour: 8, recipients: [{ email: "gerencia@saesa.test" }], onlyIfFindings: true, nextRunAt: new Date("2026-11-23T11:00:00Z") }).returning();

    const sent: Array<{ to: string[]; subject: string; attachments?: Array<{ filename: string; content: string }>; html: string }> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await processSiteReportSchedules(db, now, { environment, fetchImpl });
    assert.deepEqual(result, { due: 2, sent: 2, skipped: 0, failed: 0 }, "a month without data is itself a finding");
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].to, ["jefe@saesa.test", "operaciones@saesa.test"]);
    assert.match(sent[0].subject, /Semana del/);
    assert.equal(sent[0].attachments?.length, 1);
    assert.match(sent[0].attachments![0].filename, /\.pdf$/);
    assert.match(sent[0].html, /https:\/\/core\.example\.test\/\?view=reports&amp;report=/);

    const [afterSend] = await db.select().from(schema.siteReportSchedules).where(eq(schema.siteReportSchedules.id, sendAll.id));
    assert.equal(afterSend.lastStatus, "sent");
    assert.ok(afterSend.lastReportId);
    assert.equal(afterSend.nextRunAt?.toISOString(), "2026-11-30T11:00:00.000Z");
    // Sin puntos activos no hay nada que informar: con "solo si hay hallazgos" no se envía.
    await db.update(schema.assets).set({ active: false }).where(eq(schema.assets.siteId, site.id));
    await db.update(schema.siteReportSchedules).set({ nextRunAt: new Date("2026-12-01T11:00:00Z") }).where(eq(schema.siteReportSchedules.id, onlyFindings.id));
    await db.update(schema.siteReportSchedules).set({ nextRunAt: new Date("2026-12-07T11:00:00Z") }).where(eq(schema.siteReportSchedules.id, sendAll.id));
    const quiet = await processSiteReportSchedules(db, new Date("2026-12-01T11:01:00Z"), { environment, fetchImpl });
    assert.equal(quiet.skipped, 1);
    const [afterSkip] = await db.select().from(schema.siteReportSchedules).where(eq(schema.siteReportSchedules.id, onlyFindings.id));
    assert.equal(afterSkip.lastStatus, "skipped");
    assert.equal(sent.length, 2, "nothing new was emailed");
    await db.update(schema.assets).set({ active: true }).where(eq(schema.assets.siteId, site.id));

    // Un error del proveedor queda registrado y no detiene las demás.
    await db.update(schema.siteReportSchedules).set({ nextRunAt: new Date("2026-11-30T11:00:00Z") }).where(eq(schema.siteReportSchedules.id, sendAll.id));
    const failing = (async () => new Response(JSON.stringify({ message: "Dominio no verificado" }), { status: 403 })) as unknown as typeof fetch;
    const second = await processSiteReportSchedules(db, new Date("2026-11-30T11:01:00Z"), { environment, fetchImpl: failing });
    assert.equal(second.failed, 1);
    const [afterFail] = await db.select().from(schema.siteReportSchedules).where(eq(schema.siteReportSchedules.id, sendAll.id));
    assert.equal(afterFail.lastStatus, "failed");
    assert.match(afterFail.lastError ?? "", /Dominio no verificado/);
  } finally {
    await client.close();
  }
});

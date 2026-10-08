import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { Cam5Database } from "../db/index";
import * as s from "../db/schema";
import { activateLaboratoryEmail, assertLaboratoryEnvironment, closeLaboratoryEmail, preflightLaboratoryEmail, prepareLaboratoryEmail, processLaboratoryEmail } from "../db/laboratory-email";
import { evaluateGenericRules } from "../db/rule-engine";
import { cancelEscalationJobsForAlarm, enqueueEscalationJob } from "../db/escalation-engine";
import { processNotificationDelivery } from "../db/notification-engine";

const environment = { NODE_ENV: "test" as const, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature/hoit-core-v1", RESEND_API_KEY: "re_fake", NOTIFICATION_FROM_EMAIL: "alerts@example.test" };
async function fixture() {
  const client = new PGlite();
  const files = (await readdir(new URL("../drizzle/", import.meta.url))).filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 30).sort();
  for (const filename of files) await client.exec((await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8")).replaceAll("--> statement-breakpoint", ""));
  const db = drizzle(client, { schema: s }) as unknown as Cam5Database;
  const [customer] = await db.insert(s.clients).values({ code: "LAB", name: "Lab" }).returning();
  const [site] = await db.insert(s.sites).values({ clientId: customer.id, code: "E2E-STAGING", name: "Lab" }).returning();
  const [asset] = await db.insert(s.assets).values({ siteId: site.id, code: "E2E-PM-02", name: "PM Lab" }).returning();
  const [gateway] = await db.insert(s.gateways).values({ siteId: site.id, code: "GW-LAB", name: "Gateway lab" }).returning();
  const [device] = await db.insert(s.devices).values({ assetId: asset.id, code: "PM5560-E2E-02", name: "PM Lab", gatewayId: gateway.id }).returning();
  const [actor] = await db.insert(s.users).values({ email: "admin@example.test", displayName: "Admin", status: "active" }).returning();
  await db.insert(s.roles).values({ key: "viewer", name: "Viewer" }).onConflictDoNothing();
  const [endpoint] = await db.insert(s.notificationEndpoints).values({ siteId: site.id, kind: "email", name: "Lab email", configuration: { recipients: ["pruebas@hoitlive.com"] }, verifiedAt: new Date() }).returning();
  const [definition] = await db.select().from(s.metricDefinitions).where(eq(s.metricDefinitions.key, "electrical.voltage.l1_n"));
  const [metric] = await db.insert(s.deviceMetrics).values({ deviceId: device.id, metricDefinitionId: definition.id, code: "L1N", name: "L1-N" }).returning();
  const now = new Date();
  const run = await prepareLaboratoryEmail(db, site.id, actor.id, "pruebas@hoitlive.com", now);
  let sequence = 0;
  async function sample(value: number, at: Date) {
    sequence++;
    const [batch] = await db.insert(s.telemetryBatches).values({ gatewayId: gateway.id, deviceId: device.id, batchKey: `lab-${sequence}`, gatewayBootId: "lab", gatewaySequence: sequence, sentAt: at, sampledAt: at, metricCount: 1 }).returning();
    const [reading] = await db.insert(s.metricReadings).values({ batchId: batch.id, deviceMetricId: metric.id, recordedAt: at, valueNumeric: String(value), quality: "good" }).returning();
    const latest = { deviceMetricId: metric.id, readingId: reading.id, recordedAt: at, receivedAt: at, valueNumeric: String(value), quality: "good" as const };
    await db.insert(s.latestMetricReadings).values(latest).onConflictDoUpdate({ target: s.latestMetricReadings.deviceMetricId, set: latest });
  }
  const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
  return { client, db, run, site, actor, endpoint, sample, now, at };
}

test("laboratory dispatcher rejects production, development and other branches", () => {
  assert.doesNotThrow(() => assertLaboratoryEnvironment(environment));
  for (const values of [{ ...environment, VERCEL_ENV: "production" }, { ...environment, VERCEL_GIT_COMMIT_REF: "main" }, { NODE_ENV: "test" as const }]) assert.throws(() => assertLaboratoryEnvironment(values), /sólo/);
});

test("prepare and repeated dry runs never send, create login credentials or activate rules", async () => {
  const f = await fixture();
  try {
    const before = await f.db.select().from(s.notificationDeliveries);
    for (let i = 0; i < 2; i++) {
      const state = await preflightLaboratoryEmail(f.db, f.run, f.now);
      assert.equal(state.dispatchSkipped, true); assert.equal(state.activated, false); assert.equal(state.alarm, null);
    }
    assert.deepEqual(await f.db.select().from(s.notificationDeliveries), before);
    assert.deepEqual(await f.db.select().from(s.authIdentities).where(eq(s.authIdentities.userId, f.run.userId)), []);
    await assert.rejects(activateLaboratoryEmail(f.db, f.run, f.now), /lectura normal y vigente/);
    await assert.rejects(preflightLaboratoryEmail(f.db, f.run, f.at(1800)), /ventana/);
  } finally { await f.client.close(); }
});

test("fresh alarm sends at 0 and 300 seconds; ACK cancels 600-second job; recovery sends once; inherited queues unchanged", async () => {
  const f = await fixture();
  try {
    const [legacyAlarm] = await f.db.insert(s.alarms).values({ siteId: f.run.siteId, assetId: f.run.assetId, code: "LEGACY", kind: "threshold", severity: "critical", title: "Inherited", openedAt: f.at(-600), lastObservedAt: f.at(-600) }).returning();
    const [level] = await f.db.select().from(s.escalationLevels).where(eq(s.escalationLevels.policyId, f.run.policyId));
    await f.db.update(s.escalationPolicies).set({ enabled: true }).where(eq(s.escalationPolicies.id, f.run.policyId));
    await enqueueEscalationJob(f.db, { alarmId: legacyAlarm.id, policyId: f.run.policyId, levelId: level.id, dueAt: f.at(-300) });
    await f.db.insert(s.notificationDeliveries).values({ endpointId: f.run.endpointId, alarmId: legacyAlarm.id, subject: "Inherited queue", recipient: "unapproved@example.test", payload: {}, scheduledAt: f.at(-300), nextAttemptAt: f.at(-300) });
    const legacyJobs = await f.db.select().from(s.escalationJobs).where(eq(s.escalationJobs.alarmId, legacyAlarm.id));
    const legacyDeliveries = await f.db.select().from(s.notificationDeliveries).where(eq(s.notificationDeliveries.alarmId, legacyAlarm.id));
    await f.sample(230, f.now); await activateLaboratoryEmail(f.db, f.run, f.now);
    await f.sample(180, f.at(1)); await evaluateGenericRules(f.db, f.at(1), { siteId: f.site.id });
    await f.sample(180, f.at(61)); await evaluateGenericRules(f.db, f.at(61), { siteId: f.site.id });
    const [alarm] = await f.db.select().from(s.alarms).where(eq(s.alarms.genericRuleId, f.run.ruleId));
    assert.ok(alarm);
    const recipients: string[][] = [];
    const fetchImpl: typeof fetch = async (_input, init) => { recipients.push(JSON.parse(String(init?.body)).to); return Response.json({ id: `resend-${recipients.length}` }); };
    const process = (seconds: number) => processLaboratoryEmail(f.db, f.run, { now: f.at(seconds), environment, fetchImpl });
    await process(61); assert.equal(recipients.length, 1);
    await process(61); assert.equal(recipients.length, 1);
    await f.sample(180, f.at(360)); await process(360); assert.equal(recipients.length, 1); // T0 + 299
    await process(361); assert.equal(recipients.length, 2); // T0 + 300
    await f.db.update(s.alarms).set({ status: "acknowledged", acknowledgedAt: f.at(362) }).where(eq(s.alarms.id, alarm.id));
    await cancelEscalationJobsForAlarm(f.db, alarm.id, f.at(362));
    await f.sample(180, f.at(661)); await process(661); assert.equal(recipients.length, 2);
    await f.sample(230, f.at(662)); await evaluateGenericRules(f.db, f.at(662), { siteId: f.site.id });
    await process(662); await process(662); assert.equal(recipients.length, 3);
    assert.deepEqual(recipients, Array.from({ length: 3 }, () => ["pruebas@hoitlive.com"]));
    const jobs = await f.db.select().from(s.escalationJobs).where(eq(s.escalationJobs.alarmId, alarm.id));
    assert.equal(jobs.filter((job) => job.status === "completed").length, 2);
    assert.equal(jobs.filter((job) => job.status === "cancelled").length, 1);
    const deliveries = await f.db.select().from(s.notificationDeliveries).where(eq(s.notificationDeliveries.alarmId, alarm.id));
    assert.equal(deliveries.length, 3); assert.ok(deliveries.every((delivery) => delivery.status === "sent" && delivery.attemptCount === 1 && delivery.deliveredAt === null));
    assert.deepEqual(await f.db.select().from(s.escalationJobs).where(eq(s.escalationJobs.alarmId, legacyAlarm.id)), legacyJobs);
    assert.deepEqual(await f.db.select().from(s.notificationDeliveries).where(eq(s.notificationDeliveries.alarmId, legacyAlarm.id)), legacyDeliveries);
    await closeLaboratoryEmail(f.db, f.run);
    assert.equal((await f.db.select().from(s.rules).where(eq(s.rules.id, f.run.ruleId)))[0].enabled, false);
    await assert.rejects(preflightLaboratoryEmail(f.db, f.run, f.at(663)), /cerrado/);
    await assert.rejects(activateLaboratoryEmail(f.db, f.run, f.at(663)), /cerrado/);
  } finally { await f.client.close(); }
});

test("recipient or policy drift fails closed without contacting the provider", async () => {
  const f = await fixture();
  try {
    await f.db.update(s.users).set({ email: "foreign@example.test" }).where(eq(s.users.id, f.run.userId));
    let calls = 0;
    await assert.rejects(processLaboratoryEmail(f.db, f.run, { environment, now: f.now, fetchImpl: async () => { calls++; return Response.json({ id: "wrong" }); } }), /correo/);
    assert.equal(calls, 0);
    await f.db.update(s.users).set({ email: f.run.recipient }).where(eq(s.users.id, f.run.userId));
    const [level] = await f.db.select().from(s.escalationLevels).where(eq(s.escalationLevels.policyId, f.run.policyId));
    await f.db.update(s.escalationLevels).set({ recipientType: "role", recipientRef: "platform_admin" }).where(eq(s.escalationLevels.id, level.id));
    await assert.rejects(preflightLaboratoryEmail(f.db, f.run, f.now), /política/);
    await closeLaboratoryEmail(f.db, f.run); // closing still works after drift or expiration
  } finally { await f.client.close(); }
});

test("the final delivery guard rejects wrong recipients and future deliveries before claiming", async () => {
  const f = await fixture();
  try {
    const [alarm] = await f.db.insert(s.alarms).values({ siteId: f.run.siteId, assetId: f.run.assetId, code: "GUARD", kind: "threshold", severity: "critical", title: "Guard", openedAt: f.now, lastObservedAt: f.now }).returning();
    const [delivery] = await f.db.insert(s.notificationDeliveries).values({ endpointId: f.run.endpointId, alarmId: alarm.id, recipient: "unapproved@example.test", payload: {}, subject: "Must not send", scheduledAt: f.now, nextAttemptAt: f.now }).returning();
    let calls = 0;
    const options = { now: f.now, environment, laboratoryGuard: { alarmId: alarm.id, endpointId: f.run.endpointId, recipient: f.run.recipient, expiresAt: new Date(f.run.expiresAt) }, fetchImpl: async () => { calls++; return Response.json({ id: "wrong" }); } };
    await assert.rejects(processNotificationDelivery(f.db, delivery.id, options), /alcance autorizado/);
    await f.db.update(s.notificationDeliveries).set({ recipient: f.run.recipient, scheduledAt: f.at(300) }).where(eq(s.notificationDeliveries.id, delivery.id));
    await assert.rejects(processNotificationDelivery(f.db, delivery.id, options), /alcance autorizado/);
    assert.equal(calls, 0);
    assert.equal((await f.db.select().from(s.notificationDeliveries).where(eq(s.notificationDeliveries.id, delivery.id)))[0].status, "queued");
  } finally { await f.client.close(); }
});

test("endpoint ambiguity and expired windows prevent dispatch, while cleanup leaves unrelated deliveries intact", async () => {
  const f = await fixture();
  try {
    await f.db.insert(s.notificationEndpoints).values({ siteId: f.site.id, kind: "email", name: "Second route", configuration: { recipients: [f.run.recipient] }, verifiedAt: f.now });
    await assert.rejects(preflightLaboratoryEmail(f.db, f.run, f.now), /ambiguo/);
    let calls = 0;
    await assert.rejects(processLaboratoryEmail(f.db, f.run, { now: f.at(1801), environment, fetchImpl: async () => { calls++; return Response.json({ id: "wrong" }); } }), /ventana/);
    assert.equal(calls, 0);
    const [other] = await f.db.insert(s.notificationDeliveries).values({ endpointId: f.run.endpointId, subject: "Unrelated", payload: {}, recipient: "other@example.test", status: "sending", scheduledAt: f.at(-600), nextAttemptAt: f.at(-600) }).returning();
    await closeLaboratoryEmail(f.db, f.run);
    assert.deepEqual((await f.db.select().from(s.notificationDeliveries).where(eq(s.notificationDeliveries.id, other.id)))[0], other);
  } finally { await f.client.close(); }
});

test("authorized Gmail plus-address is preserved exactly when it matches the verified channel", async () => {
  const f = await fixture();
  try {
    await f.db.update(s.notificationEndpoints).set({ configuration: { recipients: ["emer.cl+3@gmail.com"] } }).where(eq(s.notificationEndpoints.id, f.endpoint.id));
    const run = await prepareLaboratoryEmail(f.db, f.site.id, f.actor.id, "emer.cl+3@gmail.com", f.now);
    const state = await preflightLaboratoryEmail(f.db, run, f.now);
    assert.equal(state.run.recipient, "emer.cl+3@gmail.com");
    await assert.rejects(prepareLaboratoryEmail(f.db, f.site.id, f.actor.id, "emer.cl@gmail.com", f.now), /fuera/);
  } finally { await f.client.close(); }
});

import { evaluateStaleCommunications } from "../db/alarm-engine";
import { randomUUID } from "node:crypto";
import { CAM5_METRICS, CAM5_LAB } from "../db/cam5";
import { handleSpecIngest } from "../app/api/v1/gateway/_lib/ingest-spec-v1";
import { buildSpecGatewayConfig } from "../app/api/v1/gateway/_lib/config-spec-v1";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { Cam5Database } from "../db/index";
import * as s from "../db/schema";
import { provisionLaboratoryCam5, activateLaboratoryEmail, assertLaboratoryEnvironment, closeLaboratoryEmail, preflightLaboratoryEmail, prepareLaboratoryEmail, processLaboratoryEmail } from "../db/laboratory-email";
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
  const [actor] = await db.insert(s.users).values({ email: "admin@example.test", displayName: "Admin", status: "active" }).returning();
  await db.insert(s.roles).values({ key: "viewer", name: "Viewer" }).onConflictDoNothing();
  const [endpoint] = await db.insert(s.notificationEndpoints).values({ siteId: site.id, kind: "email", name: "Lab email", configuration: { recipients: ["pruebas@hoitlive.com"] }, verifiedAt: new Date() }).returning();
  await provisionLaboratoryCam5(db, site.id, actor.id);
  const [device] = await db.select().from(s.devices).where(eq(s.devices.code, CAM5_LAB.deviceCode));
  const [gateway] = await db.select().from(s.gateways).where(eq(s.gateways.code, CAM5_LAB.gatewayCode));
  const now = new Date();
  const run = await prepareLaboratoryEmail(db, site.id, actor.id, "pruebas@hoitlive.com", now);
  let sequence = 0;
  const credential = { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id };
  async function sample(value: number, at: Date, quality = "GOOD") {
    sequence++;
    const metrics = Object.fromEntries(CAM5_METRICS.map((metric) => [metric.key, metric.code === "T01" ? value : metric.unit === "°C" ? 30 : metric.unit === "%RH" ? 50 : 10]));
    const payload = { schema_version: "1.0", gateway_id: gateway.code, boot_id: "cam5-lab", message_id: randomUUID(), sequence, created_at: at.toISOString(), time_quality: "SYNCED", samples: [{ device_id: device.code, sampled_at: at.toISOString(), quality, metrics }] };
    const response = await handleSpecIngest({ db, credential, rawPayload: payload, receivedAt: at });
    assert.equal(response.status, 202);
    return payload;
  }
  const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
  return { client, db, run, site, actor, endpoint, sample, now, at, credential, device };
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
    await f.sample(50, f.now); await activateLaboratoryEmail(f.db, f.run, f.now);
    await f.sample(90, f.at(1)); await evaluateGenericRules(f.db, f.at(1), { siteId: f.site.id });
    await f.sample(90, f.at(61)); await evaluateGenericRules(f.db, f.at(61), { siteId: f.site.id });
    const [alarm] = await f.db.select().from(s.alarms).where(eq(s.alarms.genericRuleId, f.run.ruleId));
    assert.ok(alarm);
    const recipients: string[][] = [];
    const fetchImpl: typeof fetch = async (_input, init) => { recipients.push(JSON.parse(String(init?.body)).to); return Response.json({ id: `resend-${recipients.length}` }); };
    const process = (seconds: number) => processLaboratoryEmail(f.db, f.run, { now: f.at(seconds), environment, fetchImpl });
    await process(61); assert.equal(recipients.length, 1);
    await process(61); assert.equal(recipients.length, 1);
    await f.sample(90, f.at(360)); await process(360); assert.equal(recipients.length, 1); // T0 + 299
    await process(361); assert.equal(recipients.length, 2); // T0 + 300
    await f.db.update(s.alarms).set({ status: "acknowledged", acknowledgedAt: f.at(362) }).where(eq(s.alarms.id, alarm.id));
    await cancelEscalationJobsForAlarm(f.db, alarm.id, f.at(362));
    await f.sample(90, f.at(661)); await process(661); assert.equal(recipients.length, 2);
    await f.sample(50, f.at(662)); await evaluateGenericRules(f.db, f.at(662), { siteId: f.site.id });
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


test("CAM5 normalized contract persists all 36 channels, replay is idempotent, and brief excursions do not alarm", async () => {
  const f = await fixture();
  try {
    const config = await buildSpecGatewayConfig(f.db, f.credential);
    assert.equal(config.devices[0].driver, "cam5");
    assert.equal(config.devices[0].transport.type, "virtual");
    const payload = await f.sample(50, f.now);
    const original = await f.db.select().from(s.metricReadings);
    assert.equal(original.length, 36);
    await handleSpecIngest({ db: f.db, credential: f.credential, rawPayload: payload, receivedAt: f.now });
    assert.deepEqual(await f.db.select().from(s.metricReadings), original);
    await activateLaboratoryEmail(f.db, f.run, f.now);
    await f.sample(90, f.at(1));
    await f.sample(90, f.at(59));
    assert.equal((await preflightLaboratoryEmail(f.db, f.run, f.at(59))).alarm, null);
    await f.sample(50, f.at(60));
    assert.equal((await preflightLaboratoryEmail(f.db, f.run, f.at(60))).alarm, null);
    await f.sample(90, f.at(61));
    await f.sample(90, f.at(121));
    assert.ok((await preflightLaboratoryEmail(f.db, f.run, f.at(121))).alarm);
    await f.sample(50, f.at(122), "INVALID");
    assert.equal((await preflightLaboratoryEmail(f.db, f.run, f.at(122))).telemetryFresh, false);
    await assert.rejects(processLaboratoryEmail(f.db, f.run, { now: f.at(122), environment }), /telemetría/);
    await f.sample(50, f.at(123));
    assert.equal((await preflightLaboratoryEmail(f.db, f.run, f.at(123))).alarm?.status, "resolved");
  } finally { await f.client.close(); }
});

test("CAM5 provisioning is idempotent, refuses foreign targets and creates no credentials", async () => {
  const f = await fixture();
  try {
    await provisionLaboratoryCam5(f.db, f.site.id, f.actor.id);
    assert.equal((await f.db.select().from(s.deviceMetrics).where(eq(s.deviceMetrics.deviceId, f.device.id))).length, 36);
    assert.equal((await f.db.select().from(s.gatewayApiCredentials)).length, 0);
    await f.db.update(s.devices).set({ metadata: {} }).where(eq(s.devices.id, f.device.id));
    await assert.rejects(provisionLaboratoryCam5(f.db, f.site.id, f.actor.id), /no pertenece/);
    await assert.rejects(preflightLaboratoryEmail(f.db, f.run, f.now), /CAM5/);
  } finally { await f.client.close(); }
});


test("CAM5 detects communication loss at 121 seconds and recovers without dispatching mail", async () => {
  const f = await fixture();
  try {
    await f.sample(50, f.now);
    await evaluateStaleCommunications(f.db, f.site.id, f.at(120));
    assert.equal((await f.db.select().from(s.alarms)).length, 0);
    await evaluateStaleCommunications(f.db, f.site.id, f.at(121));
    const [alarm] = await f.db.select().from(s.alarms);
    assert.equal(alarm.kind, "communication");
    assert.equal(alarm.status, "open");
    assert.equal((await preflightLaboratoryEmail(f.db, f.run, f.at(121))).telemetryFresh, false);
    await f.sample(50, f.at(122));
    await evaluateStaleCommunications(f.db, f.site.id, f.at(122));
    const [recovered] = await f.db.select().from(s.alarms).where(eq(s.alarms.id, alarm.id));
    assert.equal(recovered.status, "resolved");
    assert.equal((await f.db.select().from(s.notificationDeliveries)).length, 0);
    await f.db.update(s.gatewayDeviceBindings).set({ enabled: false }).where(eq(s.gatewayDeviceBindings.deviceId, f.device.id));
    await assert.rejects(preflightLaboratoryEmail(f.db, f.run, f.at(122)), /adquisición/);
  } finally { await f.client.close(); }
});

test("portal CAM5 rules evaluate through real SPEC ingestion with independent T01/T02 limits", async () => {
  const { saveMetricRule, listMetricRules } = await import("../db/metric-rules");
  const f = await fixture();
  try {
    const actor = { id: f.actor.id, siteId: f.site.id, permissions: ["alarms.read", "settings.write"] };
    const catalog = await listMetricRules(f.db, actor, f.run.assetId);
    assert.equal(catalog.metrics.length, 36);
    const t01 = catalog.metrics.find((metric) => metric.code === "T01")!;
    const t02 = catalog.metrics.find((metric) => metric.code === "T02")!;
    const base = { assetId: f.run.assetId, name: "CAM5 T01 critical", enabled: true, severity: "critical", op: "gte", value: 75, durationSeconds: 60, recoveryThreshold: 70, recoverySeconds: 20, staleAfterSeconds: 120 };
    const saved = await saveMetricRule(f.db, actor, { ...base, deviceMetricId: t01.id });
    await saveMetricRule(f.db, actor, { ...base, name: "CAM5 T02 critical", deviceMetricId: t02.id });
    await f.sample(90, f.at(0));
    await f.sample(90, f.at(20));
    await f.sample(90, f.at(40));
    assert.equal((await f.db.select().from(s.alarms)).length, 0);
    await f.sample(90, f.at(60));
    const alarms = await f.db.select().from(s.alarms);
    assert.equal(alarms.length, 1);
    assert.equal(alarms[0].genericRuleId, saved.id);
    assert.equal(alarms[0].context.metricKey, "cam5.temperature.t01");
    await f.sample(50, f.at(80));
    assert.equal((await f.db.select().from(s.alarms))[0].status, "open");
    await f.sample(50, f.at(100));
    assert.equal((await f.db.select().from(s.alarms))[0].status, "resolved");
    assert.equal((await f.db.select().from(s.notificationDeliveries)).length, 0);
  } finally { await f.client.close(); }
});

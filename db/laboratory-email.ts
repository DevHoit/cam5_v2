import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import type { Cam5Database } from "./index";
import * as s from "./schema";
import { processDueEscalationJobs, cancelEscalationJobsForAlarm } from "./escalation-engine";
import { queueEscalationNotifications } from "./escalation-notification-engine";
import { processNotificationDelivery } from "./notification-engine";

export const LAB_RECIPIENTS = ["pruebas@hoitlive.com", "emer.cl+3@gmail.com"] as const;
const metricKey = "electrical.voltage.l1_n";
const expression = { op: "lt", metric: metricKey, value: 210 };
export type LaboratoryEmailRun = {
  id: string; siteId: string; assetId: string; deviceId: string; ruleId: string;
  policyId: string; recoveryPolicyId: string; endpointId: string; userId: string;
  recipient: string; createdAt: string; expiresAt: string;
};
export function assertLaboratoryEnvironment(environment: NodeJS.ProcessEnv) {
  if (environment.VERCEL_ENV !== "preview" || environment.VERCEL_GIT_COMMIT_REF !== "feature/hoit-core-v1") {
    throw new Error("El ensayo sólo está disponible en el Preview de feature/hoit-core-v1.");
  }
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function recipients(configuration: Record<string, unknown>) {
  const values = configuration.recipients;
  return Array.isArray(values) && values.every((item) => typeof item === "string")
    ? values.map((item: string) => item.trim().toLowerCase()) : [];
}

export async function prepareLaboratoryEmail(db: Cam5Database, siteId: string, actorId: string, recipient: string, now = new Date()) {
  check(LAB_RECIPIENTS.some((email) => email === recipient), "Correo fuera de los destinos autorizados.");
  return db.transaction(async (tx) => {
    // Lock the site so simultaneous prepares cannot provision two enabled email paths.
    await tx.select({ id: s.sites.id }).from(s.sites).where(eq(s.sites.id, siteId)).for("update");
    const targets = await tx.select({ site: s.sites, asset: s.assets, device: s.devices }).from(s.devices)
      .innerJoin(s.assets, eq(s.assets.id, s.devices.assetId)).innerJoin(s.sites, eq(s.sites.id, s.assets.siteId))
      .where(and(eq(s.sites.id, siteId), eq(s.sites.code, "E2E-STAGING"), eq(s.sites.active, true),
        eq(s.devices.code, "PM5560-E2E-02"), eq(s.devices.active, true), eq(s.assets.active, true)));
    check(targets.length === 1, "El dispositivo del laboratorio no identifica un único destino activo.");
    const target = targets[0];
    const activeRuns = await tx.select({ id: s.rules.id }).from(s.rules).where(and(eq(s.rules.siteId, siteId), eq(s.rules.enabled, true), like(s.rules.name, "LAB-MAIL-%")));
    check(!activeRuns.length, "Primero cierra el ensayo de laboratorio que sigue activo.");
    const endpoints = await tx.select().from(s.notificationEndpoints).where(and(eq(s.notificationEndpoints.siteId, siteId), eq(s.notificationEndpoints.kind, "email"), eq(s.notificationEndpoints.enabled, true)));
    check(endpoints.length === 1, "Debe existir exactamente un canal email habilitado en el laboratorio.");
    const endpoint = endpoints[0];
    check(endpoint.verifiedAt && recipients(endpoint.configuration).length === 1 && recipients(endpoint.configuration)[0] === recipient, "El canal verificado debe tener exclusivamente el correo elegido.");
    const [role] = await tx.select().from(s.roles).where(eq(s.roles.key, "viewer"));
    check(role, "Falta el rol viewer del laboratorio.");
    const [existing] = await tx.select().from(s.users).where(eq(s.users.email, recipient));
    if (existing) {
      const identities = await tx.select().from(s.authIdentities).where(eq(s.authIdentities.userId, existing.id));
      check(existing.displayName === "Destinatario laboratorio email" && !identities.length, "El correo pertenece a un usuario existente; no se reutilizará ni modificará.");
    }
    const user = existing ?? (await tx.insert(s.users).values({ email: recipient, displayName: "Destinatario laboratorio email", status: "active" }).returning())[0];
    check(user.status === "active", "El destinatario de laboratorio está inactivo.");
    const expiresAt = new Date(now.getTime() + 30 * 60_000);
    // No password, login identity or client/platform assignment is created.
    await tx.insert(s.userRoleAssignments).values({ userId: user.id, roleId: role.id, siteId, expiresAt }).onConflictDoUpdate({ target: [s.userRoleAssignments.userId, s.userRoleAssignments.roleId, s.userRoleAssignments.siteId], set: { expiresAt } });
    const id = randomUUID();
    const name = `LAB-MAIL-${id}`;
    const [policy] = await tx.insert(s.escalationPolicies).values({ clientId: target.site.clientId, name, enabled: false }).returning();
    await tx.insert(s.escalationLevels).values([0, 300, 300].map((delaySeconds, index) => ({ policyId: policy.id, levelNumber: index + 1, delaySeconds, recipientType: "user" as const, recipientRef: user.id, channels: ["email"], repeatCount: 1 })));
    const [rule] = await tx.insert(s.rules).values({ clientId: target.site.clientId, siteId, name, description: "Ensayo controlado de correo, escalamiento y acuse.", enabled: false, scopeType: "device", scopeId: target.device.id, severity: "critical", expression, durationSeconds: 60, escalationPolicyId: policy.id, createdBy: actorId, createdAt: now }).returning();
    const [recovery] = await tx.insert(s.notificationPolicies).values({ siteId, endpointId: endpoint.id, name: `${name}-recovery`, active: false, minimumSeverity: "critical", filters: { assetIds: [target.asset.id], eventTypes: ["resolved_automatically"], notifyOnRecovery: true } }).returning();
    const run: LaboratoryEmailRun = { id, siteId, assetId: target.asset.id, deviceId: target.device.id, ruleId: rule.id, policyId: policy.id, recoveryPolicyId: recovery.id, endpointId: endpoint.id, userId: user.id, recipient, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() };
    await tx.insert(s.auditLogs).values({ siteId, actorUserId: actorId, action: "laboratory.email.prepare", resourceType: "laboratory_email", resourceId: id, metadata: run });
    return run;
  });
}

export async function loadLaboratoryEmail(db: Cam5Database, siteId: string, runId: string) {
  const [entry] = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.siteId, siteId), eq(s.auditLogs.action, "laboratory.email.prepare"), eq(s.auditLogs.resourceId, runId)));
  check(entry, "Ensayo no encontrado en el sitio activo.");
  return entry.metadata as LaboratoryEmailRun;
}

export async function preflightLaboratoryEmail(db: Cam5Database, run: LaboratoryEmailRun, now = new Date()) {
  const [closure] = await db.select({ id: s.auditLogs.id }).from(s.auditLogs).where(and(eq(s.auditLogs.siteId, run.siteId), eq(s.auditLogs.action, "laboratory.email.close"), eq(s.auditLogs.resourceId, run.id)));
  check(!closure, "El ensayo está cerrado; prepara uno nuevo.");
  check(now >= new Date(run.createdAt) && now < new Date(run.expiresAt), "La ventana de 30 minutos del ensayo no está vigente.");
  check(LAB_RECIPIENTS.some((email) => email === run.recipient), "Destinatario no autorizado.");
  const [[site], [asset], [device], [rule], [policy], [recovery], [user], endpoints, levels] = await Promise.all([
    db.select().from(s.sites).where(eq(s.sites.id, run.siteId)),
    db.select().from(s.assets).where(eq(s.assets.id, run.assetId)),
    db.select().from(s.devices).where(eq(s.devices.id, run.deviceId)),
    db.select().from(s.rules).where(eq(s.rules.id, run.ruleId)),
    db.select().from(s.escalationPolicies).where(eq(s.escalationPolicies.id, run.policyId)),
    db.select().from(s.notificationPolicies).where(eq(s.notificationPolicies.id, run.recoveryPolicyId)),
    db.select().from(s.users).where(eq(s.users.id, run.userId)),
    db.select().from(s.notificationEndpoints).where(and(eq(s.notificationEndpoints.siteId, run.siteId), eq(s.notificationEndpoints.kind, "email"), eq(s.notificationEndpoints.enabled, true))),
    db.select().from(s.escalationLevels).where(eq(s.escalationLevels.policyId, run.policyId)).orderBy(s.escalationLevels.levelNumber),
  ]);
  check(site?.code === "E2E-STAGING" && site.active && device?.active && device.code === "PM5560-E2E-02" && asset?.active && asset.siteId === run.siteId && device.assetId === run.assetId, "Cambió el alcance del laboratorio.");
  check(rule?.siteId === run.siteId && rule.clientId === site.clientId && rule.name === `LAB-MAIL-${run.id}` && rule.scopeType === "device" && rule.scopeId === run.deviceId && rule.durationSeconds === 60 && rule.severity === "critical" && rule.escalationPolicyId === run.policyId && rule.expression.op === "lt" && rule.expression.metric === metricKey && rule.expression.value === 210 && Object.keys(rule.expression).length === 3, "La regla no coincide con el ensayo.");
  check(policy?.clientId === site.clientId && levels.length === 3 && levels.every((level, index) => level.levelNumber === index + 1 && level.delaySeconds === [0, 300, 300][index] && level.recipientType === "user" && level.recipientRef === run.userId && level.repeatCount === 1 && level.channels.length === 1 && level.channels[0] === "email"), "Cambió la política o alguno de sus destinatarios.");
  check(user?.status === "active" && user.email.trim().toLowerCase() === run.recipient, "Cambió el correo o estado del destinatario personal.");
  check(endpoints.length === 1 && endpoints[0].id === run.endpointId && endpoints[0].verifiedAt && recipients(endpoints[0].configuration).length === 1 && recipients(endpoints[0].configuration)[0] === run.recipient, "El canal es ambiguo o su destino cambió.");
  const filters = recovery?.filters;
  check(recovery?.siteId === run.siteId && recovery.endpointId === run.endpointId && recovery.repeatIntervalMinutes === null && recovery.escalationDelayMinutes === 0 && recovery.minimumSeverity === "critical" && filters?.notifyOnRecovery === true && JSON.stringify(filters.assetIds) === JSON.stringify([run.assetId]) && JSON.stringify(filters.eventTypes) === JSON.stringify(["resolved_automatically"]), "Cambió la regla de recuperación.");
  const alarmRows = await db.select().from(s.alarms).where(eq(s.alarms.genericRuleId, run.ruleId));
  check(alarmRows.length <= 1, "El ensayo admite una sola alarma y una sola apertura.");
  const alarm = alarmRows[0] ?? null;
  if (alarm) check(alarm.siteId === run.siteId && alarm.assetId === run.assetId && alarm.deviceId === run.deviceId && alarm.openedAt >= new Date(run.createdAt) && alarm.openedAt <= now && alarm.occurrenceCount === 1, "La alarma no corresponde a una apertura nueva del ensayo.");
  const jobs = alarm ? await db.select().from(s.escalationJobs).where(eq(s.escalationJobs.alarmId, alarm.id)) : [];
  check(jobs.every((job) => job.policyId === run.policyId && levels.some((level) => level.id === job.levelId) && job.recipientType === "user" && job.recipientRef === run.userId), "Hay trabajos ajenos en la alarma del ensayo.");
  if (alarm) check(jobs.every((job) => job.dueAt.getTime() === alarm.openedAt.getTime() + ([0, 300, 600][levels.findIndex((level) => level.id === job.levelId)] * 1000)), "Los vencimientos del escalamiento fueron modificados.");
  const deliveries = alarm ? await db.select().from(s.notificationDeliveries).where(eq(s.notificationDeliveries.alarmId, alarm.id)) : [];
  check(deliveries.every((delivery) => delivery.endpointId === run.endpointId && delivery.recipient?.trim().toLowerCase() === run.recipient && delivery.queuedAt >= new Date(run.createdAt) && (
    delivery.eventType === "resolved_automatically" ? delivery.policyId === run.recoveryPolicyId : delivery.eventType === "escalated" && delivery.recipientUserId === run.userId && jobs.some((job) => job.id === delivery.payload.escalationJobId)
  )), "Hay entregas ajenas o destinos distintos en la alarma del ensayo.");
  const readings = await db.select({ latest: s.latestMetricReadings }).from(s.latestMetricReadings)
    .innerJoin(s.deviceMetrics, eq(s.deviceMetrics.id, s.latestMetricReadings.deviceMetricId))
    .innerJoin(s.metricDefinitions, eq(s.metricDefinitions.id, s.deviceMetrics.metricDefinitionId))
    .where(and(eq(s.deviceMetrics.deviceId, run.deviceId), eq(s.metricDefinitions.key, metricKey), eq(s.deviceMetrics.enabled, true)));
  const latest = readings.length === 1 ? readings[0].latest : null;
  const telemetryFresh = Boolean(latest && latest.quality === "good" && latest.valueNumeric !== null && latest.recordedAt <= now && latest.recordedAt >= new Date(now.getTime() - 120_000));
  return { run, activated: Boolean(rule.enabled && policy.enabled && recovery.active), alarm, jobs, deliveries, telemetryFresh, dispatchSkipped: true };
}

export async function activateLaboratoryEmail(db: Cam5Database, run: LaboratoryEmailRun, now = new Date()) {
  const state = await preflightLaboratoryEmail(db, run, now);
  check(!state.alarm, "La activación exige que aún no exista una alarma del ensayo.");
  const readings = await db.select({ latest: s.latestMetricReadings }).from(s.latestMetricReadings).innerJoin(s.deviceMetrics, eq(s.deviceMetrics.id, s.latestMetricReadings.deviceMetricId)).innerJoin(s.metricDefinitions, eq(s.metricDefinitions.id, s.deviceMetrics.metricDefinitionId)).where(and(eq(s.deviceMetrics.deviceId, run.deviceId), eq(s.metricDefinitions.key, metricKey), eq(s.deviceMetrics.enabled, true)));
  check(readings.length === 1 && readings[0].latest.quality === "good" && readings[0].latest.recordedAt <= now && readings[0].latest.recordedAt >= new Date(now.getTime() - 120_000) && readings[0].latest.valueNumeric !== null && Number(readings[0].latest.valueNumeric) >= 210, "Antes de activar se requiere una lectura normal y vigente del PM5560 por ingestión.");
  await db.transaction(async (tx) => {
    await tx.select({ id: s.rules.id }).from(s.rules).where(eq(s.rules.id, run.ruleId)).for("update");
    await preflightLaboratoryEmail(tx as unknown as Cam5Database, run, now);
    await tx.update(s.rules).set({ enabled: true }).where(eq(s.rules.id, run.ruleId));
    await tx.update(s.escalationPolicies).set({ enabled: true }).where(eq(s.escalationPolicies.id, run.policyId));
    await tx.update(s.notificationPolicies).set({ active: true }).where(eq(s.notificationPolicies.id, run.recoveryPolicyId));
  });
  return preflightLaboratoryEmail(db, run, now);
}

export async function processLaboratoryEmail(db: Cam5Database, run: LaboratoryEmailRun, options: { now?: Date; fetchImpl?: typeof fetch; environment?: NodeJS.ProcessEnv } = {}) {
  assertLaboratoryEnvironment(options.environment ?? process.env);
  const now = options.now ?? new Date();
  const state = await preflightLaboratoryEmail(db, run, now);
  check(state.activated && state.alarm, "Primero activa el ensayo y espera una alarma nueva.");
  check(state.telemetryFresh, "Mantén telemetría buena y vigente durante el ensayo.");
  const escalations = await processDueEscalationJobs(db, { now, jobIds: state.jobs.map((job) => job.id), execute: async (context) => {
    await preflightLaboratoryEmail(db, run, now);
    return queueEscalationNotifications(db, context, now);
  } });
  const current = await preflightLaboratoryEmail(db, run, now);
  const results = [];
  for (const delivery of current.deliveries.filter((item) => item.status === "queued" && item.attemptCount === 0 && item.scheduledAt <= now && item.nextAttemptAt <= now && (item.eventType !== "escalated" || current.jobs.some((job) => job.id === item.payload.escalationJobId && job.status === "completed")))) {
    await preflightLaboratoryEmail(db, run, now);
    results.push({ id: delivery.id, ...await processNotificationDelivery(db, delivery.id, { ...options, now, laboratoryGuard: { alarmId: state.alarm.id, endpointId: run.endpointId, recipient: run.recipient, expiresAt: new Date(run.expiresAt) } }) });
  }
  return { escalations, results, state: await preflightLaboratoryEmail(db, run, now), dispatchSkipped: false };
}

export async function closeLaboratoryEmail(db: Cam5Database, run: LaboratoryEmailRun) {
  // Cleanup remains available after expiration and even after a failed preflight.
  await db.transaction(async (tx) => {
    await tx.select({ id: s.rules.id }).from(s.rules).where(eq(s.rules.id, run.ruleId)).for("update");
    await tx.insert(s.auditLogs).values({ siteId: run.siteId, action: "laboratory.email.close", resourceType: "laboratory_email", resourceId: run.id, metadata: { runId: run.id } });
    await tx.update(s.rules).set({ enabled: false }).where(eq(s.rules.id, run.ruleId));
    await tx.update(s.escalationPolicies).set({ enabled: false }).where(eq(s.escalationPolicies.id, run.policyId));
    await tx.update(s.notificationPolicies).set({ active: false }).where(eq(s.notificationPolicies.id, run.recoveryPolicyId));
    const alarms = await tx.select({ id: s.alarms.id }).from(s.alarms).where(eq(s.alarms.genericRuleId, run.ruleId));
    for (const alarm of alarms) {
      await cancelEscalationJobsForAlarm(tx as unknown as Cam5Database, alarm.id);
      await tx.update(s.notificationDeliveries).set({ status: "suppressed", errorMessage: "Ensayo de laboratorio cerrado." }).where(and(eq(s.notificationDeliveries.alarmId, alarm.id), inArray(s.notificationDeliveries.status, ["queued", "failed"])));
    }
  });
  return { closed: true, runId: run.id, dispatchSkipped: true };
}

import { suppressPendingPersonalEscalations } from "./notification-engine";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Cam5Database } from "./index";
import {
  alarms,
  escalationJobs,
  escalationLevels,
  escalationPolicies,
  sites,
} from "./schema";

const FINAL_ALARM_STATUSES = ["acknowledged", "resolved", "closed", "suppressed"] as const;

export type EscalationExecutionContext = {
  job: {
    id: string;
    alarmId: string;
    policyId: string;
    levelId: string;
    dueAt: Date;
    recipientType: "user" | "role" | "on_call_group";
    recipientRef: string;
    attemptCount: number;
  };
  alarm: {
    id: string;
    siteId: string;
    status: "open" | "acknowledged" | "resolved" | "closed" | "suppressed";
    severity: "normal" | "info" | "warning" | "critical";
    code: string;
    title: string;
  };
  level: {
    levelNumber: number;
    channels: string[];
    repeatCount: number;
  };
};

export type EscalationExecutor = (
  context: EscalationExecutionContext,
) => Promise<{ resolvedRecipientUserId?: string | null } | void>;

export async function enqueueEscalationJob(
  db: Cam5Database,
  input: {
    alarmId: string;
    policyId: string;
    levelId: string;
    dueAt: Date;
  },
) {
  if (!Number.isFinite(input.dueAt.getTime())) throw new Error("dueAt no es una fecha válida.");

  const [[alarm], [level]] = await Promise.all([
    db.select({
      id: alarms.id,
      status: alarms.status,
      clientId: sites.clientId,
    }).from(alarms)
      .innerJoin(sites, eq(sites.id, alarms.siteId))
      .where(eq(alarms.id, input.alarmId))
      .limit(1),
    db.select({
      id: escalationLevels.id,
      policyId: escalationLevels.policyId,
      recipientType: escalationLevels.recipientType,
      recipientRef: escalationLevels.recipientRef,
      policyClientId: escalationPolicies.clientId,
      policyEnabled: escalationPolicies.enabled,
    }).from(escalationLevels)
      .innerJoin(escalationPolicies, eq(escalationPolicies.id, escalationLevels.policyId))
      .where(and(
        eq(escalationLevels.id, input.levelId),
        eq(escalationPolicies.id, input.policyId),
      ))
      .limit(1),
  ]);

  if (!alarm) throw new Error("La alarma no existe.");
  if (!level) throw new Error("El nivel no pertenece a la política indicada.");
  if (alarm.clientId !== level.policyClientId) throw new Error("La política y la alarma deben pertenecer al mismo cliente.");
  if (!level.policyEnabled) return { created: false as const, job: null };
  if (FINAL_ALARM_STATUSES.includes(alarm.status as typeof FINAL_ALARM_STATUSES[number])) {
    return { created: false as const, job: null };
  }

  const [created] = await db.insert(escalationJobs).values({
    alarmId: input.alarmId,
    policyId: input.policyId,
    levelId: input.levelId,
    dueAt: input.dueAt,
    recipientType: level.recipientType,
    recipientRef: level.recipientRef,
  }).onConflictDoNothing({
    target: [escalationJobs.alarmId, escalationJobs.levelId],
  }).returning();

  if (created) return { created: true as const, job: created };

  const [existing] = await db.select().from(escalationJobs)
    .where(and(
      eq(escalationJobs.alarmId, input.alarmId),
      eq(escalationJobs.levelId, input.levelId),
    ))
    .limit(1);
  if (!existing) return { created: false as const, job: null };

  if (["cancelled", "completed", "failed"].includes(existing.status)) {
    await suppressPendingPersonalEscalations(db, input.alarmId, new Date(), existing.id);
    const [requeued] = await db.update(escalationJobs).set({
      status: "pending",
      dueAt: input.dueAt,
      recipientType: level.recipientType,
      recipientRef: level.recipientRef,
      resolvedRecipientUserId: null,
      attemptCount: 0,
      lastError: null,
      completedAt: null,
      updatedAt: new Date(),
    }).where(eq(escalationJobs.id, existing.id)).returning();
    return { created: false as const, job: requeued ?? existing, requeued: Boolean(requeued) };
  }

  return { created: false as const, job: existing, requeued: false as const };
}

export async function cancelEscalationJobsForAlarm(
  db: Cam5Database,
  alarmId: string,
  now = new Date(),
) {
  const rows = await db.update(escalationJobs).set({
    status: "cancelled",
    completedAt: now,
    updatedAt: now,
  }).where(and(
    eq(escalationJobs.alarmId, alarmId),
    inArray(escalationJobs.status, ["pending", "processing"]),
  )).returning({ id: escalationJobs.id });
  await suppressPendingPersonalEscalations(db, alarmId, now);
  return rows.length;
}

export async function processDueEscalationJobs(
  db: Cam5Database,
  input: {
    now?: Date;
    limit?: number;
    execute: EscalationExecutor;
  },
) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const candidates = await db.select({ id: escalationJobs.id })
    .from(escalationJobs)
    .where(and(
      eq(escalationJobs.status, "pending"),
      lte(escalationJobs.dueAt, now),
    ))
    .orderBy(asc(escalationJobs.dueAt), asc(escalationJobs.createdAt))
    .limit(limit);

  let processed = 0;
  let completed = 0;
  let cancelled = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const [claimed] = await db.update(escalationJobs).set({
      status: "processing",
      attemptCount: sql`${escalationJobs.attemptCount} + 1`,
      lastError: null,
      updatedAt: now,
    }).where(and(
      eq(escalationJobs.id, candidate.id),
      eq(escalationJobs.status, "pending"),
    )).returning();
    if (!claimed) continue;
    processed += 1;

    const [context] = await db.select({
      jobId: escalationJobs.id,
      alarmId: escalationJobs.alarmId,
      policyId: escalationJobs.policyId,
      levelId: escalationJobs.levelId,
      dueAt: escalationJobs.dueAt,
      recipientType: escalationJobs.recipientType,
      recipientRef: escalationJobs.recipientRef,
      attemptCount: escalationJobs.attemptCount,
      alarmSiteId: alarms.siteId,
      alarmStatus: alarms.status,
      alarmSeverity: alarms.severity,
      alarmCode: alarms.code,
      alarmTitle: alarms.title,
      policyEnabled: escalationPolicies.enabled,
      levelNumber: escalationLevels.levelNumber,
      channels: escalationLevels.channels,
      repeatCount: escalationLevels.repeatCount,
    }).from(escalationJobs)
      .innerJoin(alarms, eq(alarms.id, escalationJobs.alarmId))
      .innerJoin(escalationPolicies, eq(escalationPolicies.id, escalationJobs.policyId))
      .innerJoin(escalationLevels, eq(escalationLevels.id, escalationJobs.levelId))
      .where(eq(escalationJobs.id, claimed.id))
      .limit(1);

    if (!context || !context.policyEnabled || FINAL_ALARM_STATUSES.includes(context.alarmStatus as typeof FINAL_ALARM_STATUSES[number])) {
      await db.update(escalationJobs).set({
        status: "cancelled",
        completedAt: now,
        updatedAt: now,
      }).where(eq(escalationJobs.id, claimed.id));
      cancelled += 1;
      continue;
    }

    try {
      const result = await input.execute({
        job: {
          id: context.jobId,
          alarmId: context.alarmId,
          policyId: context.policyId,
          levelId: context.levelId,
          dueAt: context.dueAt,
          recipientType: context.recipientType,
          recipientRef: context.recipientRef,
          attemptCount: context.attemptCount,
        },
        alarm: {
          id: context.alarmId,
          siteId: context.alarmSiteId,
          status: context.alarmStatus,
          severity: context.alarmSeverity,
          code: context.alarmCode,
          title: context.alarmTitle,
        },
        level: {
          levelNumber: context.levelNumber,
          channels: context.channels,
          repeatCount: context.repeatCount,
        },
      });

      await db.update(escalationJobs).set({
        status: "completed",
        resolvedRecipientUserId: result?.resolvedRecipientUserId ?? null,
        completedAt: now,
        updatedAt: now,
      }).where(eq(escalationJobs.id, claimed.id));
      completed += 1;
    } catch (error) {
      await db.update(escalationJobs).set({
        status: "failed",
        lastError: error instanceof Error ? error.message.slice(0, 2000) : "Error de escalamiento no identificado.",
        updatedAt: now,
      }).where(eq(escalationJobs.id, claimed.id));
      failed += 1;
    }
  }

  return { processed, completed, cancelled, failed };
}

import { eq } from "drizzle-orm";
import { evaluateStaleCommunications } from "./alarm-engine";
import { evaluateAtsSite } from "./ats-alarm-engine";
import { evaluateColdChainSite } from "./cold-chain-alarm-engine";
import { evaluateElectricalSite } from "./electrical-alarm-engine";
import type { Cam5Database } from "./index";
import { processDueEscalationJobs } from "./escalation-engine";
import { queueEscalationNotifications } from "./escalation-notification-engine";
import { processNotificationQueue } from "./notification-engine";
import { evaluateGenericRules } from "./rule-engine";
import { sites } from "./schema";

type DomainResult = {
  siteId: string;
  domain: "legacy" | "cold_chain" | "electrical" | "ats" | "generic_rules";
  status: "fulfilled" | "rejected";
  error: string | null;
};

export type OperationalCycleResult = {
  startedAt: string;
  completedAt: string;
  sites: number;
  evaluations: number;
  evaluationFailures: number;
  domains: DomainResult[];
  escalations: {
    processed: number;
    completed: number;
    cancelled: number;
    failed: number;
  };
  notifications: {
    recovered: number;
    repeated: number;
    processed: number;
    sent: number;
    delivered: number;
    failed: number;
    suppressed: number;
  };
  ok: boolean;
};

function message(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}

export async function runOperationalCycle(
  db: Cam5Database,
  options: { now?: Date; notificationLimit?: number; includeRepeats?: boolean } = {},
): Promise<OperationalCycleResult> {
  const startedAt = options.now ?? new Date();
  const activeSites = await db.select({ id: sites.id }).from(sites).where(eq(sites.active, true));
  const tasks: Array<{
    siteId: string;
    domain: DomainResult["domain"];
    run: () => Promise<unknown>;
  }> = activeSites.flatMap((site) => [
    { siteId: site.id, domain: "legacy" as const, run: () => evaluateStaleCommunications(db, site.id, startedAt) },
    { siteId: site.id, domain: "cold_chain" as const, run: () => evaluateColdChainSite(db, site.id, startedAt) },
    { siteId: site.id, domain: "electrical" as const, run: () => evaluateElectricalSite(db, site.id, startedAt) },
    { siteId: site.id, domain: "ats" as const, run: () => evaluateAtsSite(db, site.id, startedAt) },
  ]);
  tasks.push({ siteId: "global", domain: "generic_rules" as const, run: () => evaluateGenericRules(db, startedAt) });

  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const domains: DomainResult[] = settled.map((result, index) => ({
    siteId: tasks[index].siteId,
    domain: tasks[index].domain,
    status: result.status,
    error: result.status === "rejected" ? message(result.reason) : null,
  }));
  const evaluationFailures = domains.filter((item) => item.status === "rejected").length;

  const escalations = await processDueEscalationJobs(db, {
    now: startedAt,
    limit: options.notificationLimit,
    execute: (context) => queueEscalationNotifications(db, context, startedAt),
  });

  const notifications = await processNotificationQueue(db, {
    now: startedAt,
    limit: options.notificationLimit,
    includeRepeats: options.includeRepeats,
  });

  const completedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    sites: activeSites.length,
    evaluations: tasks.length,
    evaluationFailures,
    domains,
    escalations,
    notifications,
    ok: evaluationFailures === 0 && escalations.failed === 0 && notifications.failed === 0,
  };
}

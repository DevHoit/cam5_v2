import { sleep, getStepMetadata } from "workflow";
import { start } from "workflow/api";
import { getDb } from "../db/index";
import { assertPreviewScheduler, executePreviewSchedulerCycle, recordPreviewRun } from "../db/preview-scheduler";

async function evaluate(generation: string) {
  "use step";
  const policy = assertPreviewScheduler(process.env);
  return executePreviewSchedulerCycle(getDb(), generation, getStepMetadata().stepId, policy.siteCode!);
}

async function record(generation: string, runId: string) {
  "use step";
  assertPreviewScheduler(process.env);
  await recordPreviewRun(getDb(), generation, runId);
  console.info("Preview scheduler continuation recorded", { runId });
}

export async function previewOperations(generation: string): Promise<{ stopped?: boolean; continued?: boolean; runId?: string }> {
  "use workflow";
  // Bound replay history (~1,500 events) and continue on a new durable run.
  for (let cycle = 0; cycle < 300; cycle++) {
    try {
      const result = await evaluate(generation);
      if (!result.active || !result.nextAt) return { stopped: true };
      await sleep(result.nextAt);
    } catch {
      // After the step's bounded retries, keep supervision alive without dispatch.
      console.warn("Preview scheduler cycle unavailable; retrying after 60 seconds");
      await sleep("60s");
    }
  }
  const next = await start(previewOperations, [generation]);
  await record(generation, next.runId);
  return { continued: true, runId: next.runId };
}

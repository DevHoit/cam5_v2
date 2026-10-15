/** Versioned recovery/freshness contract for individual device metrics. */
export type MetricRuleBehavior = {
  kind: "device_metric";
  version: 1;
  deviceMetricId: string;
  recoveryThreshold: number | null;
  recoverySeconds: number;
  staleAfterSeconds: number;
};

export function metricRuleBehavior(value: Record<string, unknown> | null): MetricRuleBehavior | null {
  if (!value || value.kind !== "device_metric" || value.version !== 1 ||
      typeof value.deviceMetricId !== "string" ||
      !Number.isInteger(value.recoverySeconds) || Number(value.recoverySeconds) < 0 || Number(value.recoverySeconds) > 86400 ||
      !Number.isInteger(value.staleAfterSeconds) || Number(value.staleAfterSeconds) < 1 || Number(value.staleAfterSeconds) > 86400 ||
      !(value.recoveryThreshold === null || (typeof value.recoveryThreshold === "number" && Number.isFinite(value.recoveryThreshold)))) return null;
  return value as MetricRuleBehavior;
}

export type MetricRuleItem = {
  id: string; name: string; enabled: boolean; severity: "info" | "warning" | "critical";
  op: string; value: number | string | boolean; durationSeconds: number;
  recoveryThreshold: number | null; recoverySeconds: number; staleAfterSeconds: number;
  editable: boolean; updatedAt: string; state: string; lastEvaluatedAt: string | null;
  lastValue: Record<string, unknown> | null;
};
export type MetricRuleMetric = {
  id: string; deviceId: string; deviceCode: string; deviceName: string;
  code: string; name: string; key: string; unit: string; dataType: string; enabled: boolean;
  value: number | string | boolean | null; recordedAt: string | null; quality: string | null;
  staleAfterSeconds: number; rules: MetricRuleItem[];
};

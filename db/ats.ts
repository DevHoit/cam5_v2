export type AtsConfig = {
  source1Label: string;
  source2Label: string;
  staleAfterSeconds: number;
  source1Required: boolean;
  source2Required: boolean;
  sourceUnavailableDelaySeconds: number;
  commonAlarmDelaySeconds: number;
  expectedPosition: "source1" | "source2" | null;
  unexpectedPositionDelaySeconds: number;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function parseAtsConfig(metadata: Record<string, unknown> | null | undefined): AtsConfig {
  const ats = object(object(metadata).ats);
  const alarms = object(ats.alarms);
  const expectedPosition = ats.expectedPosition === "source1" || ats.expectedPosition === "source2"
    ? ats.expectedPosition
    : null;
  return {
    source1Label: typeof ats.source1Label === "string" && ats.source1Label.trim() ? ats.source1Label.trim() : "Fuente 1",
    source2Label: typeof ats.source2Label === "string" && ats.source2Label.trim() ? ats.source2Label.trim() : "Fuente 2",
    staleAfterSeconds: positiveInteger(alarms.staleAfterSeconds, 30),
    source1Required: alarms.source1Required === true,
    source2Required: alarms.source2Required === true,
    sourceUnavailableDelaySeconds: nonNegativeInteger(alarms.sourceUnavailableDelaySeconds, 5),
    commonAlarmDelaySeconds: nonNegativeInteger(alarms.commonAlarmDelaySeconds, 0),
    expectedPosition,
    unexpectedPositionDelaySeconds: nonNegativeInteger(alarms.unexpectedPositionDelaySeconds, 10),
  };
}

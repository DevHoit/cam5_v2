export type TemperaturePoint = {
  recordedAt: Date;
  valueC: number | null;
  quality: string;
};

export type TemperatureExcursion = {
  type: "low" | "high" | "data_gap";
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number;
  extremeC: number | null;
  thresholdC: number | null;
  active: boolean;
};

export function detectTemperatureExcursions(input: {
  points: TemperaturePoint[];
  minimumC: number | null;
  maximumC: number | null;
  staleAfterSeconds: number;
  excursionDelaySeconds: number;
  rangeEnd: Date;
}): TemperatureExcursion[] {
  const points = [...input.points].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  if (!points.length) return [];

  const excursions: TemperatureExcursion[] = [];
  let active: {
    type: "low" | "high";
    startedAt: Date;
    extremeC: number;
    thresholdC: number;
  } | null = null;

  const closeActive = (endedAt: Date) => {
    if (!active) return;
    const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - active.startedAt.getTime()) / 1000));
    if (durationSeconds >= input.excursionDelaySeconds) {
      excursions.push({
        type: active.type,
        startedAt: active.startedAt,
        endedAt,
        durationSeconds,
        extremeC: active.extremeC,
        thresholdC: active.thresholdC,
        active: false,
      });
    }
    active = null;
  };

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const previous = index > 0 ? points[index - 1] : null;

    if (previous) {
      const gapSeconds = Math.round((point.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000);
      if (gapSeconds > input.staleAfterSeconds) {
        const staleBoundary = new Date(previous.recordedAt.getTime() + input.staleAfterSeconds * 1000);
        closeActive(staleBoundary);
        excursions.push({
          type: "data_gap",
          startedAt: staleBoundary,
          endedAt: point.recordedAt,
          durationSeconds: Math.max(0, gapSeconds - input.staleAfterSeconds),
          extremeC: null,
          thresholdC: null,
          active: false,
        });
      }
    }

    if (point.quality !== "good" || point.valueC === null || !Number.isFinite(point.valueC)) {
      closeActive(point.recordedAt);
      continue;
    }

    let observed: "low" | "high" | null = null;
    let threshold: number | null = null;
    if (input.minimumC !== null && point.valueC < input.minimumC) {
      observed = "low";
      threshold = input.minimumC;
    } else if (input.maximumC !== null && point.valueC > input.maximumC) {
      observed = "high";
      threshold = input.maximumC;
    }

    if (!observed || threshold === null) {
      closeActive(point.recordedAt);
      continue;
    }

    if (!active || active.type !== observed) {
      closeActive(point.recordedAt);
      active = {
        type: observed,
        startedAt: point.recordedAt,
        extremeC: point.valueC,
        thresholdC: threshold,
      };
    } else {
      active.extremeC = observed === "high"
        ? Math.max(active.extremeC, point.valueC)
        : Math.min(active.extremeC, point.valueC);
    }
  }

  const last = points[points.length - 1];
  const trailingGapSeconds = Math.round((input.rangeEnd.getTime() - last.recordedAt.getTime()) / 1000);
  const trailingIsStale = trailingGapSeconds > input.staleAfterSeconds;

  if (active) {
    const thermalEnd = trailingIsStale
      ? new Date(last.recordedAt.getTime() + input.staleAfterSeconds * 1000)
      : input.rangeEnd;
    const durationSeconds = Math.max(0, Math.round((thermalEnd.getTime() - active.startedAt.getTime()) / 1000));
    if (durationSeconds >= input.excursionDelaySeconds) {
      excursions.push({
        type: active.type,
        startedAt: active.startedAt,
        endedAt: trailingIsStale ? thermalEnd : null,
        durationSeconds,
        extremeC: active.extremeC,
        thresholdC: active.thresholdC,
        active: !trailingIsStale,
      });
    }
  }

  if (trailingIsStale) {
    excursions.push({
      type: "data_gap",
      startedAt: new Date(last.recordedAt.getTime() + input.staleAfterSeconds * 1000),
      endedAt: null,
      durationSeconds: trailingGapSeconds - input.staleAfterSeconds,
      extremeC: null,
      thresholdC: null,
      active: true,
    });
  }

  return excursions.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

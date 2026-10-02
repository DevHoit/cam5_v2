export type ColdChainConfig = {
  minimumC: number | null;
  maximumC: number | null;
  targetC: number | null;
  staleAfterSeconds: number;
  disagreementThresholdC: number | null;
  excursionDelaySeconds: number;
};

export type ColdChainSensorSnapshot = {
  id: string;
  code: string;
  name: string;
  deviceState: string;
  lastReadAt: Date | null;
  temperatureC: number | null;
  temperatureRecordedAt: Date | null;
  temperatureQuality: string | null;
  batteryVoltage: number | null;
  rssi: number | null;
};

export type ColdChainSensorStatus = "normal" | "warning" | "critical" | "offline" | "unconfigured";

export type ColdChainSensorView = ColdChainSensorSnapshot & {
  status: ColdChainSensorStatus;
  stale: boolean;
};

export type ColdChainSummary = {
  status: ColdChainSensorStatus;
  minimumObservedC: number | null;
  maximumObservedC: number | null;
  averageC: number | null;
  spreadC: number | null;
  sensorsOnline: number;
  sensorsTotal: number;
  disagreement: boolean;
  sensors: ColdChainSensorView[];
};

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const positiveInteger = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;

export function parseColdChainConfig(metadata: Record<string, unknown> | null | undefined): ColdChainConfig {
  const raw = metadata?.coldChain;
  const coldChain = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};

  const minimumC = finiteNumber(coldChain.minimumC);
  const maximumC = finiteNumber(coldChain.maximumC);
  const targetC = finiteNumber(coldChain.targetC);
  const disagreementThresholdC = finiteNumber(coldChain.disagreementThresholdC);

  return {
    minimumC,
    maximumC,
    targetC,
    staleAfterSeconds: positiveInteger(coldChain.staleAfterSeconds, 180),
    disagreementThresholdC: disagreementThresholdC !== null && disagreementThresholdC >= 0 ? disagreementThresholdC : null,
    excursionDelaySeconds: positiveInteger(coldChain.excursionDelaySeconds, 300),
  };
}

function sensorStatus(
  sensor: ColdChainSensorSnapshot,
  config: ColdChainConfig,
  now: Date,
): ColdChainSensorView {
  const stale = !sensor.temperatureRecordedAt
    || now.getTime() - sensor.temperatureRecordedAt.getTime() > config.staleAfterSeconds * 1000;

  if (sensor.deviceState === "offline" || sensor.deviceState === "decommissioned" || stale || sensor.temperatureC === null) {
    return { ...sensor, status: "offline", stale };
  }

  if (config.minimumC === null || config.maximumC === null) {
    return { ...sensor, status: "unconfigured", stale };
  }

  const outside = sensor.temperatureC < config.minimumC || sensor.temperatureC > config.maximumC;
  return { ...sensor, status: outside ? "critical" : "normal", stale };
}

export function summarizeColdChain(
  sensors: ColdChainSensorSnapshot[],
  config: ColdChainConfig,
  now = new Date(),
): ColdChainSummary {
  const views = sensors.map((sensor) => sensorStatus(sensor, config, now));
  const online = views.filter((sensor) => sensor.status !== "offline" && sensor.temperatureC !== null);
  const values = online.map((sensor) => sensor.temperatureC as number);

  const minimumObservedC = values.length ? Math.min(...values) : null;
  const maximumObservedC = values.length ? Math.max(...values) : null;
  const averageC = values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  const spreadC = minimumObservedC === null || maximumObservedC === null ? null : maximumObservedC - minimumObservedC;
  const disagreement = spreadC !== null
    && config.disagreementThresholdC !== null
    && spreadC > config.disagreementThresholdC;

  let status: ColdChainSensorStatus = "normal";
  if (views.length === 0 || online.length === 0) status = "offline";
  else if (views.some((sensor) => sensor.status === "critical")) status = "critical";
  else if (disagreement || views.some((sensor) => sensor.status === "offline")) status = "warning";
  else if (views.some((sensor) => sensor.status === "unconfigured")) status = "unconfigured";

  return {
    status,
    minimumObservedC,
    maximumObservedC,
    averageC,
    spreadC,
    sensorsOnline: online.length,
    sensorsTotal: views.length,
    disagreement,
    sensors: views,
  };
}

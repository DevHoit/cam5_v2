export type ElectricalAlarmConfig = {
  staleAfterSeconds: number;
  thresholdDelaySeconds: number;
  voltageMinV: number | null;
  voltageMaxV: number | null;
  currentMaxA: number | null;
  frequencyMinHz: number | null;
  frequencyMaxHz: number | null;
  powerFactorMin: number | null;
  voltageHysteresisV: number;
  currentHysteresisA: number;
  frequencyHysteresisHz: number;
  powerFactorHysteresis: number;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positive(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseElectricalAlarmConfig(metadata: Record<string, unknown> | null | undefined): ElectricalAlarmConfig {
  const electrical = object(object(metadata).electrical);
  const alarms = object(electrical.alarms);
  return {
    staleAfterSeconds: positive(alarms.staleAfterSeconds, 30),
    thresholdDelaySeconds: nonNegative(alarms.thresholdDelaySeconds, 0),
    voltageMinV: optionalNumber(alarms.voltageMinV),
    voltageMaxV: optionalNumber(alarms.voltageMaxV),
    currentMaxA: optionalNumber(alarms.currentMaxA),
    frequencyMinHz: optionalNumber(alarms.frequencyMinHz),
    frequencyMaxHz: optionalNumber(alarms.frequencyMaxHz),
    powerFactorMin: optionalNumber(alarms.powerFactorMin),
    voltageHysteresisV: nonNegative(alarms.voltageHysteresisV),
    currentHysteresisA: nonNegative(alarms.currentHysteresisA),
    frequencyHysteresisHz: nonNegative(alarms.frequencyHysteresisHz),
    powerFactorHysteresis: nonNegative(alarms.powerFactorHysteresis),
  };
}

export function validateElectricalAlarmConfig(config: ElectricalAlarmConfig) {
  if (config.voltageMinV !== null && config.voltageMaxV !== null && config.voltageMinV >= config.voltageMaxV) {
    throw new Error("voltageMinV debe ser menor que voltageMaxV.");
  }
  if (config.frequencyMinHz !== null && config.frequencyMaxHz !== null && config.frequencyMinHz >= config.frequencyMaxHz) {
    throw new Error("frequencyMinHz debe ser menor que frequencyMaxHz.");
  }
  if (config.currentMaxA !== null && config.currentMaxA <= 0) throw new Error("currentMaxA debe ser mayor que cero.");
  if (config.voltageHysteresisV < 0 || config.currentHysteresisA < 0 || config.frequencyHysteresisHz < 0 || config.powerFactorHysteresis < 0) {
    throw new Error("Las histéresis no pueden ser negativas.");
  }
  if (config.powerFactorMin !== null && (config.powerFactorMin < 0 || config.powerFactorMin > 1)) {
    throw new Error("powerFactorMin debe estar entre 0 y 1.");
  }
  return config;
}

import type { PointAggregation, PointConfigOverrides, PointSystem } from "./schema";

/**
 * Tipos de punto y su configuración efectiva.
 *
 * Cada punto pertenece a un tipo (cámara fría, tablero, UPS…) que define el sistema donde se muestra,
 * la magnitud principal y cómo combinar varios sensores. El punto puede ajustar el rango objetivo,
 * la tolerancia y la combinación sin cambiar el tipo.
 */

export const POINT_SYSTEMS: Record<PointSystem, string> = {
  condition: "Monitoreo de condición",
  cold: "Frío",
  energy: "Energía",
  backup: "Respaldo",
  other: "Otros",
};

export const POINT_AGGREGATIONS: Record<PointAggregation, string> = {
  max: "Valor más alto (peor sensor)",
  min: "Valor más bajo",
  avg: "Promedio de sensores",
  sum: "Suma de equipos",
  last: "Último valor",
};

export type PointTypeDefinition = {
  key: string;
  name: string;
  system: PointSystem;
  primaryQuantity: string | null;
  aggregation: PointAggregation;
  defaultConfig: PointConfigOverrides;
};

export type EffectivePointConfig = {
  rangeMin: number | null;
  rangeMax: number | null;
  toleranceMinutes: number;
  aggregation: PointAggregation;
};

export class PointConfigError extends Error {}

const MAX_TOLERANCE_MINUTES = 24 * 60;

function optionalLimit(value: unknown, label: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || Math.abs(parsed) > 1e9) throw new PointConfigError(`${label} no es un número válido.`);
  return parsed;
}

/** Valida los ajustes que envía el portal y devuelve solo las claves conocidas. */
export function parsePointConfig(value: unknown): PointConfigOverrides {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new PointConfigError("La configuración del punto no es válida.");
  const input = value as Record<string, unknown>;
  const config: PointConfigOverrides = {};
  const rangeMin = optionalLimit(input.rangeMin, "El mínimo del rango");
  const rangeMax = optionalLimit(input.rangeMax, "El máximo del rango");
  if (rangeMin !== undefined) config.rangeMin = rangeMin;
  if (rangeMax !== undefined) config.rangeMax = rangeMax;
  if (typeof config.rangeMin === "number" && typeof config.rangeMax === "number" && config.rangeMin >= config.rangeMax) {
    throw new PointConfigError("El mínimo del rango debe ser menor que el máximo.");
  }
  if (input.toleranceMinutes !== undefined && input.toleranceMinutes !== null && input.toleranceMinutes !== "") {
    const minutes = Number(input.toleranceMinutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_TOLERANCE_MINUTES) throw new PointConfigError("La tolerancia debe ser un número entero de minutos entre 0 y 1440.");
    config.toleranceMinutes = minutes;
  }
  const deltaWarning = optionalLimit(input.temperatureDeltaWarning, "La diferencia de temperatura de advertencia");
  const deltaCritical = optionalLimit(input.temperatureDeltaCritical, "La diferencia de temperatura crítica");
  for (const value of [deltaWarning, deltaCritical]) {
    if (typeof value === "number" && (value <= 0 || value > 500)) throw new PointConfigError("La diferencia de temperatura debe estar entre 0 y 500 °C.");
  }
  if (typeof deltaWarning === "number" && typeof deltaCritical === "number" && deltaWarning >= deltaCritical) {
    throw new PointConfigError("La diferencia de advertencia debe ser menor que la crítica.");
  }
  if (deltaWarning !== undefined) config.temperatureDeltaWarning = deltaWarning;
  if (deltaCritical !== undefined) config.temperatureDeltaCritical = deltaCritical;
  if (input.aggregation !== undefined && input.aggregation !== null && input.aggregation !== "") {
    if (!(typeof input.aggregation === "string" && input.aggregation in POINT_AGGREGATIONS)) throw new PointConfigError("La forma de combinar sensores no es válida.");
    config.aggregation = input.aggregation as PointAggregation;
  }
  return config;
}

/** Configuración efectiva: lo del tipo, sobrescrito por lo que el punto define explícitamente. */
export function resolvePointConfig(type: Pick<PointTypeDefinition, "aggregation" | "defaultConfig">, overrides: PointConfigOverrides | null | undefined): EffectivePointConfig {
  const merged = { ...type.defaultConfig, ...(overrides ?? {}) };
  return {
    rangeMin: typeof merged.rangeMin === "number" ? merged.rangeMin : null,
    rangeMax: typeof merged.rangeMax === "number" ? merged.rangeMax : null,
    toleranceMinutes: typeof merged.toleranceMinutes === "number" ? merged.toleranceMinutes : 0,
    aggregation: merged.aggregation ?? type.aggregation,
  };
}

export function aggregateValues(values: number[], aggregation: PointAggregation): number | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  if (aggregation === "max") return Math.max(...finite);
  if (aggregation === "min") return Math.min(...finite);
  if (aggregation === "sum") return finite.reduce((total, value) => total + value, 0);
  if (aggregation === "avg") return finite.reduce((total, value) => total + value, 0) / finite.length;
  return finite.at(-1)!;
}

export type PointSensorReading = {
  channelId: string;
  deviceId: string;
  position: string | null;
  value: number | null;
  quality: "good" | "stale" | "bad" | "disabled";
  recordedAt: Date | null;
};

export type PointCondition = {
  status: "in_range" | "out_of_range" | "no_range" | "no_data";
  value: number | null;
  /** Sensor que define el valor del punto (el peor, si se combina por máximo o mínimo). */
  decisive: PointSensorReading | null;
  sensors: number;
  reporting: number;
  /** Cuánto se sale del rango (positivo = sobre el máximo, negativo = bajo el mínimo). */
  deviation: number | null;
};

/**
 * Condición instantánea de un punto a partir de las lecturas de su magnitud principal.
 * Solo cuentan las lecturas válidas y vigentes; la tolerancia (minutos fuera de rango antes de
 * alarmar) la aplica el motor de alarmas, no esta clasificación.
 */
export function classifyPoint(readings: PointSensorReading[], config: EffectivePointConfig): PointCondition {
  const valid = readings.filter((reading) => reading.quality === "good" && reading.value !== null && Number.isFinite(reading.value));
  // "Peor sensor" con rango: el que está más lejos del rango, hacia arriba o hacia abajo
  // (una cámara que se congela es tan grave como una que se calienta).
  if ((config.aggregation === "max" || config.aggregation === "min") && (config.rangeMin !== null || config.rangeMax !== null)) {
    const deviationOf = (value: number) => config.rangeMax !== null && value > config.rangeMax ? value - config.rangeMax : config.rangeMin !== null && value < config.rangeMin ? value - config.rangeMin : 0;
    const worstOutside = valid.filter((reading) => deviationOf(reading.value!) !== 0)
      .sort((left, right) => Math.abs(deviationOf(right.value!)) - Math.abs(deviationOf(left.value!)))[0];
    if (worstOutside) {
      return { value: worstOutside.value, decisive: worstOutside, sensors: readings.length, reporting: valid.length, status: "out_of_range", deviation: deviationOf(worstOutside.value!) };
    }
  }
  const value = aggregateValues(valid.map((reading) => reading.value!), config.aggregation);
  const decisive = value === null ? null
    : config.aggregation === "max" || config.aggregation === "min" || config.aggregation === "last"
      ? (config.aggregation === "last" ? valid.at(-1) : valid.find((reading) => reading.value === value)) ?? null
      : null;
  const base = { value, decisive, sensors: readings.length, reporting: valid.length };
  if (value === null) return { ...base, status: "no_data", deviation: null };
  if (config.rangeMin === null && config.rangeMax === null) return { ...base, status: "no_range", deviation: null };
  if (config.rangeMax !== null && value > config.rangeMax) return { ...base, status: "out_of_range", deviation: value - config.rangeMax };
  if (config.rangeMin !== null && value < config.rangeMin) return { ...base, status: "out_of_range", deviation: value - config.rangeMin };
  return { ...base, status: "in_range", deviation: 0 };
}

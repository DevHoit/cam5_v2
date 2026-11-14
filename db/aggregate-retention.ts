/**
 * Retención de reading_aggregates por resolución. El detalle fino se guarda menos tiempo
 * porque solo lo usan los periodos cortos; hora y día se guardan lo que indique el perfil
 * (aggregate_retention_days, 5 años por omisión). null = usar el valor del perfil.
 */
export const AGGREGATE_RETENTION_DAYS: Record<60 | 300 | 3600 | 86400, number | null> = {
  60: 30,
  300: 92,
  3600: null,
  86400: null,
};

export const DEFAULT_RAW_RETENTION_DAYS = 7;
export const DEFAULT_AGGREGATE_RETENTION_DAYS = 1825;

export type RetentionDays = { rawDays: number; aggregateDays: number };

/** Días que se conserva una resolución (0 = lecturas crudas). */
export function retentionDaysFor(bucketSeconds: number, retention: RetentionDays): number {
  if (bucketSeconds === 0) return retention.rawDays;
  const fixed = AGGREGATE_RETENTION_DAYS[bucketSeconds as keyof typeof AGGREGATE_RETENTION_DAYS];
  return fixed == null ? retention.aggregateDays : Math.min(fixed, retention.aggregateDays);
}

/** true si los datos de esa resolución ya cubren desde `from` (no se borraron por retención). */
export function resolutionCovers(bucketSeconds: number, from: Date, retention: RetentionDays, now: Date): boolean {
  return from.getTime() >= now.getTime() - retentionDaysFor(bucketSeconds, retention) * 86_400_000;
}

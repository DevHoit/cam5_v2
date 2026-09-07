export type CommissioningValidationInput = {
  serialNumber: string | null;
  firmwareVersion: string | null;
  dataVersion: number | null;
  registerCount: number;
  minimumRegister: number | null;
  maximumRegister: number | null;
  lastReadAt: Date | null;
  enabledChannelCount: number;
  configuredRuleCount: number;
  relayCount: number;
  snapshotCount: number;
  readingCount: number;
  validReadingCount: number;
  firstReadingAt: Date | null;
  lastReadingAt: Date | null;
};

export type CommissioningValidation = {
  itemKey: "identity" | "registers" | "alarms" | "relays" | "backup" | "stability";
  status: "passed" | "failed";
  evidence: Record<string, unknown>;
  message: string;
};

export const COMMISSIONING_CHECKLIST = [
  ["identity", "Identidad, serie, firmware y versión de datos confirmados"],
  ["registers", "Lectura FC03 completa del bloque 418–522"],
  ["inputs", "Bandas, códigos, antenas e índices contrastados en terreno"],
  ["clock", "Reloj y zona horaria sincronizados"],
  ["alarms", "Umbrales, persistencia e histéresis validados"],
  ["relays", "Seis salidas de relé probadas"],
  ["backup", "Respaldo inicial de configuración almacenado"],
  ["stability", "Histórico y calidad verificados durante 24 horas"],
] as const;

export function evaluateCommissioning(input: CommissioningValidationInput, validatedAt = new Date()): CommissioningValidation[] {
  const identityReady = Boolean(input.serialNumber?.trim() && input.firmwareVersion?.trim() && input.dataVersion !== null && Number.isInteger(input.dataVersion));
  const registerReady = input.registerCount === 105 && input.minimumRegister === 418 && input.maximumRegister === 522 && Boolean(input.lastReadAt);
  const alarmReady = input.enabledChannelCount > 0 && input.configuredRuleCount === input.enabledChannelCount;
  const relayReady = input.relayCount === 6;
  const backupReady = input.snapshotCount > 0;
  const stabilityHours = input.firstReadingAt && input.lastReadingAt ? Math.max(0, (input.lastReadingAt.getTime() - input.firstReadingAt.getTime()) / 3_600_000) : 0;
  const qualityPercent = input.readingCount ? Math.round(input.validReadingCount / input.readingCount * 10_000) / 100 : null;
  const stabilityReady = stabilityHours >= 24 && qualityPercent !== null && qualityPercent >= 99;
  const common = { validatedAt: validatedAt.toISOString(), source: "database" };
  return [
    {
      itemKey: "identity",
      status: identityReady ? "passed" : "failed",
      message: identityReady ? "Identidad completa leída desde el controlador." : "Faltan serie, firmware o versión de datos del CAM-5.",
      evidence: { ...common, serialNumber: input.serialNumber, firmwareVersion: input.firmwareVersion, dataVersion: input.dataVersion },
    },
    {
      itemKey: "registers",
      status: registerReady ? "passed" : "failed",
      message: registerReady ? "Mapa 418–522 completo y con lectura recibida." : "El mapa no está completo o todavía no existe una lectura válida del controlador.",
      evidence: { ...common, registerCount: input.registerCount, minimumRegister: input.minimumRegister, maximumRegister: input.maximumRegister, lastReadAt: input.lastReadAt?.toISOString() ?? null },
    },
    {
      itemKey: "alarms",
      status: alarmReady ? "passed" : "failed",
      message: alarmReady ? "Todos los canales habilitados tienen regla de alarma." : "Hay canales habilitados sin una regla de alarma completa.",
      evidence: { ...common, enabledChannelCount: input.enabledChannelCount, configuredRuleCount: input.configuredRuleCount },
    },
    {
      itemKey: "relays",
      status: relayReady ? "passed" : "failed",
      message: relayReady ? "Las seis salidas de relé están definidas." : "La matriz de seis relés está incompleta.",
      evidence: { ...common, relayCount: input.relayCount },
    },
    {
      itemKey: "backup",
      status: backupReady ? "passed" : "failed",
      message: backupReady ? "Existe un respaldo versionado de la configuración." : "Debe crearse el respaldo inicial desde Configuración.",
      evidence: { ...common, snapshotCount: input.snapshotCount },
    },
    {
      itemKey: "stability",
      status: stabilityReady ? "passed" : "failed",
      message: stabilityReady ? "Se verificaron 24 horas con al menos 99% de datos válidos." : "Aún no hay 24 horas de datos con calidad igual o superior a 99%.",
      evidence: { ...common, readingCount: input.readingCount, validReadingCount: input.validReadingCount, stabilityHours: Math.round(stabilityHours * 10) / 10, qualityPercent, firstReadingAt: input.firstReadingAt?.toISOString() ?? null, lastReadingAt: input.lastReadingAt?.toISOString() ?? null },
    },
  ];
}

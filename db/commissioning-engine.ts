export type CommissioningValidationInput = {
  deviceCode: string;
  gatewayOnline: boolean;
  configuredMetricCount: number;
  recentMetricCount: number;
  goodMetricCount: number;
  latestMetricAt: Date | null;
  capabilityCount: number;
};

export type CommissioningValidation = {
  itemKey: "identity" | "gateway" | "metrics" | "quality";
  status: "passed" | "failed";
  message: string;
  evidence: Record<string, unknown>;
};

export const COMMISSIONING_CHECKLIST = [
  ["identity", "Identidad y asociación del dispositivo"],
  ["gateway", "Gateway disponible"],
  ["metrics", "Métricas configuradas y recibidas"],
  ["quality", "Calidad de telemetría normalizada"],
  ["field", "Verificación física en terreno"],
] as const;

export function evaluateCommissioning(input: CommissioningValidationInput, validatedAt = new Date()): CommissioningValidation[] {
  const common = { validatedAt: validatedAt.toISOString() };
  const metricsReady = input.configuredMetricCount > 0 && input.recentMetricCount > 0 && Boolean(input.latestMetricAt);
  const qualityReady = input.recentMetricCount > 0 && input.goodMetricCount === input.recentMetricCount;
  return [
    { itemKey: "identity", status: input.deviceCode ? "passed" : "failed", message: input.deviceCode ? "Dispositivo identificado y asociado." : "Falta identidad del dispositivo.", evidence: { ...common, deviceCode: input.deviceCode, capabilityCount: input.capabilityCount } },
    { itemKey: "gateway", status: input.gatewayOnline ? "passed" : "failed", message: input.gatewayOnline ? "Gateway con comunicación reciente." : "El gateway no presenta comunicación reciente.", evidence: { ...common, gatewayOnline: input.gatewayOnline } },
    { itemKey: "metrics", status: metricsReady ? "passed" : "failed", message: metricsReady ? "Existen métricas normalizadas configuradas y recibidas." : "Faltan métricas configuradas o telemetría reciente.", evidence: { ...common, configuredMetricCount: input.configuredMetricCount, recentMetricCount: input.recentMetricCount, latestMetricAt: input.latestMetricAt?.toISOString() ?? null } },
    { itemKey: "quality", status: qualityReady ? "passed" : "failed", message: qualityReady ? "La telemetría reciente tiene calidad válida." : "Existen métricas sin calidad válida o aún no hay muestras.", evidence: { ...common, recentMetricCount: input.recentMetricCount, goodMetricCount: input.goodMetricCount } },
  ];
}

export type Cam5DataType = "Int16" | "UInt16";

export type Cam5OperationalChannel = {
  id: string;
  sourceId: string;
  label: string;
  zone: string;
  unit: string;
  metric: "temperature" | "ambient" | "humidity" | "pd" | "sd";
  warningDefault: number;
  criticalDefault: number;
  nativeRegister: number;
  configured: boolean;
};

export type Cam5RegisterDefinition = {
  register: number;
  reference: string;
  description: string;
  group: "Temperatura" | "Ambiente" | "Descarga" | "Diagnóstico" | "Tendencia" | "Sistema";
  dataType: Cam5DataType;
  scale: string;
  unit: string;
  errorCode: "0x8000" | "0xFFFF";
  minimum: string;
  maximum: string;
};

export type Cam5InputDefinition = {
  id: string;
  kind: "Temperatura SAW" | "Interfaz UHF" | "Humedad";
  location: string;
  enabled: boolean;
  register: string;
  assignment: string;
  calibration: string;
  signal: string;
};

const humanReference = (register: number) => `400${String(register).padStart(3, "0")}`;

const temperatureLabels = [
  ["Barra fase L1", "Barras principales"],
  ["Barra fase L2", "Barras principales"],
  ["Barra fase L3", "Barras principales"],
  ["Contacto superior", "Interruptor"],
  ["Contacto inferior", "Interruptor"],
  ["Entrada de cables L1", "Compartimiento de cables"],
  ["Entrada de cables L2", "Compartimiento de cables"],
  ["Entrada de cables L3", "Compartimiento de cables"],
  ["Salida de cables L1", "Compartimiento de cables"],
  ["Salida de cables L2", "Compartimiento de cables"],
  ["Salida de cables L3", "Compartimiento de cables"],
  ["Reserva térmica", "Sin asignar"],
] as const;

const temperatureChannels: Cam5OperationalChannel[] = temperatureLabels.map(([label, zone], index) => {
  const channel = index + 1;
  const configured = channel <= 5;
  return {
    id: `T${String(channel).padStart(2, "0")}`,
    sourceId: `TEMP-${String(channel).padStart(2, "0")}`,
    label,
    zone,
    unit: "°C",
    metric: "temperature",
    warningDefault: channel <= 3 ? 65 : 70,
    criticalDefault: channel <= 3 ? 75 : 80,
    nativeRegister: 417 + channel,
    configured,
  };
});

const dischargeLocations = ["Compartimiento de cables", "Barras principales", "Reserva UHF 03", "Reserva UHF 04"];

const surfaceDischargeChannels: Cam5OperationalChannel[] = Array.from({ length: 4 }, (_, index) => {
  const channel = index + 1;
  const configured = channel <= 2;
  return {
    id: `SD${channel}`,
    sourceId: `UHF-${String(channel).padStart(2, "0")}`,
    label: `Descarga superficial UHF ${String(channel).padStart(2, "0")}`,
    zone: dischargeLocations[index],
    unit: "idx",
    metric: "sd",
    warningDefault: 30,
    criticalDefault: 40,
    nativeRegister: 445 + channel,
    configured,
  };
});

const partialDischargeChannels: Cam5OperationalChannel[] = Array.from({ length: 4 }, (_, index) => {
  const channel = index + 1;
  const configured = channel <= 2;
  return {
    id: `PD${channel}`,
    sourceId: `UHF-${String(channel).padStart(2, "0")}`,
    label: `Descarga parcial UHF ${String(channel).padStart(2, "0")}`,
    zone: dischargeLocations[index],
    unit: "idx",
    metric: "pd",
    warningDefault: 40,
    criticalDefault: 60,
    nativeRegister: 449 + channel,
    configured,
  };
});

const humidityChannels: Cam5OperationalChannel[] = Array.from({ length: 8 }, (_, index) => {
  const channel = index + 1;
  const configured = channel === 1;
  return {
    id: `H${String(channel).padStart(2, "0")}`,
    sourceId: `HUM-${String(channel).padStart(2, "0")}`,
    label: channel === 1 ? "Ambiente de cabina" : `Humedad ambiental ${String(channel).padStart(2, "0")}`,
    zone: channel === 1 ? "Compartimiento de cables" : "Sin asignar",
    unit: "%RH",
    metric: "humidity",
    warningDefault: 75,
    criticalDefault: 85,
    nativeRegister: 429 + channel * 2,
    configured,
  };
});

const ambientChannels: Cam5OperationalChannel[] = Array.from({ length: 8 }, (_, index) => {
  const channel = index + 1;
  const configured = channel === 1;
  return {
    id: `A${String(channel).padStart(2, "0")}`,
    sourceId: `HUM-${String(channel).padStart(2, "0")}`,
    label: channel === 1 ? "Temperatura ambiente de cabina" : `Temperatura ambiente ${String(channel).padStart(2, "0")}`,
    zone: channel === 1 ? "Compartimiento de cables" : "Sin asignar",
    unit: "°C",
    metric: "ambient",
    warningDefault: 45,
    criticalDefault: 55,
    nativeRegister: 428 + channel * 2,
    configured,
  };
});

export const cam5OperationalChannels: Cam5OperationalChannel[] = [
  ...temperatureChannels,
  ...partialDischargeChannels,
  ...surfaceDischargeChannels,
  ...humidityChannels,
  ...ambientChannels,
];

const registerDefinition = (
  register: number,
  description: string,
  group: Cam5RegisterDefinition["group"],
  dataType: Cam5DataType,
  scale: string,
  unit: string,
  errorCode: Cam5RegisterDefinition["errorCode"],
  minimum: string,
  maximum: string,
): Cam5RegisterDefinition => ({ register, reference: humanReference(register), description, group, dataType, scale, unit, errorCode, minimum, maximum });

const temperatureRegisters = Array.from({ length: 12 }, (_, index) =>
  registerDefinition(418 + index, `Temperatura ${index + 1}`, "Temperatura", "Int16", "0.1", "°C", "0x8000", "-50.0", "167.5"),
);

const environmentRegisters = Array.from({ length: 8 }, (_, index) => [
  registerDefinition(430 + index * 2, `Temperatura ambiente ${index + 1}`, "Ambiente", "Int16", "0.1", "°C", "0x8000", "-40.0", "125.0"),
  registerDefinition(431 + index * 2, `Humedad relativa ${index + 1}`, "Ambiente", "UInt16", "0.1", "%RH", "0xFFFF", "0.0", "100.0"),
]).flat();

const dischargeTotalRegisters = [
  ...Array.from({ length: 4 }, (_, index) => registerDefinition(446 + index, `SD${index + 1} Total`, "Descarga", "UInt16", "×10 aprox.", "índice UHF", "0xFFFF", "0", "65534")),
  ...Array.from({ length: 4 }, (_, index) => registerDefinition(450 + index, `PD${index + 1} Total`, "Descarga", "UInt16", "×10 aprox.", "índice UHF", "0xFFFF", "0", "65534")),
];

const diagnosticRegisters = Array.from({ length: 12 }, (_, index) => {
  const port = index + 1;
  const start = 455 + index * 3;
  return [
    registerDefinition(start, `Ruido ${port}`, "Diagnóstico", "UInt16", "×10 aprox.", "índice UHF", "0xFFFF", "0", "65534"),
    registerDefinition(start + 1, `Superficial ${port}`, "Diagnóstico", "UInt16", "×10 aprox.", "índice UHF", "0xFFFF", "0", "65534"),
    registerDefinition(start + 2, `Interna ${port}`, "Diagnóstico", "UInt16", "×10 aprox.", "índice UHF", "0xFFFF", "0", "65534"),
  ];
}).flat();

const dischargeCountRegisters = [
  ...Array.from({ length: 4 }, (_, index) => registerDefinition(491 + index, `SD${index + 1} conteo`, "Diagnóstico", "UInt16", "1", "eventos", "0xFFFF", "0", "65534")),
  ...Array.from({ length: 4 }, (_, index) => registerDefinition(495 + index, `PD${index + 1} conteo`, "Diagnóstico", "UInt16", "1", "eventos", "0xFFFF", "0", "65534")),
];

const trendRegisters = ["Alpha", "Beta", "Phi"].flatMap((metric, metricIndex) => [
  ...Array.from({ length: 4 }, (_, index) => registerDefinition(499 + metricIndex * 8 + index, `${metric} SD ${index + 1}`, "Tendencia", "UInt16", "×10 aprox.", "índice UHF", "0xFFFF", "0", "65534")),
  ...Array.from({ length: 4 }, (_, index) => registerDefinition(503 + metricIndex * 8 + index, `${metric} PD ${index + 1}`, "Tendencia", "UInt16", "×10 aprox.", "índice UHF", "0xFFFF", "0", "65534")),
]);

export const cam5RegisterCatalog: Cam5RegisterDefinition[] = [
  ...temperatureRegisters,
  ...environmentRegisters,
  ...dischargeTotalRegisters,
  registerDefinition(454, "Versión de datos", "Sistema", "UInt16", "1", "versión", "0xFFFF", "0", "65534"),
  ...diagnosticRegisters,
  ...dischargeCountRegisters,
  ...trendRegisters,
].sort((a, b) => a.register - b.register);

export const cam5InputInventory: Cam5InputDefinition[] = [
  ...Array.from({ length: 12 }, (_, index) => {
    const channel = index + 1;
    const enabled = channel <= 5;
    return {
      id: `T${String(channel).padStart(2, "0")}`,
      kind: "Temperatura SAW" as const,
      location: temperatureLabels[index][0],
      enabled,
      register: `${418 + index}`,
      assignment: enabled ? `Banda ${channel} · Antena ${channel <= 3 ? 1 : 2}` : "Pendiente de asignación",
      calibration: enabled ? `Código ${String.fromCharCode(65 + index)}${(index % 9) + 1}` : "Sin código",
      signal: enabled ? (channel === 1 ? "Media · revisar" : "Buena") : "Sin lectura",
    };
  }),
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `UHF-${String(index + 1).padStart(2, "0")}`,
    kind: "Interfaz UHF" as const,
    location: dischargeLocations[index],
    enabled: index < 2,
    register: `${446 + index} / ${450 + index}`,
    assignment: index < 2 ? `Puerto ${index + 1} · ${index === 0 ? 600 : 300} MHz · 50 Hz` : "Puerto disponible",
    calibration: index < 2 ? "Referencia verificada" : "Sin calibrar",
    signal: index < 2 ? "Buena" : "Sin lectura",
  })),
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `HUM-${String(index + 1).padStart(2, "0")}`,
    kind: "Humedad" as const,
    location: index === 0 ? "Compartimiento de cables" : "Sin asignar",
    enabled: index === 0,
    register: `${430 + index * 2} / ${431 + index * 2}`,
    assignment: index === 0 ? `Índice ${index} · bus ambiental` : `Índice ${index} disponible`,
    calibration: index === 0 ? "Sensor identificado" : "No aplica",
    signal: index === 0 ? "En línea" : "Sin lectura",
  })),
];

export const cam5RelayDefaults = [
  { id: 1, name: "Alarma térmica", source: "Temperatura máxima", level: "Alarma", state: "Inactivo" },
  { id: 2, name: "Diferencial térmico", source: "Delta-T", level: "Alarma", state: "Inactivo" },
  { id: 3, name: "Descarga parcial", source: "PD total / Phi", level: "Alarma", state: "Activo" },
  { id: 4, name: "Descarga superficial", source: "SD total", level: "Alarma", state: "Inactivo" },
  { id: 5, name: "Ambiente", source: "Humedad / temperatura", level: "Advertencia", state: "Activo" },
  { id: 6, name: "Falla de comunicaciones", source: "Calidad / timeout", level: "Alarma", state: "Inactivo" },
] as const;

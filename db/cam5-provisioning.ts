import { eq } from "drizzle-orm";
import { cam5InputInventory, cam5OperationalChannels, cam5RelayDefaults } from "../app/cam5-model";
import { COMMISSIONING_CHECKLIST } from "./commissioning-engine";
import type { Cam5Database } from "./index";
import { alarmRules, channels, commissioningItems, physicalInputs, registerDefinitions, relayConfigurations } from "./schema";

type InputKind = typeof physicalInputs.$inferInsert.kind;
type ChannelMetric = typeof channels.$inferInsert.metric;
type Cam5Transaction = Parameters<Parameters<Cam5Database["transaction"]>[0]>[0];
export type Cam5Executor = Cam5Database | Cam5Transaction;

function inputKind(kind: (typeof cam5InputInventory)[number]["kind"]): InputKind {
  if (kind === "Temperatura SAW") return "temperature_saw";
  if (kind === "Interfaz UHF") return "uhf";
  return "humidity";
}

function channelMetric(metric: (typeof cam5OperationalChannels)[number]["metric"]): ChannelMetric {
  if (metric === "ambient") return "ambient_temperature";
  if (metric === "humidity") return "humidity";
  if (metric === "pd") return "partial_discharge";
  if (metric === "sd") return "surface_discharge";
  return "temperature";
}

function portNumber(code: string): number {
  const parsed = Number.parseInt(code.replace(/\D/g, ""), 10);
  if (!Number.isFinite(parsed)) throw new Error(`Código de entrada inválido: ${code}`);
  return parsed;
}

function physicalInputCode(sourceId: string): string {
  return sourceId.startsWith("TEMP-") ? `T${sourceId.slice(5)}` : sourceId;
}

/**
 * Crea la configuración operativa estándar de un controlador CAM5: 24 entradas físicas,
 * 36 canales con sus reglas de alarma, 6 relés y el checklist de puesta en marcha.
 * Es idempotente: no duplica ni sobrescribe lo que ya exista para el equipo.
 */
export async function provisionCam5Device(tx: Cam5Executor, device: { id: string; assetId: string; modelId: string }) {
  const registerRows = await tx.select().from(registerDefinitions).where(eq(registerDefinitions.modelId, device.modelId));
  if (registerRows.length !== 105) throw new Error(`El mapa CAM5 debe contener 105 registros; se encontraron ${registerRows.length}.`);
  const registersByNative = new Map(registerRows.map((register) => [register.nativeRegister, register]));

  for (const input of cam5InputInventory) {
    const band = input.assignment.match(/(\d+) MHz/)?.[1];
    const antenna = input.assignment.match(/Antena (\d+)/)?.[1];
    const humidityIndex = input.kind === "Humedad" ? portNumber(input.id) - 1 : null;
    await tx.insert(physicalInputs).values({
      deviceId: device.id,
      code: input.id,
      kind: inputKind(input.kind),
      portNumber: portNumber(input.id),
      enabled: input.enabled,
      assignment: input.assignment,
      zone: input.location,
      calibrationCode: input.calibration.startsWith("Código ") ? input.calibration.slice(7) : null,
      frequencyBand: band ? `${band} MHz` : null,
      antennaPort: antenna ? `Antena ${antenna}` : null,
      humidityIndex: humidityIndex === null ? null : String(humidityIndex),
      metadata: { registers: input.register, calibrationState: input.calibration, signalState: input.signal },
      updatedAt: new Date(),
    }).onConflictDoNothing({ target: [physicalInputs.deviceId, physicalInputs.code] });
  }
  const inputRows = await tx.select().from(physicalInputs).where(eq(physicalInputs.deviceId, device.id));
  if (inputRows.length !== 24) throw new Error(`El CAM5 debe contener 24 entradas; se encontraron ${inputRows.length}.`);
  const inputsByCode = new Map(inputRows.map((input) => [input.code, input]));

  for (const [displayOrder, channel] of cam5OperationalChannels.entries()) {
    const register = registersByNative.get(channel.nativeRegister);
    const input = inputsByCode.get(physicalInputCode(channel.sourceId));
    if (!register) throw new Error(`No existe el registro ${channel.nativeRegister} para ${channel.id}.`);
    if (!input) throw new Error(`No existe la entrada física ${channel.sourceId} para ${channel.id}.`);
    await tx.insert(channels).values({
      deviceId: device.id,
      assetId: device.assetId,
      physicalInputId: input.id,
      registerDefinitionId: register.id,
      code: channel.id,
      name: channel.label,
      zone: channel.zone,
      metric: channelMetric(channel.metric),
      unit: channel.unit,
      enabled: channel.configured,
      displayOrder,
      metadata: { sourceId: channel.sourceId },
    }).onConflictDoNothing({ target: [channels.deviceId, channels.code] });
  }
  const channelRows = await tx.select().from(channels).where(eq(channels.deviceId, device.id));
  if (channelRows.length !== 36) throw new Error(`El portal debe exponer 36 señales operativas; se encontraron ${channelRows.length}.`);
  const channelByCode = new Map(channelRows.map((channel) => [channel.code, channel]));

  for (const channel of cam5OperationalChannels) {
    const storedChannel = channelByCode.get(channel.id);
    if (!storedChannel) continue;
    await tx.insert(alarmRules).values({
      channelId: storedChannel.id,
      enabled: channel.configured,
      warningThreshold: String(channel.warningDefault),
      criticalThreshold: String(channel.criticalDefault),
      hysteresis: channel.metric === "humidity" ? "2" : channel.metric === "pd" || channel.metric === "sd" ? "5" : "1",
      activationSamples: 3,
      recoverySamples: 3,
      staleAfterSeconds: 180,
    }).onConflictDoNothing({ target: alarmRules.channelId });
  }

  for (const relay of cam5RelayDefaults) {
    await tx.insert(relayConfigurations).values({
      deviceId: device.id,
      relayNumber: relay.id,
      name: relay.name,
      sourceExpression: relay.source,
      severity: relay.level === "Advertencia" ? "warning" : "critical",
      enabled: relay.state === "Activo",
      failsafe: true,
    }).onConflictDoNothing({ target: [relayConfigurations.deviceId, relayConfigurations.relayNumber] });
  }

  for (const [itemKey, label] of COMMISSIONING_CHECKLIST) {
    await tx.insert(commissioningItems).values({ deviceId: device.id, itemKey, label, status: "pending" }).onConflictDoUpdate({
      target: [commissioningItems.deviceId, commissioningItems.itemKey],
      set: { label },
    });
  }

  return { inputs: inputRows.length, channels: channelRows.length };
}

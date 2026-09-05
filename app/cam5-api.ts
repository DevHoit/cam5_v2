export type ApiQuality = "good" | "stale" | "bad" | "disabled";
export type ApiSeverity = "normal" | "warning" | "critical";
export type AlarmStatus = "open" | "acknowledged" | "closed";

export type TelemetryReading = {
  channelId: string;
  sourceId: string;
  assetId: string;
  nativeRegister: number;
  value: number | null;
  rawValue: number | null;
  unit: string;
  severity: ApiSeverity;
  quality: ApiQuality;
  qualityFlags: Array<"restart" | "communication_lost" | "local_forced" | "remote_forced" | "over_range">;
  sourceTimestamp: string;
  receivedAt: string;
  sequence: number;
};

export type Cam5Device = {
  id: string;
  assetId: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  dataVersion: number;
  capabilities: {
    temperatureInputs: number;
    partialDischargeInputs: number;
    humidityInputs: number;
    relayOutputs: number;
  };
  connection: {
    protocol: "modbus_tcp" | "modbus_rtu";
    host?: string;
    port?: number;
    unitId: number;
    pollIntervalMs: number;
    timeoutMs: number;
    retries: number;
    registerConvention: "native" | "400xxx" | "gateway_remap";
  };
  network: {
    address: string;
    subnet: string;
    gateway: string;
    dns?: string;
    mac?: string;
    link: "up" | "down" | "unknown";
  };
  lastSeenAt?: string;
};

export type ChannelConfiguration = {
  id: string;
  sourceId: string;
  enabled: boolean;
  label: string;
  location: string;
  metric: "temperature" | "ambient" | "humidity" | "sd" | "pd" | "alpha" | "beta" | "phi" | "noise";
  nativeRegister: number;
  warningThreshold?: number;
  alarmThreshold?: number;
  recoveryDeadband?: number;
  activationSamples: number;
  recoverySamples: number;
  staleAfterSeconds: number;
};

export type RegisterDefinition = {
  nativeRegister: number;
  humanReference: string;
  description: string;
  functionCode: 3 | 4;
  dataType: "int16" | "uint16";
  scale: number;
  unit: string;
  errorCode: 0x8000 | 0xffff;
};

export type InputAssignment = {
  id: string;
  type: "saw_temperature" | "uhf" | "humidity";
  enabled: boolean;
  location: string;
  band?: number;
  calibrationCode?: string;
  antennaPort?: number;
  humidityIndex?: number;
  mainsFrequencyHz?: 50 | 60;
  signalQuality?: "good" | "marginal" | "bad" | "unknown";
};

export type AlarmRecord = {
  id: string;
  assetId: string;
  channelId: string;
  title: string;
  severity: "info" | "warning" | "critical";
  status: AlarmStatus;
  triggerValue: number;
  threshold?: number;
  consecutiveSamples: number;
  openedAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  closedAt?: string;
  note?: string;
};

export type RelayConfiguration = {
  relay: 1 | 2 | 3 | 4 | 5 | 6;
  name: string;
  enabled: boolean;
  sources: string[];
  triggerLevel: "warning" | "critical";
  energized: boolean;
};

export type WorkOrderRecord = {
  id: string;
  sourceAlarmId?: string;
  title: string;
  priority: "normal" | "high" | "critical";
  status: "pending" | "in_progress" | "completed";
  assigneeId: string;
  dueAt?: string;
};

export type CommissioningStatus = {
  deviceDiscovered: boolean;
  registerMapVerified: boolean;
  inputsVerified: boolean;
  clockSynchronized: boolean;
  alarmsAndRelaysVerified: boolean;
  initialBackupCreated: boolean;
  historyVerified: boolean;
  acceptedForProduction: boolean;
  checks: Array<{ id: string; status: "pending" | "passed" | "failed"; checkedAt?: string; checkedBy?: string; detail?: string }>;
};

export type ConfigurationSnapshot = {
  id: string;
  deviceId: string;
  version: number;
  status: "draft" | "validated" | "deployed" | "rejected";
  createdAt: string;
  createdBy: string;
  checksum?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_CAM5_API_URL ?? "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    credentials: "include",
  });
  if (!response.ok) throw new Error(`CAM5 API ${response.status}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const query = (values: Record<string, string | number | undefined>) => {
  const parameters = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined) parameters.set(key, String(value)); });
  return parameters.toString();
};

export const cam5Api = {
  health: () => request<{ status: "ok" | "degraded"; gateway: "online" | "offline"; timestamp: string }>("/health"),

  device: (deviceId: string) => request<Cam5Device>(`/devices/${deviceId}`),
  updateDevice: (deviceId: string, payload: Partial<Cam5Device>) => request<Cam5Device>(`/devices/${deviceId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  discoverDevice: (gatewayId: string) => request<Cam5Device>(`/gateways/${gatewayId}/devices/discover`, { method: "POST" }),
  testModbus: (deviceId: string) => request<{ ok: boolean; latencyMs: number; registerCount: number; exceptionCode?: number }>(`/devices/${deviceId}/modbus/test`, { method: "POST" }),

  registerCatalog: (deviceId: string) => request<RegisterDefinition[]>(`/devices/${deviceId}/registers`),
  latestReadings: (assetId: string) => request<TelemetryReading[]>(`/assets/${assetId}/readings/latest`),
  trend: (assetId: string, channelId: string, from: string, to: string, aggregation = "raw") => request<TelemetryReading[]>(`/assets/${assetId}/trends?${query({ channelId, from, to, aggregation })}`),
  history: (assetId: string, from: string, to: string, cursor?: string) => request<{ items: TelemetryReading[]; nextCursor?: string }>(`/assets/${assetId}/readings?${query({ from, to, cursor })}`),

  channels: (deviceId: string) => request<ChannelConfiguration[]>(`/devices/${deviceId}/channels`),
  updateChannels: (deviceId: string, channels: ChannelConfiguration[]) => request<ChannelConfiguration[]>(`/devices/${deviceId}/channels`, { method: "PUT", body: JSON.stringify({ channels }) }),
  inputAssignments: (deviceId: string) => request<InputAssignment[]>(`/devices/${deviceId}/inputs`),
  updateInputAssignments: (deviceId: string, inputs: InputAssignment[]) => request<InputAssignment[]>(`/devices/${deviceId}/inputs`, { method: "PUT", body: JSON.stringify({ inputs }) }),

  alarms: (status?: AlarmStatus) => request<AlarmRecord[]>(`/alarms${status ? `?status=${status}` : ""}`),
  acknowledgeAlarm: (alarmId: string, note?: string) => request<AlarmRecord>(`/alarms/${alarmId}/acknowledge`, { method: "POST", body: JSON.stringify({ note }) }),
  closeAlarm: (alarmId: string, note: string) => request<AlarmRecord>(`/alarms/${alarmId}/close`, { method: "POST", body: JSON.stringify({ note }) }),
  relayConfiguration: (deviceId: string) => request<RelayConfiguration[]>(`/devices/${deviceId}/relays`),
  updateRelays: (deviceId: string, relays: RelayConfiguration[]) => request<RelayConfiguration[]>(`/devices/${deviceId}/relays`, { method: "PUT", body: JSON.stringify({ relays }) }),

  commissioning: (deviceId: string) => request<CommissioningStatus>(`/devices/${deviceId}/commissioning`),
  updateCommissioningCheck: (deviceId: string, checkId: string, status: "passed" | "failed", detail?: string) => request<CommissioningStatus>(`/devices/${deviceId}/commissioning/checks/${checkId}`, { method: "PUT", body: JSON.stringify({ status, detail }) }),
  acceptForProduction: (deviceId: string) => request<CommissioningStatus>(`/devices/${deviceId}/commissioning/accept`, { method: "POST" }),

  configurationSnapshots: (deviceId: string) => request<ConfigurationSnapshot[]>(`/devices/${deviceId}/configuration/snapshots`),
  createConfigurationDraft: (deviceId: string, payload: unknown) => request<ConfigurationSnapshot>(`/devices/${deviceId}/configuration/drafts`, { method: "POST", body: JSON.stringify(payload) }),
  validateConfiguration: (deviceId: string, snapshotId: string) => request<ConfigurationSnapshot>(`/devices/${deviceId}/configuration/snapshots/${snapshotId}/validate`, { method: "POST" }),
  deployConfiguration: (deviceId: string, snapshotId: string) => request<ConfigurationSnapshot>(`/devices/${deviceId}/configuration/snapshots/${snapshotId}/deploy`, { method: "POST" }),
  createBackup: (deviceId: string) => request<ConfigurationSnapshot>(`/devices/${deviceId}/configuration/backups`, { method: "POST" }),
  logFiles: (deviceId: string) => request<Array<{ id: string; name: string; size: number; createdAt: string }>>(`/devices/${deviceId}/logs`),

  workOrders: () => request<WorkOrderRecord[]>("/work-orders"),
  createWorkOrder: (payload: Omit<WorkOrderRecord, "id">) => request<WorkOrderRecord>("/work-orders", { method: "POST", body: JSON.stringify(payload) }),
  updateWorkOrder: (id: string, payload: Partial<WorkOrderRecord>) => request<WorkOrderRecord>(`/work-orders/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
};

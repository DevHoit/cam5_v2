export type ApiQuality = "good" | "stale" | "bad" | "disabled";
export type ApiSeverity = "normal" | "warning" | "critical";
export type AlarmStatus = "open" | "acknowledged" | "resolved" | "closed";

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
  code: string;
  kind: "threshold" | "communication" | "data_quality";
  assetId: string;
  assetCode: string;
  assetName: string;
  channelId: string | null;
  channelCode: string | null;
  channelName: string | null;
  title: string;
  detail: string | null;
  severity: ApiSeverity;
  status: AlarmStatus;
  triggerValue: number | null;
  thresholdValue: number | null;
  unit: string | null;
  occurrenceCount: number;
  openedAt: string;
  lastObservedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  workOrder: { id: string; code: string; status: string } | null;
};

export type AlarmRuleRecord = {
  id: string;
  channelId: string;
  channelCode: string;
  channelName: string;
  zone: string | null;
  unit: string;
  assetId: string;
  enabled: boolean;
  warningThreshold: number;
  criticalThreshold: number;
  hysteresis: number;
  activationSamples: number;
  recoverySamples: number;
  staleAfterSeconds: number;
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

export type PortalRoleKey = "administrator" | "engineer" | "operator" | "viewer";

export type PortalAccessProfile = {
  id: string;
  key: PortalRoleKey;
  name: string;
  description: string;
  permissions: string[];
};

export type PortalUser = {
  id: string;
  email: string;
  displayName: string;
  status: "invited" | "active" | "suspended";
  roles: Array<{ role: PortalRoleKey; siteId: string; expiresAt?: string }>;
  assetScope?: string[];
  lastLoginAt?: string;
};

export type PortalSessionUser = {
  id: string;
  email: string;
  displayName: string;
  roleKey: PortalRoleKey;
  roleName: "Administrador" | "Ingeniero" | "Operador" | "Solo lectura";
  siteId: string;
  permissions: string[];
};

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ReadingProfile = {
  id: string;
  key: string;
  name: string;
  staleAfterSeconds: number;
  rawRetentionDays: number;
  aggregateRetentionDays: number;
  ranges: Array<{
    name: string;
    startRegister: number;
    endRegister: number;
    functionCode: 3 | 4;
    intervalMs: number;
    priority: number;
    enabled: boolean;
  }>;
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
  login: (email: string, password: string) => request<{ user: PortalSessionUser }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  session: () => request<{ user: PortalSessionUser }>("/auth/session"),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  myAccess: () => request<{ user: PortalUser; permissions: string[] }>("/me/access"),

  accessProfiles: () => request<PortalAccessProfile[]>("/roles"),
  users: (page = 1, pageSize = 10, q?: string, status?: string) => request<Paginated<PortalUser>>(`/users?${query({ page, pageSize, q, status })}`),
  createUser: (payload: { email: string; displayName: string; password: string; role: PortalRoleKey; status?: "active" | "suspended" | "invited" }) => request<PortalUser>("/users", { method: "POST", body: JSON.stringify(payload) }),
  updateUser: (userId: string, payload: { email?: string; displayName?: string; password?: string; role?: PortalRoleKey; status?: "active" | "suspended" | "invited" }) => request<PortalUser>(`/users/${userId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteUser: (userId: string) => request<void>(`/users/${userId}`, { method: "DELETE" }),
  databaseHistory: (tab: "measurements" | "alarms" | "audit", from: string, to: string, page = 1, pageSize = 10, q?: string, channel?: string) => request<Paginated<Record<string, unknown>>>(`/history?${query({ tab, from, to, page, pageSize, q, channel })}`),

  device: (deviceId: string) => request<Cam5Device>(`/devices/${deviceId}`),
  updateDevice: (deviceId: string, payload: Partial<Cam5Device>) => request<Cam5Device>(`/devices/${deviceId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  discoverDevice: (gatewayId: string) => request<Cam5Device>(`/gateways/${gatewayId}/devices/discover`, { method: "POST" }),
  testModbus: (deviceId: string) => request<{ ok: boolean; latencyMs: number; registerCount: number; exceptionCode?: number }>(`/devices/${deviceId}/modbus/test`, { method: "POST" }),
  readingProfiles: () => request<ReadingProfile[]>("/reading-profiles"),
  updateReadingProfile: (profileId: string, payload: Partial<ReadingProfile>) => request<ReadingProfile>(`/reading-profiles/${profileId}`, { method: "PATCH", body: JSON.stringify(payload) }),

  registerCatalog: (deviceId: string) => request<RegisterDefinition[]>(`/devices/${deviceId}/registers`),
  latestReadings: (assetId: string) => request<TelemetryReading[]>(`/assets/${assetId}/readings/latest`),
  trend: (assetId: string, channelId: string, from: string, to: string, aggregation = "raw") => request<TelemetryReading[]>(`/assets/${assetId}/trends?${query({ channelId, from, to, aggregation })}`),
  history: (assetId: string, from: string, to: string, cursor?: string) => request<{ items: TelemetryReading[]; nextCursor?: string }>(`/assets/${assetId}/readings?${query({ from, to, cursor })}`),

  channels: (deviceId: string) => request<ChannelConfiguration[]>(`/devices/${deviceId}/channels`),
  updateChannels: (deviceId: string, channels: ChannelConfiguration[]) => request<ChannelConfiguration[]>(`/devices/${deviceId}/channels`, { method: "PUT", body: JSON.stringify({ channels }) }),
  inputAssignments: (deviceId: string) => request<InputAssignment[]>(`/devices/${deviceId}/inputs`),
  updateInputAssignments: (deviceId: string, inputs: InputAssignment[]) => request<InputAssignment[]>(`/devices/${deviceId}/inputs`, { method: "PUT", body: JSON.stringify({ inputs }) }),

  alarms: (assetId: string, page = 1, pageSize = 10, status: AlarmStatus | "active" | "all" = "all", severity: ApiSeverity | "all" = "all", q?: string) => request<Paginated<AlarmRecord> & { summary: { critical: number; warning: number; resolved: number; unassigned: number; mttaMinutes: number } }>(`/alarms?${query({ assetId, page, pageSize, status, severity, q })}`),
  alarm: (alarmId: string) => request<{ item: AlarmRecord; events: Array<{ id: number; type: string; note: string | null; createdAt: string; actorName: string }>; workOrders: WorkOrderRecord[] }>(`/alarms/${alarmId}`),
  updateAlarm: (alarmId: string, action: "acknowledge" | "resolve" | "close" | "reopen" | "assign" | "add_note", payload?: { note?: string; assignedTo?: string | null }) => request<{ ok: true }>(`/alarms/${alarmId}`, { method: "PATCH", body: JSON.stringify({ action, ...payload }) }),
  createWorkOrderFromAlarm: (alarmId: string, assignedTo?: string | null) => request<{ item: WorkOrderRecord; existing: boolean }>(`/alarms/${alarmId}/work-order`, { method: "POST", body: JSON.stringify({ assignedTo }) }),
  alarmRules: (assetId: string, page = 1, pageSize = 10, q?: string, enabled?: "true" | "false" | "all") => request<Paginated<AlarmRuleRecord>>(`/alarm-rules?${query({ assetId, page, pageSize, q, enabled })}`),
  updateAlarmRule: (ruleId: string, payload: Partial<Pick<AlarmRuleRecord, "enabled" | "warningThreshold" | "criticalThreshold" | "hysteresis" | "activationSamples" | "recoverySamples" | "staleAfterSeconds">>) => request<{ item: AlarmRuleRecord }>(`/alarm-rules/${ruleId}`, { method: "PATCH", body: JSON.stringify(payload) }),
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

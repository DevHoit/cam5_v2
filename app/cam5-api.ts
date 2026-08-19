export type ApiQuality = "good" | "stale" | "bad" | "disabled";
export type ApiSeverity = "normal" | "warning" | "critical";

export type TelemetryReading = {
  channelId: string;
  assetId: string;
  value: number;
  unit: string;
  severity: ApiSeverity;
  quality: ApiQuality;
  sourceTimestamp: string;
  receivedAt: string;
  sequence: number;
};

export type AlarmRecord = {
  id: string;
  assetId: string;
  channelId: string;
  title: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "acknowledged" | "closed";
  openedAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  closedAt?: string;
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

const API_BASE = process.env.NEXT_PUBLIC_CAM5_API_URL ?? "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    credentials: "include",
  });
  if (!response.ok) throw new Error(`CAM5 API ${response.status}`);
  return response.json() as Promise<T>;
}

export const cam5Api = {
  health: () => request<{ status: "ok" | "degraded"; timestamp: string }>("/health"),
  latestReadings: (assetId: string) => request<TelemetryReading[]>(`/assets/${assetId}/readings/latest`),
  trend: (assetId: string, channelId: string, from: string, to: string) => request<TelemetryReading[]>(`/assets/${assetId}/trends?channelId=${channelId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  alarms: () => request<AlarmRecord[]>("/alarms"),
  acknowledgeAlarm: (alarmId: string, note?: string) => request<AlarmRecord>(`/alarms/${alarmId}/acknowledge`, { method: "POST", body: JSON.stringify({ note }) }),
  closeAlarm: (alarmId: string, note: string) => request<AlarmRecord>(`/alarms/${alarmId}/close`, { method: "POST", body: JSON.stringify({ note }) }),
  workOrders: () => request<WorkOrderRecord[]>("/work-orders"),
  createWorkOrder: (payload: Omit<WorkOrderRecord, "id">) => request<WorkOrderRecord>("/work-orders", { method: "POST", body: JSON.stringify(payload) }),
  updateWorkOrder: (id: string, payload: Partial<WorkOrderRecord>) => request<WorkOrderRecord>(`/work-orders/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
};

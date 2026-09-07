"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { AccountView } from "./account-view";
import { Cam5CommissioningView } from "./cam5-engineering";
import { DiagnosticsView as DatabaseDiagnosticsView } from "./diagnostics-view";
import { Pagination, useClientPagination } from "./pagination";
import { NotificationsView as DatabaseNotificationsView } from "./notifications-view";
import { ReportsView as DatabaseReportsView } from "./reports-view";
import { SettingsView as DatabaseSettingsView } from "./settings-view";
import { TrendsView } from "./trends-view";
import {
  IconActivity as Activity,
  IconAlertTriangle as AlertTriangle,
  IconBellRinging as BellRing,
  IconBolt as Zap,
  IconBuilding as Building2,
  IconBuildingFactory2 as Factory,
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconCircleCheck as CheckCircle2,
  IconCircuitCell as CircuitBoard,
  IconClipboardCheck as ClipboardCheck,
  IconClock as Clock3,
  IconDatabase as Database,
  IconDeviceFloppy as Save,
  IconDownload as Download,
  IconDroplet as Droplets,
  IconFileReport as FileReport,
  IconHistory as History,
  IconHierarchy3 as Hierarchy,
  IconKey as Key,
  IconLayoutDashboard as LayoutDashboard,
  IconMail as Mail,
  IconMapPin as MapPin,
  IconMenu2 as Menu,
  IconLogout as LogOut,
  IconPencil as Pencil,
  IconPlugConnected as PlugConnected,
  IconPlus as Plus,
  IconRadio as Radio,
  IconRefresh as Refresh,
  IconSearch as Search,
  IconServer as Server,
  IconSettings as Settings,
  IconShieldCheck as ShieldCheck,
  IconTemperature as Thermometer,
  IconTimeline as Timeline,
  IconTrash as Trash,
  IconTrendingUp as TrendingUp,
  IconUserPlus as UserPlus,
  IconUsers as Users,
  IconWifi as Wifi,
  IconX as X,
} from "@tabler/icons-react";

type View = "overview" | "cabinet" | "diagnostics" | "commissioning" | "trends" | "alarms" | "history" | "assets" | "reports" | "settings" | "users" | "notifications" | "account";
type Severity = "critical" | "warning" | "info";
type SensorState = "normal" | "warning" | "critical";
type HistoryTab = "measurements" | "alarms" | "audit";
type UserRole = "Administrador" | "Ingeniero" | "Operador" | "Solo lectura";
type AlarmWorkflowStatus = "open" | "acknowledged" | "resolved" | "closed";
type PortalAlarm = {
  id: string;
  code: string;
  kind: "threshold" | "communication" | "data_quality";
  severity: "normal" | "warning" | "critical";
  status: AlarmWorkflowStatus;
  title: string;
  detail: string | null;
  triggerValue: number | null;
  thresholdValue: number | null;
  openedAt: string;
  lastObservedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  occurrenceCount: number;
  assignedToId: string | null;
  assignedToName: string | null;
  assetId: string;
  assetCode: string;
  assetName: string;
  channelId: string | null;
  channelCode: string | null;
  channelName: string | null;
  unit: string | null;
};
type PortalAlarmEvent = { id: number; type: string; note: string | null; payload: Record<string, unknown>; createdAt: string; actorId: string | null; actorName: string };
type AlarmRuleRecord = {
  id: string;
  channelId: string;
  channelCode: string;
  channelName: string;
  zone: string | null;
  unit: string;
  assetId: string;
  assetCode: string;
  enabled: boolean;
  warningThreshold: number;
  criticalThreshold: number;
  hysteresis: number;
  activationSamples: number;
  recoverySamples: number;
  staleAfterSeconds: number;
  currentSeverity: "normal" | "warning" | "critical" | null;
  breachCount: number | null;
  recoveryCount: number | null;
  lastValue: number | null;
  lastQuality: string | null;
  lastEvaluatedAt: string | null;
};
type TrendWindow = { from: string; to: string };
type PortalSiteScope = { id: string; code: string; name: string; clientId: string; clientCode: string; clientName: string; roleKey: "administrator" | "engineer" | "operator" | "viewer"; roleName: UserRole };
type PortalSessionUser = {
  id: string;
  email: string;
  displayName: string;
  roleKey: "administrator" | "engineer" | "operator" | "viewer";
  roleName: UserRole;
  clientId: string;
  clientCode: string;
  clientName: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  sites: PortalSiteScope[];
  permissions: string[];
};
type PortalHierarchy = {
  active: { clientId: string; clientCode: string; clientName: string; siteId: string; siteCode: string; siteName: string };
  clients: Array<{ id: string; code: string; name: string; legalName: string | null; taxId: string | null; contactEmail: string | null; active: boolean; roleKey: PortalSessionUser["roleKey"]; roleName: UserRole }>;
  sites: Array<PortalSiteScope & { description: string | null; timezone: string; active: boolean; pointCount: number; gatewayCount: number; controllerCount: number }>;
  points: Array<{ id: string; siteId: string; code: string; name: string; area: string | null; type: string; nominalVoltageKv: number | null; state: "normal" | "warning" | "critical" | "offline" | "maintenance"; active: boolean }>;
  gateways: Array<{ id: string; siteId: string; code: string; name: string; serialNumber: string | null; softwareVersion: string | null; state: "pending" | "online" | "degraded" | "offline"; active: boolean; lastSeenAt: string | null; ipAddress: string | null }>;
  controllers: Array<{ id: string; pointId: string; gatewayId: string; code: string; name: string; model: string; serialNumber: string | null; state: string; active: boolean; protocol: string; host: string; port: number; unitId: number; lastReadAt: string | null }>;
};
type PortalLiveTelemetry = {
  serverTime: string;
  point: { id: string; code: string; name: string; area: string | null; nominalVoltageKv: number | null; state: PortalHierarchy["points"][number]["state"] };
  gateway: { id: string; code: string; name: string; state: PortalHierarchy["gateways"][number]["state"]; lastSeenAt: string | null } | null;
  device: { id: string; code: string; name: string; state: string; protocol: string; lastReadAt: string | null } | null;
  inputSummary: { total: number; enabled: number; assigned: number };
  staleAfterSeconds: number;
  items: Array<{
    id: string;
    code: string;
    name: string;
    zone: string | null;
    metric: string;
    unit: string;
    enabled: boolean;
    displayOrder: number;
    register: number;
    humanReference: string;
    physicalInputId: string | null;
    inputCode: string | null;
    inputKind: string | null;
    inputPort: number | null;
    inputAssignment: string | null;
    rawValue: number | null;
    value: number | null;
    quality: "good" | "stale" | "bad" | "disabled";
    qualityFlags: string[];
    recordedAt: string | null;
    receivedAt: string | null;
    sequence: number | null;
    warningThreshold: number | null;
    criticalThreshold: number | null;
    severity: SensorState;
  }>;
};
type PortalSensor = {
  id: string;
  sourceId: string;
  label: string;
  zone: string;
  value: string;
  numericValue: number | null;
  unit: string;
  type: string;
  metric: "temperature" | "ambient" | "humidity" | "pd" | "sd" | "other";
  state: SensorState;
  trend: string;
  threshold: string;
  warning: number | null;
  critical: number | null;
  nativeRegister: number;
  register: string;
  quality: string;
  enabled: boolean;
  displayOrder: number;
  recordedAt: string | null;
};
type PortalTelemetryState = { status: "preview" | "loading" | "ready" | "error"; data: PortalLiveTelemetry | null };
type PaginationMeta = { page: number; pageSize: number; total: number; totalPages: number };
type NoticeTone = "success" | "info" | "warning";
type SystemMode = "normal" | "loading" | "stale" | "offline";
type ConfirmRequest = { title: string; detail: string; confirmLabel: string; tone?: "default" | "danger"; onConfirm: () => void };

const FeedbackContext = createContext<(message: string, tone?: NoticeTone) => void>(() => undefined);
const useFeedback = () => useContext(FeedbackContext);
const ConfirmContext = createContext<(request: ConfirmRequest) => void>(() => undefined);
const useConfirm = () => useContext(ConfirmContext);
const RoleContext = createContext<UserRole>("Administrador");
const useActiveRole = () => useContext(RoleContext);
const TelemetryContext = createContext<PortalTelemetryState>({ status: "preview", data: null });

async function portalRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible completar la solicitud.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function downloadAuthenticatedCsv(path: string, fallbackName: string) {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible generar la exportación.");
  }
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatDateTime(value?: string | null) {
  if (!value) return "Sin acceso";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatRelativeTime(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `Hace ${seconds} s`;
  if (seconds < 3_600) return `Hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `Hace ${Math.round(seconds / 3_600)} h`;
  return `Hace ${Math.round(seconds / 86_400)} d`;
}

function alarmValue(alarm: PortalAlarm) {
  if (alarm.triggerValue === null) return "—";
  if (alarm.kind === "communication") return `${Math.round(alarm.triggerValue)} s`;
  return `${Number(alarm.triggerValue.toFixed(1))} ${alarm.unit || ""}`.trim();
}

function telemetryAge(recordedAt: string | null) {
  if (!recordedAt) return "Sin lecturas recibidas";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(recordedAt).getTime()) / 1000));
  if (seconds < 60) return `Actualizado hace ${seconds} s`;
  return `Actualizado hace ${Math.round(seconds / 60)} min`;
}

function formatTelemetryValue(value: number | null, unit: string) {
  if (value === null || !Number.isFinite(value)) return "—";
  return unit === "°C" || unit === "%RH" ? value.toFixed(1) : Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function useSensorData(override?: PortalTelemetryState) {
  const context = useContext(TelemetryContext);
  const telemetry = override ?? context;
  return (telemetry.data?.items ?? []).map<PortalSensor>((live) => {
    const presentation = live.metric === "temperature" ? { type: "Temperatura", metric: "temperature" as const }
      : live.metric === "ambient_temperature" ? { type: "Temperatura ambiente", metric: "ambient" as const }
        : live.metric === "humidity" ? { type: "Humedad", metric: "humidity" as const }
          : live.metric === "partial_discharge" ? { type: "Descarga parcial", metric: "pd" as const }
            : live.metric === "surface_discharge" ? { type: "Descarga superficial", metric: "sd" as const }
              : { type: "Señal CAM-5", metric: "other" as const };
    const activeThreshold = live.severity === "critical" ? live.criticalThreshold : live.warningThreshold;
    const quality = !live.enabled
      ? "Deshabilitado"
      : live.quality === "good"
        ? "Válida"
        : live.quality === "stale"
          ? "Atrasada"
          : live.quality === "bad"
            ? "Inválida"
            : telemetry.status === "loading"
              ? "Esperando datos"
              : "Sin comunicación";
    return {
      id: live.code,
      sourceId: live.inputCode ?? "Sin entrada",
      label: live.name,
      zone: live.zone ?? live.inputAssignment ?? "Sin asignar",
      value: formatTelemetryValue(live.value, live.unit),
      numericValue: live.value,
      unit: live.unit,
      ...presentation,
      enabled: live.enabled,
      warning: live.warningThreshold,
      critical: live.criticalThreshold,
      state: live.severity,
      threshold: activeThreshold === null ? "Sin umbral" : `${activeThreshold} ${live.unit}`,
      quality,
      trend: telemetryAge(live.recordedAt),
      nativeRegister: live.register,
      register: live.humanReference,
      displayOrder: live.displayOrder,
      recordedAt: live.recordedAt,
    };
  });
}

const navGroups = [
  {
    index: "01",
    label: "Supervisión",
    items: [
      { id: "overview" as View, label: "Resumen operativo", description: "Condición general", icon: LayoutDashboard },
      { id: "cabinet" as View, label: "Mapa de condición", description: "Sensores y cabina", icon: CircuitBoard },
    ],
  },
  {
    index: "02",
    label: "Diagnóstico",
    items: [
      { id: "diagnostics" as View, label: "Diagnóstico de comunicación", description: "Controlador, Modbus y gateway", icon: Radio },
      { id: "commissioning" as View, label: "Puesta en marcha", description: "Conectar y validar CAM-5", icon: ClipboardCheck },
      { id: "trends" as View, label: "Tendencias", description: "Evolución por canal", icon: History },
      { id: "alarms" as View, label: "Centro de alertas", description: "Triage y seguimiento", icon: BellRing, badge: "3" },
      { id: "history" as View, label: "Histórico", description: "Mediciones y trazabilidad", icon: Database },
    ],
  },
  {
    index: "03",
    label: "Gestión",
    items: [
      { id: "assets" as View, label: "Estructura operacional", description: "Clientes, sitios y medición", icon: Factory },
      { id: "reports" as View, label: "Reportes", description: "Informes y programación", icon: FileReport },
    ],
  },
  {
    index: "04",
    label: "Administración",
    items: [
      { id: "settings" as View, label: "Configuración", description: "Activo, Modbus y gateway", icon: Settings },
      { id: "users" as View, label: "Usuarios y roles", description: "Acceso y permisos", icon: Users },
      { id: "notifications" as View, label: "Notificaciones", description: "Canales y escalamiento", icon: Mail },
      { id: "account" as View, label: "Mi cuenta", description: "Perfil, contraseña y sesiones", icon: ShieldCheck },
    ],
  },
];

const viewTitles: Record<View, { title: string; description: string }> = {
  overview: { title: "Resumen de condición", description: "Estado predictivo de activos críticos en tiempo real." },
  cabinet: { title: "Mapa de condición", description: "Ubicación, lectura y estado de cada canal instrumentado." },
  diagnostics: { title: "Diagnóstico de comunicación", description: "Comprobación de la cadena Controlador → Gateway → HoitLive Core." },
  commissioning: { title: "Puesta en marcha CAM-5", description: "Identidad, entradas, registros, alarmas y controles previos a la conexión productiva." },
  trends: { title: "Tendencias", description: "Evolución térmica, descarga parcial y humedad ambiental." },
  alarms: { title: "Centro de alertas", description: "Triage operativo, reconocimiento y trazabilidad de eventos." },
  history: { title: "Histórico", description: "Mediciones, alarmas y cambios administrativos en una sola trazabilidad." },
  assets: { title: "Estructura operacional", description: "Clientes, sitios, puntos de medición, gateways y controladores asociados." },
  reports: { title: "Reportes", description: "Informes de condición, eventos y cumplimiento para operación y confiabilidad." },
  settings: { title: "Configuración", description: "Parámetros del activo, canales de adquisición y comunicaciones." },
  users: { title: "Usuarios y roles", description: "Control de acceso y permisos para la operación técnica." },
  notifications: { title: "Notificaciones", description: "Canales de entrega, reglas de escalamiento y trazabilidad." },
  account: { title: "Mi cuenta", description: "Perfil personal, credenciales y sesiones activas del portal." },
};

function StatusPill({ state, children }: { state: SensorState | Severity | "online" | "offline"; children: React.ReactNode }) {
  return <span className={`status-pill status-${state}`}><span className="status-dot" />{children}</span>;
}

function TableEmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="table-empty-state"><Search size={21} /><div><strong>{title}</strong><p>{detail}</p></div></div>;
}

function PermissionState({ area }: { area: string }) {
  return <section className="panel permission-state"><span><ShieldCheck size={26} /></span><div><span className="eyebrow">Acceso restringido</span><h2>Tu rol no puede administrar {area}</h2><p>Puedes consultar los módulos de supervisión. Un administrador debe realizar cambios en esta sección.</p></div></section>;
}

function MetricCard({
  label,
  value,
  unit,
  note,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
  tone: "blue" | "amber" | "red" | "green";
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-card-head">
        <span className="eyebrow">{label}</span>
        <span className="metric-icon"><Icon size={19} strokeWidth={2} /></span>
      </div>
      <div className="metric-value">{value}<span>{unit}</span></div>
      <p className="metric-note">{note}</p>
    </article>
  );
}

function sensorGroupState(items: PortalSensor[]): SensorState {
  const enabled = items.filter((item) => item.enabled);
  if (enabled.some((item) => item.state === "critical")) return "critical";
  if (enabled.some((item) => item.state === "warning")) return "warning";
  return "normal";
}

function sensorStateText(items: PortalSensor[]) {
  const enabled = items.filter((item) => item.enabled);
  if (!enabled.length) return "Sin canales habilitados";
  const critical = enabled.filter((item) => item.state === "critical").length;
  const warning = enabled.filter((item) => item.state === "warning").length;
  if (critical || warning) return [critical ? `${critical} crítico${critical === 1 ? "" : "s"}` : "", warning ? `${warning} advertencia${warning === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  return "Condición normal";
}

function SensorMarker({ sensor, selectedId, onSelect }: { sensor: PortalSensor; selectedId?: string; onSelect?: (id: string) => void }) {
  const unavailable = sensor.enabled && sensor.quality !== "Válida";
  const stateLabel = !sensor.enabled ? "No configurado" : unavailable ? sensor.quality : sensor.state === "critical" ? "Crítico" : sensor.state === "warning" ? "Advertencia" : "Normal";
  return (
    <button
      type="button"
      className={`sensor-marker ${!sensor.enabled ? "marker-disabled" : unavailable ? "marker-stale" : `marker-${sensor.state}`} ${selectedId === sensor.id ? "selected" : ""}`}
      aria-label={`${sensor.id}, ${sensor.label}, ${sensor.value} ${sensor.unit}, ${sensor.state}`}
      aria-pressed={selectedId === sensor.id}
      disabled={!sensor.enabled}
      onClick={() => onSelect?.(sensor.id)}
    >
      <span className="sensor-marker-top"><span className="sensor-marker-id">{sensor.id}</span><span className="sensor-marker-state"><i />{stateLabel}</span></span>
      <strong className="sensor-marker-value">{sensor.value}<small>{sensor.unit}</small></strong>
      <span className="sensor-marker-label">{sensor.label}</span>
    </button>
  );
}

function CabinetDiagram({ selectedId, onSelect }: { selectedId?: string; onSelect?: (id: string) => void }) {
  const telemetry = useContext(TelemetryContext).data;
  const sensors = useSensorData();
  const gatewayOnline = telemetry?.gateway?.state === "online";
  const zones = [...new Set(sensors.map((sensor) => sensor.zone))];
  return (
    <div className="condition-map" aria-label={`Mapa de condición de ${telemetry?.point.code ?? "punto de medición"}`}>
      <div className="condition-map-header"><span className="map-asset-icon"><CircuitBoard size={20} /></span><div><strong>{telemetry?.point.code ?? "Sin punto seleccionado"}</strong><small>{telemetry?.point.nominalVoltageKv ? `${telemetry.point.nominalVoltageKv} kV · ` : ""}{telemetry?.point.name ?? "Esperando contexto operacional"}</small></div><b>{telemetry?.device?.code ?? "Sin controlador"}</b></div>

      <div className="condition-map-zones">
        {zones.map((zone, index) => {
          const zoneSensors = sensors.filter((sensor) => sensor.zone === zone).sort((left, right) => left.displayOrder - right.displayOrder);
          const state = sensorGroupState(zoneSensors);
          const variables = [...new Set(zoneSensors.map((sensor) => sensor.type))].join(" · ");
          return <section className={`equipment-zone zone-${state}`} key={zone}>
            <header className="zone-header"><span className="zone-index">{String(index + 1).padStart(2, "0")}</span><div><h3>{zone}</h3><p>{variables}</p></div><span className={`zone-status ${state}`}><i />{sensorStateText(zoneSensors)}</span></header>
            <div className="zone-channel-grid">{zoneSensors.map((sensor) => <SensorMarker key={sensor.id} sensor={sensor} selectedId={selectedId} onSelect={onSelect} />)}</div>
          </section>;
        })}
        {!zones.length && <div className="condition-map-empty"><Database size={24} /><strong>Sin canales asignados</strong><p>Habilita y asigna canales a una zona desde Configuración.</p></div>}
      </div>

      <div className="condition-map-footer"><span><Wifi size={15} /><span><strong>{telemetry?.device?.name ?? "Controlador no configurado"}</strong><small>{telemetry?.device?.protocol.replaceAll("_", " ").toUpperCase() ?? "Sin protocolo"} · vía {telemetry?.gateway?.code ?? "sin gateway"} · {telemetryAge(telemetry?.device?.lastReadAt ?? null).toLowerCase()}</small></span></span><StatusPill state={gatewayOnline ? "online" : "offline"}>{gatewayOnline ? "En línea" : "Sin conexión"}</StatusPill></div>
    </div>
  );
}

function Overview({ onNavigate, onAcknowledge, activeAlarms, point }: { onNavigate: (view: View) => void; onAcknowledge: (id: string) => void; activeAlarms: PortalAlarm[]; point?: PortalHierarchy["points"][number] }) {
  type TrendPreview = { series: Array<{ code: string; name: string; unit: string; points: Array<{ timestamp: string; value: number | null }> }> };
  const telemetry = useContext(TelemetryContext).data;
  const sensors = useSensorData();
  const activeSensors = sensors.filter((sensor) => sensor.enabled);
  const activeInputCount = telemetry?.inputSummary.assigned ?? new Set(activeSensors.map((sensor) => sensor.sourceId).filter((source) => source !== "Sin entrada")).size;
  const totalInputCount = telemetry?.inputSummary.total ?? 0;
  const byHighestValue = (items: PortalSensor[]) => [...items].sort((left, right) => (right.numericValue ?? -Infinity) - (left.numericValue ?? -Infinity))[0];
  const temperature = byHighestValue(activeSensors.filter((sensor) => sensor.metric === "temperature" || sensor.metric === "ambient"));
  const partialDischarge = byHighestValue(activeSensors.filter((sensor) => sensor.metric === "pd"));
  const humidity = byHighestValue(activeSensors.filter((sensor) => sensor.metric === "humidity"));
  const conditionCounts = { critical: activeSensors.filter((sensor) => sensor.state === "critical").length, warning: activeSensors.filter((sensor) => sensor.state === "warning").length, normal: activeSensors.filter((sensor) => sensor.state === "normal").length };
  const conditionState: SensorState = conditionCounts.critical ? "critical" : conditionCounts.warning ? "warning" : "normal";
  const hasMeasurements = activeSensors.some((sensor) => sensor.recordedAt !== null);
  const severityRank: Record<PortalAlarm["severity"], number> = { critical: 3, warning: 2, normal: 1 };
  const priorityAlarm = [...activeAlarms].sort((left, right) => severityRank[right.severity] - severityRank[left.severity] || new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime())[0] ?? null;
  const prioritySensor = priorityAlarm?.channelCode ? activeSensors.find((sensor) => sensor.id === priorityAlarm.channelCode) : null;
  const secondaryFindings = activeSensors.filter((sensor) => sensor.state !== "normal" && sensor.id !== prioritySensor?.id).slice(0, 3);
  const [trendPreview, setTrendPreview] = useState<TrendPreview | null>(null);
  const trendCodes = [temperature?.id, partialDischarge?.id].filter(Boolean).join(",");

  useEffect(() => {
    if (!point?.id || !trendCodes) { Promise.resolve().then(() => setTrendPreview(null)); return; }
    let active = true;
    const load = async () => {
      const to = new Date();
      const params = new URLSearchParams({ assetId: point.id, channels: trendCodes, from: new Date(to.getTime() - 24 * 3600_000).toISOString(), to: to.toISOString(), resolution: "3600" });
      try { const result = await portalRequest<TrendPreview>(`/api/v1/trends?${params}`); if (active) setTrendPreview(result); }
      catch { if (active) setTrendPreview(null); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [point?.id, trendCodes]);

  const normalizedSeries = (seriesIndex: number) => {
    const values = trendPreview?.series[seriesIndex]?.points.map((sample) => sample.value).filter((value): value is number => value !== null) ?? [];
    if (!values.length) return [];
    const minimum = Math.min(...values); const maximum = Math.max(...values); const span = Math.max(maximum - minimum, 1);
    return values.map((value) => Math.round(18 + (value - minimum) / span * 76));
  };
  const firstSeries = normalizedSeries(0); const secondSeries = normalizedSeries(1); const barCount = Math.max(firstSeries.length, secondSeries.length);
  const pointRecord = telemetry?.point ?? point;
  const gatewayOnline = telemetry?.gateway?.state === "online";
  const overallState: SensorState | "offline" = gatewayOnline && hasMeasurements ? conditionState : "offline";
  const noAlarmTitle = overallState === "offline" ? "Telemetría no disponible" : "No hay eventos activos";
  const noAlarmDetail = overallState === "offline" ? "El resumen espera una lectura válida del gateway y del controlador." : "Las reglas no registran condiciones abiertas para este punto.";

  return <>
    <section className="metrics-grid">
      <MetricCard label="Temperatura máxima" value={temperature?.value ?? "—"} unit={temperature?.unit} note={temperature ? `${temperature.id} · ${temperature.trend}` : "Sin lecturas térmicas"} tone={!temperature || temperature.numericValue === null ? "amber" : temperature.state === "critical" ? "red" : temperature.state === "warning" ? "amber" : "green"} icon={Thermometer} />
      <MetricCard label="Descarga parcial" value={partialDischarge?.value ?? "—"} unit={partialDischarge?.unit} note={partialDischarge ? `${partialDischarge.id} · ${partialDischarge.trend}` : "Sin canal habilitado"} tone={!partialDischarge || partialDischarge.numericValue === null ? "amber" : partialDischarge.state === "critical" ? "red" : partialDischarge.state === "warning" ? "amber" : "green"} icon={Activity} />
      <MetricCard label="Humedad relativa" value={humidity?.value ?? "—"} unit={humidity?.unit} note={humidity ? `${humidity.id} · ${humidity.trend}` : "Sin canal habilitado"} tone={!humidity || humidity.numericValue === null ? "amber" : humidity.state === "critical" ? "red" : humidity.state === "warning" ? "amber" : "blue"} icon={Droplets} />
      <MetricCard label="Entradas supervisadas" value={`${activeInputCount}/${totalInputCount || 0}`} note={`${activeSensors.length} de ${sensors.length} señales habilitadas`} tone={gatewayOnline ? "green" : "amber"} icon={Server} />
    </section>

    <section className="overview-grid">
      <article className="panel asset-summary-panel">
        <div className="panel-header asset-summary-header"><div><span className="eyebrow">Punto de medición activo</span><h2>{pointRecord ? `${pointRecord.code} · ${pointRecord.name}` : "Punto sin seleccionar"}</h2><p>{pointRecord?.nominalVoltageKv ? `${pointRecord.nominalVoltageKv} kV · ` : ""}{telemetry?.point.area || "Ubicación no informada"}</p></div><StatusPill state={overallState}>{overallState === "offline" ? "Esperando telemetría" : overallState === "critical" ? "Atención crítica" : overallState === "warning" ? "Requiere atención" : "Condición normal"}</StatusPill></div>
        <div className="asset-summary-body">
          <section className={`primary-finding finding-${priorityAlarm?.severity ?? (overallState === "offline" ? "offline" : "normal")}`} aria-label="Hallazgo de mayor prioridad">
            <div className="finding-heading"><span className="finding-icon">{priorityAlarm || overallState === "offline" ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}</span><div><span>{priorityAlarm ? "Evento de mayor prioridad" : "Condición consolidada"}</span><h3>{priorityAlarm?.title ?? noAlarmTitle}</h3><p>{priorityAlarm ? `${priorityAlarm.channelCode ?? "Comunicación"} · ${prioritySensor?.zone ?? priorityAlarm.assetCode} · ${formatRelativeTime(priorityAlarm.openedAt)}` : noAlarmDetail}</p></div><strong>{priorityAlarm ? alarmValue(priorityAlarm) : overallState === "offline" ? "—" : "OK"}</strong></div>
            <div className="finding-evidence"><div><span>Lectura actual</span><strong>{prioritySensor ? `${prioritySensor.value} ${prioritySensor.unit}` : priorityAlarm ? alarmValue(priorityAlarm) : "Sin hallazgos"}</strong></div><div><span>Umbral aplicable</span><strong>{prioritySensor?.threshold ?? "No aplica"}</strong></div><div><span>Observaciones</span><strong>{priorityAlarm?.occurrenceCount ?? 0}</strong></div></div>
            <div className="finding-action"><ShieldCheck size={17} /><p><strong>{priorityAlarm ? "Detalle registrado:" : "Supervisión activa:"}</strong> {priorityAlarm?.detail ?? "el estado se recalcula con cada paquete de telemetría recibido."}</p></div>
          </section>
          <aside className="condition-summary" aria-label="Resumen de canales"><div className="condition-summary-title"><div><span className="eyebrow">Estado actual</span><h3>{activeSensors.length} canales supervisados</h3></div><span className={gatewayOnline ? "online-mini" : "online-mini offline"}><i />{gatewayOnline ? "Datos sincronizados" : "Sin comunicación"}</span></div><div className="condition-counts"><div className="count-critical"><strong>{conditionCounts.critical}</strong><span>Crítico</span></div><div className="count-warning"><strong>{conditionCounts.warning}</strong><span>Advertencia</span></div><div className="count-normal"><strong>{conditionCounts.normal}</strong><span>Normal</span></div></div><div className="secondary-findings">{secondaryFindings.map((sensor) => <div key={sensor.id}><span className={`sensor-code sensor-${sensor.state}`}>{sensor.id}</span><p><strong>{sensor.value} {sensor.unit}</strong><small>{sensor.zone}</small></p><b>{sensor.threshold}</b></div>)}{!secondaryFindings.length && <div className="secondary-empty"><CheckCircle2 size={17} /><p><strong>Sin hallazgos secundarios</strong><small>Todos los demás canales están normales.</small></p></div>}</div></aside>
        </div>
        <div className="asset-summary-footer"><span><Wifi size={15} /> {telemetry?.gateway?.code ?? "Sin gateway"} · {telemetryAge(telemetry?.gateway?.lastSeenAt ?? null)}</span><button onClick={() => onNavigate("cabinet")}>Revisar condición del activo <ChevronRight size={16} /></button></div>
      </article>

      <article className="panel alarms-panel"><div className="panel-header compact"><div><span className="eyebrow">Triage</span><h2>Alarmas activas</h2></div><button className="icon-button" aria-label="Abrir centro de alertas" onClick={() => onNavigate("alarms")}><BellRing size={18} /></button></div><div className="alarm-list">{activeAlarms.slice(0, 3).map((alarm) => <div className={`alarm-item alarm-${alarm.severity}`} key={alarm.id}><div className="alarm-indicator"><AlertTriangle size={17} /></div><div className="alarm-copy"><strong>{alarm.title}</strong><span>{alarm.detail || `${alarm.assetCode} · ${alarm.channelCode ?? "Comunicación"}`}</span><small>{formatRelativeTime(alarm.openedAt)}</small></div><div className="alarm-side"><b>{alarmValue(alarm)}</b>{alarm.status === "open" ? <button onClick={() => onAcknowledge(alarm.id)}>Reconocer</button> : <small>Reconocida</small>}</div></div>)}{activeAlarms.length === 0 && <TableEmptyState title="Sin alarmas activas" detail="No existen eventos abiertos o reconocidos para el punto seleccionado." />}</div><button className="text-action" onClick={() => onNavigate("alarms")}>Ver todas las alertas <span>→</span></button></article>
    </section>

    <section className="lower-grid">
      <article className="panel trend-preview"><div className="panel-header compact"><div><span className="eyebrow">Últimas 24 horas</span><h2>Tendencias prioritarias</h2></div><StatusPill state={overallState}>{trendPreview?.series.length ? `${trendPreview.series.length} series` : "Sin histórico"}</StatusPill></div>{barCount ? <div className="mini-chart" aria-label="Histórico real de los canales prioritarios">{Array.from({ length: barCount }, (_, index) => <span key={index}><i style={{ height: `${firstSeries[index] ?? 0}%` }} /><b style={{ height: `${secondSeries[index] ?? 0}%` }} /></span>)}</div> : <div className="trend-preview-empty"><Database size={22} /><span>El gráfico aparecerá cuando PostgreSQL tenga muestras del periodo.</span></div>}<div className="chart-legend">{trendPreview?.series.map((series, index) => <span key={series.code}><i className={index === 0 ? "legend-temp" : "legend-pd"} />{series.code} · {series.name}</span>)}<button onClick={() => onNavigate("trends")}>Analizar tendencia</button></div></article>
      <article className="panel connection-panel"><div className="panel-header compact"><div><span className="eyebrow">Comunicaciones</span><h2>Estado de adquisición</h2></div><Radio size={20} className="brand-icon" /></div><div className={`connection-score connection-${gatewayOnline ? "online" : "offline"}`}><strong>{gatewayOnline ? "En línea" : "Pendiente"}</strong><span>{telemetry?.gateway?.name ?? "Gateway no configurado"}</span></div><dl className="connection-stats"><div><dt>Último gateway</dt><dd>{telemetryAge(telemetry?.gateway?.lastSeenAt ?? null)}</dd></div><div><dt>Última lectura</dt><dd>{telemetryAge(telemetry?.device?.lastReadAt ?? null)}</dd></div><div><dt>Dato atrasado desde</dt><dd>{telemetry?.staleAfterSeconds ?? 30} s</dd></div></dl><div className="freshness"><span style={{ width: gatewayOnline ? "100%" : "0%" }} /></div></article>
    </section>
  </>;
}

function CabinetView({ onOpenTrend }: { onOpenTrend: (id: string) => void }) {
  const telemetryState = useContext(TelemetryContext);
  const telemetry = telemetryState.data;
  const sensors = useSensorData();
  const activeSensors = sensors.filter((sensor) => sensor.enabled);
  const [selectedId, setSelectedId] = useState("");
  const selected = activeSensors.find((sensor) => sensor.id === selectedId) ?? activeSensors[0] ?? null;
  const hasMeasurements = activeSensors.some((sensor) => sensor.recordedAt !== null);
  const conditionState = sensorGroupState(activeSensors);
  const overallState: SensorState | "offline" = telemetry?.gateway?.state === "online" && hasMeasurements ? conditionState : "offline";
  const totalInputs = telemetry?.inputSummary.total ?? 0;
  const assignedInputs = telemetry?.inputSummary.assigned ?? new Set(activeSensors.map((sensor) => sensor.sourceId).filter((source) => source !== "Sin entrada")).size;
  const disabledChannels = sensors.length - activeSensors.length;
  const SelectedIcon = selected && (selected.metric === "temperature" || selected.metric === "ambient") ? Thermometer : selected?.metric === "humidity" ? Droplets : Activity;
  const selectedDisplayState: SensorState | "offline" = selected?.quality === "Válida" ? selected.state : "offline";
  const selectedStateLabel = selected?.quality === "Válida" ? selected.state === "critical" ? "Crítico" : selected.state === "warning" ? "Advertencia" : "Normal" : selected?.quality ?? "Sin lectura";
  const statusText = telemetryState.status === "loading" ? "Cargando canales" : !activeSensors.length ? "Sin canales activos" : telemetry?.gateway?.state !== "online" ? "Sin comunicación" : !hasMeasurements ? "Esperando lecturas" : sensorStateText(activeSensors);

  return (
    <section className="cabinet-view-grid">
      <article className="panel cabinet-full-panel">
        <div className="panel-header"><div><span className="eyebrow">Mapa de condición de la cabina</span><h2>{telemetry?.point ? `${telemetry.point.code} · ${telemetry.point.name}` : "Punto de medición"}</h2><p>{assignedInputs} entradas asignadas · {Math.max(0, totalInputs - assignedInputs)} disponibles · {activeSensors.length} señales activas{disabledChannels ? ` · ${disabledChannels} deshabilitadas` : ""}</p></div><StatusPill state={overallState}>{statusText}</StatusPill></div>
        <CabinetDiagram selectedId={selected?.id} onSelect={setSelectedId} />
        <div className="diagram-legend"><span><i className="dot-normal" />Normal</span><span><i className="dot-warning" />Advertencia</span><span><i className="dot-critical" />Crítico</span><span><i className="dot-disabled" />No configurado</span><small>Selecciona una tarjeta para revisar el canal.</small></div>
      </article>
      <article className="panel sensor-panel">
        {selected ? <div className={`selected-sensor-card selected-${selectedDisplayState}`}>
          <div className="selected-sensor-head"><span className="selected-sensor-icon"><SelectedIcon size={21} /></span><div><small>Canal seleccionado</small><strong>{selected.id} · {selected.type}</strong></div><StatusPill state={selectedDisplayState}>{selectedStateLabel}</StatusPill></div>
          <div className="selected-sensor-value">{selected.value}<span>{selected.unit}</span></div>
          <p>{selected.label} · {selected.zone}</p>
          <dl><div><dt>Actualización</dt><dd>{selected.trend}</dd></div><div><dt>Umbral</dt><dd>{selected.threshold}</dd></div><div><dt>Registro CAM-5</dt><dd>{selected.nativeRegister} · {selected.register}</dd></div><div><dt>Calidad</dt><dd>{selected.quality}</dd></div></dl>
          <button type="button" onClick={() => onOpenTrend(selected.id)}>Abrir tendencia del canal <TrendingUp size={16} /></button>
        </div> : <div className="selected-sensor-empty"><Database size={25} /><strong>{telemetryState.status === "loading" ? "Cargando canales" : "No hay canales habilitados"}</strong><p>{telemetryState.status === "error" ? "No fue posible consultar la telemetría. Revisa la conexión con el servidor." : "Configura al menos un canal para habilitar su lectura y tendencia."}</p></div>}
        <div className="panel-header compact sensor-list-header"><div><span className="eyebrow">Canales configurados</span><h2>Matriz de sensores</h2></div><span className="data-fresh"><Wifi size={14} /> {telemetryAge(telemetry?.device?.lastReadAt ?? null)}</span></div>
        <div className="sensor-list">
          {activeSensors.map((sensor) => (
            <button type="button" className={`sensor-row ${!sensor.enabled ? "disabled" : ""} ${selected?.id === sensor.id ? "selected" : ""}`} key={sensor.id} onClick={() => setSelectedId(sensor.id)} disabled={!sensor.enabled}>
              <span className={`sensor-code sensor-${sensor.state}`}>{sensor.id}</span>
              <div><strong>{sensor.label}</strong><small>{sensor.zone}</small></div>
              <div className="sensor-reading"><strong>{sensor.value}<small>{sensor.unit}</small></strong><span>{sensor.trend}</span></div>
            </button>
          ))}
          {!activeSensors.length && <div className="sensor-list-empty">No existen canales activos para este punto.</div>}
        </div>
      </article>
    </section>
  );
}

function AlarmsView({ assetId, permissions, onSummaryChange, onOpenTrend }: { assetId: string; permissions: string[]; onSummaryChange: (summary: { critical: number; warning: number }) => void; onOpenTrend: (channelId: string, openedAt: string) => void }) {
  const notify = useFeedback();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"events" | "rules">("events");
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<"all" | PortalAlarm["severity"]>("all");
  const [workflowStatus, setWorkflowStatus] = useState<"all" | AlarmWorkflowStatus>("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<(PaginationMeta & { items: PortalAlarm[]; summary: { critical: number; warning: number; resolved: number; unassigned: number; mttaMinutes: number }; assignees: Array<{ id: string; name: string }> }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [events, setEvents] = useState<PortalAlarmEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [ruleQuery, setRuleQuery] = useState("");
  const [ruleEnabled, setRuleEnabled] = useState<"all" | "true" | "false">("all");
  const [rulePage, setRulePage] = useState(1);
  const [ruleResult, setRuleResult] = useState<(PaginationMeta & { items: AlarmRuleRecord[]; summary: { total: number; enabled: number; evaluating: number; critical: number } }) | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, Pick<AlarmRuleRecord, "enabled" | "warningThreshold" | "criticalThreshold" | "hysteresis" | "activationSamples" | "recoverySamples" | "staleAfterSeconds">>>({});
  const [ruleLoading, setRuleLoading] = useState(false);
  const [savingRule, setSavingRule] = useState("");
  const canOperate = permissions.includes("alarms.acknowledge");
  const canClose = permissions.includes("alarms.close");
  const canConfigure = permissions.includes("settings.write");

  const loadAlarms = async (silent = false) => {
    if (!assetId) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ assetId, page: String(page), pageSize: "8", status: workflowStatus, severity });
      if (query.trim()) params.set("q", query.trim());
      const data = await portalRequest<PaginationMeta & { items: PortalAlarm[]; summary: { critical: number; warning: number; resolved: number; unassigned: number; mttaMinutes: number }; assignees: Array<{ id: string; name: string }> }>(`/api/v1/alarms?${params}`);
      setResult(data);
      onSummaryChange({ critical: data.summary.critical, warning: data.summary.warning });
      setSelectedId((current) => data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar las alarmas.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadAlarms(), 250);
    const polling = window.setInterval(() => void loadAlarms(true), 30_000);
    return () => { window.clearTimeout(timeout); window.clearInterval(polling); };
    // La recarga depende únicamente de los filtros visibles y del punto activo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, page, query, severity, workflowStatus]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    Promise.resolve()
      .then(() => { if (active) setDetailLoading(true); })
      .then(() => portalRequest<{ events: PortalAlarmEvent[] }>(`/api/v1/alarms/${encodeURIComponent(selectedId)}`))
      .then((data) => { if (active) setEvents(data.events); })
      .catch(() => { if (active) setEvents([]); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  const loadRules = async () => {
    if (!assetId) return;
    setRuleLoading(true);
    try {
      const params = new URLSearchParams({ assetId, page: String(rulePage), pageSize: "10", enabled: ruleEnabled });
      if (ruleQuery.trim()) params.set("q", ruleQuery.trim());
      const data = await portalRequest<PaginationMeta & { items: AlarmRuleRecord[]; summary: { total: number; enabled: number; evaluating: number; critical: number } }>(`/api/v1/alarm-rules?${params}`);
      setRuleResult(data);
      setRuleDrafts(Object.fromEntries(data.items.map((rule) => [rule.id, {
        enabled: rule.enabled,
        warningThreshold: rule.warningThreshold,
        criticalThreshold: rule.criticalThreshold,
        hysteresis: rule.hysteresis,
        activationSamples: rule.activationSamples,
        recoverySamples: rule.recoverySamples,
        staleAfterSeconds: rule.staleAfterSeconds,
      }])));
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No fue posible cargar las reglas.", "warning");
    } finally {
      setRuleLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== "rules") return;
    const timeout = window.setTimeout(() => void loadRules(), 250);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, ruleEnabled, rulePage, ruleQuery, tab]);

  const selected = result?.items.find((alarm) => alarm.id === selectedId) ?? null;
  const statusText = (status: AlarmWorkflowStatus) => status === "open" ? "Abierta" : status === "acknowledged" ? "Reconocida" : status === "resolved" ? "Atendida" : "Cerrada";
  const eventText = (type: string) => ({
    opened: "Alarma creada por el motor de reglas",
    observed: "Condición observada nuevamente",
    acknowledged: "Evento reconocido",
    resolved_automatically: "Condición normalizada automáticamente",
    resolved_manually: "Marcada como atendida",
    resolved_rule_disabled: "Atendida al desactivar la regla",
    closed: "Evento cerrado",
    reopened_automatically: "Evento reabierto por recurrencia",
    reopened_manually: "Evento reabierto manualmente",
    assigned: "Responsable asignado",
    unassigned: "Responsable eliminado",
    note_added: "Nota operativa agregada",
    work_order_created: "Orden de trabajo vinculada",
    escalated: "Severidad escalada",
    source_changed: "Origen de la alarma actualizado",
  }[type] ?? type.replaceAll("_", " "));

  const updateAlarm = async (action: string, body: Record<string, unknown> = {}) => {
    if (!selected) return;
    setBusyAction(action);
    try {
      await portalRequest(`/api/v1/alarms/${encodeURIComponent(selected.id)}`, { method: "PATCH", body: JSON.stringify({ action, ...body }) });
      notify(action === "add_note" ? "Nota agregada a la trazabilidad." : `Alarma ${selected.code} actualizada.`);
      setNoteInput("");
      await loadAlarms(true);
      const detail = await portalRequest<{ events: PortalAlarmEvent[] }>(`/api/v1/alarms/${encodeURIComponent(selected.id)}`);
      setEvents(detail.events);
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No fue posible actualizar la alarma.", "warning");
    } finally {
      setBusyAction("");
    }
  };

  const updateRuleDraft = (id: string, key: keyof (typeof ruleDrafts)[string], value: number | boolean) => setRuleDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
  const saveRule = async (rule: AlarmRuleRecord) => {
    const draft = ruleDrafts[rule.id];
    if (!draft) return;
    setSavingRule(rule.id);
    try {
      await portalRequest(`/api/v1/alarm-rules/${encodeURIComponent(rule.id)}`, { method: "PATCH", body: JSON.stringify(draft) });
      notify(`Regla de ${rule.channelCode} guardada.`);
      await loadRules();
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No fue posible guardar la regla.", "warning");
    } finally {
      setSavingRule("");
    }
  };

  if (!assetId) return <article className="panel"><TableEmptyState title="Selecciona un punto de medición" detail="Las alarmas y reglas se administran dentro del contexto operacional activo." /></article>;
  return <>
    <div className="alarm-module-tabs" role="tablist" aria-label="Alarmas y reglas"><button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}><BellRing size={17} /> Eventos</button><button className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}><Settings size={17} /> Reglas y umbrales</button><span>Evaluación automática sobre cada lectura recibida</span></div>
    {tab === "events" ? <>
      <section className="alarm-summary">
        <div className="summary-tile critical"><span>Críticas activas</span><strong>{result?.summary.critical ?? 0}</strong><AlertTriangle size={24} /></div>
        <div className="summary-tile warning"><span>Advertencias activas</span><strong>{result?.summary.warning ?? 0}</strong><BellRing size={24} /></div>
        <div className="summary-tile normal"><span>MTTA promedio</span><strong>{result?.summary.mttaMinutes ?? 0}<small> min</small></strong><Clock3 size={24} /></div>
        <div className="summary-tile info"><span>Sin responsable</span><strong>{result?.summary.unassigned ?? 0}</strong><Users size={24} /></div>
      </section>
      <article className="panel alarm-table-panel">
        <div className="alarm-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar código, canal, activo o mensaje…" /></label><div className="alarm-filters"><label className="status-filter"><span>Estado</span><select value={workflowStatus} onChange={(event) => { setWorkflowStatus(event.target.value as typeof workflowStatus); setPage(1); }}><option value="all">Todos</option><option value="open">Abiertas</option><option value="acknowledged">Reconocidas</option><option value="resolved">Atendidas</option><option value="closed">Cerradas</option></select><ChevronDown size={13} /></label><div className="segmented">{(["all", "critical", "warning", "normal"] as const).map((item) => <button key={item} className={severity === item ? "active" : ""} onClick={() => { setSeverity(item); setPage(1); }}>{item === "all" ? "Todas" : item === "critical" ? "Críticas" : item === "warning" ? "Advertencias" : "Informativas"}</button>)}</div></div></div>
        {error ? <div className="load-error"><AlertTriangle size={18} />{error}<button onClick={() => void loadAlarms()}>Reintentar</button></div> : <div className="alarm-table-wrap"><div className="alarm-table"><div className="alarm-table-head"><span>Severidad</span><span>Evento / activo</span><span>Tiempo activo</span><span>Valor</span><span>Estado</span><span>Acción</span></div>{loading ? <TableEmptyState title="Cargando eventos" detail="Consultando alarmas y trazabilidad del punto activo." /> : result?.items.map((alarm) => <div className={`alarm-table-row ${selectedId === alarm.id ? "selected" : ""}`} key={alarm.id}><span><StatusPill state={alarm.severity === "normal" ? "info" : alarm.severity}>{alarm.severity === "critical" ? "Crítica" : alarm.severity === "warning" ? "Advertencia" : "Informativa"}</StatusPill></span><span className="event-cell"><strong>{alarm.title}</strong><small>{alarm.code} · {alarm.assetCode}{alarm.channelCode ? ` · ${alarm.channelCode}` : ""}</small></span><span>{formatRelativeTime(alarm.openedAt)}</span><span><strong>{alarmValue(alarm)}</strong></span><span className={`workflow-state workflow-${alarm.status}`}>{statusText(alarm.status)}</span><span><button className={selectedId === alarm.id ? "ack-button" : "ghost-button"} onClick={() => setSelectedId(alarm.id)}>Gestionar</button></span></div>)}{!loading && !result?.items.length && <TableEmptyState title="No hay eventos con estos filtros" detail="El motor conservará aquí las alarmas que genere la telemetría." />}</div></div>}
        {result && <Pagination page={result.page} totalPages={result.totalPages} total={result.total} pageSize={result.pageSize} onPageChange={setPage} itemLabel="eventos" />}
        {selected && <section className={`event-detail-panel event-${selected.severity}`}><div className="event-detail-header"><span className="event-detail-icon"><AlertTriangle size={20} /></span><div><span className="eyebrow">{selected.kind === "communication" ? "Comunicación" : selected.kind === "data_quality" ? "Calidad de datos" : "Umbral"} · {selected.code}</span><h2>{selected.title}</h2><p>{selected.detail || `${selected.assetCode} · ${selected.channelName ?? "Punto de medición"}`}</p></div><span className={`workflow-badge workflow-${selected.status}`}>{statusText(selected.status)}</span></div><div className="event-workspace"><div className="event-management"><dl className="event-facts"><div><dt>Valor detectado</dt><dd>{alarmValue(selected)}</dd></div><div><dt>Última observación</dt><dd>{formatDateTime(selected.lastObservedAt)}</dd></div><div><dt>Responsable</dt><dd><select disabled={!canOperate || busyAction !== ""} value={selected.assignedToId ?? ""} onChange={(event) => void updateAlarm("assign", { assignedTo: event.target.value || null })}><option value="">Sin asignar</option>{result?.assignees.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></dd></div></dl><div className="event-actions">{selected.channelCode && <button className="secondary-button" onClick={() => onOpenTrend(selected.channelCode!, selected.openedAt)}><TrendingUp size={15} /> Ver tendencia de origen</button>}{selected.status === "open" && canOperate && <button className="primary-button" disabled={busyAction !== ""} onClick={() => void updateAlarm("acknowledge")}><CheckCircle2 size={15} /> Reconocer</button>}{selected.status !== "closed" && selected.status !== "resolved" && canClose && <button className="secondary-button" disabled={busyAction !== ""} onClick={() => void updateAlarm("resolve")}><ShieldCheck size={15} /> Marcar atendida</button>}{selected.status === "resolved" && canClose && <button className="secondary-button" disabled={busyAction !== "" || noteInput.trim().length < 3} onClick={() => confirm({ title: `Cerrar ${selected.code}`, detail: "La nota escrita se guardará como evidencia del cierre.", confirmLabel: "Cerrar evento", tone: "danger", onConfirm: () => void updateAlarm("close", { note: noteInput }) })}><ShieldCheck size={15} /> Cerrar</button>}{(selected.status === "closed" || selected.status === "resolved") && canClose && <button className="secondary-button" disabled={busyAction !== ""} onClick={() => void updateAlarm("reopen")}>Reabrir</button>}</div>{!canOperate && <p className="permission-note"><ShieldCheck size={15} /> Tu perfil puede consultar la trazabilidad, sin modificarla.</p>}</div><div className="event-timeline"><h3>Línea de tiempo</h3>{detailLoading ? <p>Cargando trazabilidad…</p> : events.map((event) => <div key={event.id}><span className={`timeline-dot ${event.type.includes("resolved") || event.type === "closed" ? "normal" : event.type === "opened" ? selected.severity : "info"}`} /><p><strong>{eventText(event.type)}</strong><small>{formatDateTime(event.createdAt)} · {event.actorName}{event.note ? ` · ${event.note}` : ""}</small></p></div>)}</div></div>{canOperate && <form className="event-note-form" onSubmit={(event) => { event.preventDefault(); if (noteInput.trim().length >= 3) void updateAlarm("add_note", { note: noteInput }); }}><input value={noteInput} onChange={(event) => setNoteInput(event.target.value)} placeholder={selected.status === "resolved" ? "Nota de cierre obligatoria…" : "Agregar una nota de seguimiento…"} /><button type="submit" disabled={busyAction !== "" || noteInput.trim().length < 3}>Agregar nota</button></form>}</section>}
      </article>
    </> : <article className="panel alarm-rules-panel"><div className="alarm-rule-summary"><div><span>Reglas configuradas</span><strong>{ruleResult?.summary.total ?? 0}</strong></div><div><span>Activas</span><strong>{ruleResult?.summary.enabled ?? 0}</strong></div><div><span>Evaluadas por telemetría</span><strong>{ruleResult?.summary.evaluating ?? 0}</strong></div><div><span>En estado crítico</span><strong>{ruleResult?.summary.critical ?? 0}</strong></div></div><div className="alarm-toolbar"><label className="search-field"><Search size={17} /><input value={ruleQuery} onChange={(event) => { setRuleQuery(event.target.value); setRulePage(1); }} placeholder="Buscar canal, nombre o zona…" /></label><label className="status-filter"><span>Regla</span><select value={ruleEnabled} onChange={(event) => { setRuleEnabled(event.target.value as typeof ruleEnabled); setRulePage(1); }}><option value="all">Todas</option><option value="true">Activas</option><option value="false">Desactivadas</option></select><ChevronDown size={13} /></label></div><div className="alarm-rule-table-wrap"><div className="alarm-rule-table"><div className="alarm-rule-head"><span>Canal</span><span>Estado</span><span>Advertencia</span><span>Crítico</span><span>Histéresis</span><span>Activación</span><span>Recuperación</span><span>Dato atrasado</span><span>Acción</span></div>{ruleLoading ? <TableEmptyState title="Cargando reglas" detail="Consultando umbrales persistentes." /> : ruleResult?.items.map((rule) => { const draft = ruleDrafts[rule.id]; if (!draft) return null; return <div className="alarm-rule-row" key={rule.id}><span className="rule-channel"><strong>{rule.channelCode}</strong><small>{rule.channelName} · {rule.zone ?? rule.assetCode}</small></span><span><label className="rule-switch"><input type="checkbox" checked={draft.enabled} disabled={!canConfigure} onChange={(event) => updateRuleDraft(rule.id, "enabled", event.target.checked)} /><i /><small>{draft.enabled ? "Activa" : "Inactiva"}</small></label></span><span><input type="number" step="0.1" value={draft.warningThreshold} disabled={!canConfigure} onChange={(event) => updateRuleDraft(rule.id, "warningThreshold", Number(event.target.value))} /><small>{rule.unit}</small></span><span><input type="number" step="0.1" value={draft.criticalThreshold} disabled={!canConfigure} onChange={(event) => updateRuleDraft(rule.id, "criticalThreshold", Number(event.target.value))} /><small>{rule.unit}</small></span><span><input type="number" step="0.1" min="0" value={draft.hysteresis} disabled={!canConfigure} onChange={(event) => updateRuleDraft(rule.id, "hysteresis", Number(event.target.value))} /></span><span><input type="number" min="1" max="100" value={draft.activationSamples} disabled={!canConfigure} onChange={(event) => updateRuleDraft(rule.id, "activationSamples", Number(event.target.value))} /><small>muestras</small></span><span><input type="number" min="1" max="100" value={draft.recoverySamples} disabled={!canConfigure} onChange={(event) => updateRuleDraft(rule.id, "recoverySamples", Number(event.target.value))} /><small>muestras</small></span><span><input type="number" min="1" max="86400" value={draft.staleAfterSeconds} disabled={!canConfigure} onChange={(event) => updateRuleDraft(rule.id, "staleAfterSeconds", Number(event.target.value))} /><small>segundos</small></span><span><button className="ghost-button" disabled={!canConfigure || savingRule === rule.id} onClick={() => void saveRule(rule)}>{savingRule === rule.id ? <Refresh className="spin" size={15} /> : <Save size={15} />} Guardar</button></span></div>})}{!ruleLoading && !ruleResult?.items.length && <TableEmptyState title="No hay reglas configuradas" detail="Configura los canales del punto antes de habilitar alarmas." />}</div></div>{ruleResult && <Pagination page={ruleResult.page} totalPages={ruleResult.totalPages} total={ruleResult.total} pageSize={ruleResult.pageSize} onPageChange={setRulePage} itemLabel="reglas" />}<div className="alarm-rule-note"><ShieldCheck size={18} /><p><strong>Control contra falsos positivos</strong><span>La regla exige muestras consecutivas, aplica histéresis para recuperar y conserva el estado del motor en la base de datos.</span></p></div></article>}
  </>;
}

function HistoryView({ assetId, canExport, onOpenTrend }: { assetId: string; canExport: boolean; onOpenTrend: (channelId: string, from: string, to: string) => void }) {
  const sensors = useSensorData();
  const notify = useFeedback();
  const [tab, setTab] = useState<HistoryTab>("measurements");
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [channel, setChannel] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<(PaginationMeta & { items: Array<Record<string, unknown>> }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const activeSensors = sensors.filter((sensor) => sensor.enabled);
  const fromIso = new Date(`${from}T00:00:00`).toISOString();
  const toIso = new Date(`${to}T23:59:59.999`).toISOString();

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ tab, from: fromIso, to: toIso, page: String(page), pageSize: "8" });
        if (assetId) params.set("assetId", assetId);
        if (query.trim()) params.set("q", query.trim());
        if (tab === "measurements" && channel !== "all") params.set("channel", channel);
        const data = await portalRequest<PaginationMeta & { items: Array<Record<string, unknown>> }>(`/api/v1/history?${params}`);
        if (active) setResult(data);
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : "No fue posible consultar el histórico.");
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [assetId, tab, fromIso, toIso, page, query, channel]);

  const changeTab = (next: HistoryTab) => { setTab(next); setPage(1); };
  const total = result?.total ?? 0;
  const exportHistory = async () => {
    try {
      const params = new URLSearchParams({ tab, from: fromIso, to: toIso, format: "csv" });
      if (assetId) params.set("assetId", assetId);
      if (query.trim()) params.set("q", query.trim());
      if (tab === "measurements" && channel !== "all") params.set("channel", channel);
      await downloadAuthenticatedCsv(`/api/v1/history?${params}`, `hoitlive-historico-${tab}.csv`);
      notify("Histórico exportado con los filtros visibles.", "info");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No fue posible exportar el histórico.", "warning");
    }
  };

  return (
    <>
      <section className="module-summary-grid">
        <article><span className="module-summary-icon blue"><Database size={19} /></span><div><small>Registros encontrados</small><strong>{total.toLocaleString("es-CL")}</strong><span>{from} → {to}</span></div></article>
        <article><span className="module-summary-icon green"><ShieldCheck size={19} /></span><div><small>Fuente de información</small><strong>PostgreSQL</strong><span>Consulta protegida por perfil</span></div></article>
        <article><span className="module-summary-icon amber"><Timeline size={19} /></span><div><small>Vista actual</small><strong>{tab === "measurements" ? "Mediciones" : tab === "alarms" ? "Alarmas" : "Auditoría"}</strong><span>Página {result?.page ?? page} de {result?.totalPages ?? 1}</span></div></article>
      </section>

      <article className="panel module-panel">
        <div className="module-toolbar">
          <div className="module-tabs" role="tablist" aria-label="Tipo de histórico">
            <button className={tab === "measurements" ? "active" : ""} onClick={() => changeTab("measurements")}><Timeline size={16} /> Mediciones</button>
            <button className={tab === "alarms" ? "active" : ""} onClick={() => changeTab("alarms")}><BellRing size={16} /> Alarmas</button>
            <button className={tab === "audit" ? "active" : ""} onClick={() => changeTab("audit")}><ShieldCheck size={16} /> Auditoría</button>
          </div>
          {canExport && <button className="primary-button history-export-button" onClick={() => void exportHistory()} disabled={loading}><Download size={16} /> Exportar CSV</button>}
        </div>
        <div className="history-search-bar">
          <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={tab === "audit" ? "Buscar acción o recurso…" : "Buscar canal, código o evento…"} /></label>
          {tab === "measurements" && <label><span>Canal</span><select value={channel} onChange={(event) => { setChannel(event.target.value); setPage(1); }}><option value="all">Todos los canales</option>{activeSensors.map((sensor) => <option key={sensor.id} value={sensor.id}>{sensor.id} · {sensor.label}</option>)}</select><ChevronDown size={13} /></label>}
          <label><span>Desde</span><input type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
          <label><span>Hasta</span><input type="date" value={to} min={from} max={today} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
        </div>

        {error && <div className="data-error"><AlertTriangle size={18} /><div><strong>No se pudo cargar el histórico</strong><p>{error}</p></div></div>}
        {loading && <div className="data-loading"><Refresh className="spin" size={18} /> Consultando PostgreSQL…</div>}

        {!loading && !error && tab === "measurements" && <div className="module-table-wrap"><div className="history-table measurement-history"><div className="module-table-head"><span>Canal</span><span>Última lectura</span><span>Promedio</span><span>Mínimo</span><span>Máximo</span><span>Calidad</span><span>Acción</span></div>{result?.items.map((raw) => {
          const item = raw as { id: string; code: string; name: string; zone?: string; unit: string; lastValue?: string | null; averageValue?: string | null; minimumValue?: string | null; maximumValue?: string | null; qualityPercent?: number | null; lastRecordedAt?: string | null };
          const value = (entry?: string | null) => entry === null || entry === undefined ? "—" : `${Number(entry).toFixed(1)} ${item.unit}`;
          return <div className="module-table-row" key={item.id}><span className="history-channel"><b className="sensor-code sensor-normal">{item.code}</b><span><strong>{item.name}</strong><small>{item.zone || "Sin zona"}</small></span></span><span className="mono-cell">{value(item.lastValue)}<small>{item.lastRecordedAt ? formatDateTime(item.lastRecordedAt) : "Sin muestras"}</small></span><span className="mono-cell">{value(item.averageValue)}</span><span className="mono-cell">{value(item.minimumValue)}</span><span className="mono-cell">{value(item.maximumValue)}</span><span className={item.qualityPercent === null ? "muted-state" : "quality-ok"}>{item.qualityPercent === null ? "Sin datos" : <><CheckCircle2 size={14} /> {item.qualityPercent}%</>}</span><span><button className="ghost-button" onClick={() => onOpenTrend(item.code, fromIso, toIso)}><TrendingUp size={15} /> Tendencia</button></span></div>;
        })}{result?.items.length === 0 && <TableEmptyState title="No hay mediciones en este rango" detail="Ajusta las fechas o espera la primera ingestión del CAM-5." />}</div></div>}

        {!loading && !error && tab === "alarms" && <div className="module-table-wrap"><div className="history-table alarm-history"><div className="module-table-head"><span>Fecha</span><span>Severidad</span><span>Evento</span><span>Valor</span><span>Estado</span><span>Acción</span></div>{result?.items.map((raw) => { const item = raw as { id: string; code: string; openedAt: string; severity: Severity; status: string; title: string; detail?: string; triggerValue?: string; channelCode?: string; unit?: string }; const closed = item.status === "closed"; const resolved = item.status === "resolved"; return <div className="module-table-row" key={item.id}><span>{formatDateTime(item.openedAt)}</span><span><StatusPill state={item.severity}>{item.severity === "critical" ? "Crítica" : item.severity === "warning" ? "Advertencia" : "Normal"}</StatusPill></span><span className="event-cell"><strong>{item.title}</strong><small>{item.detail || item.code}</small></span><span className="mono-cell">{item.triggerValue ? `${Number(item.triggerValue).toFixed(1)} ${item.unit || ""}` : "—"}</span><span className={closed || resolved ? "quality-ok" : "unack-state"}>{closed || resolved ? <><CheckCircle2 size={14} /> {closed ? "Cerrada" : "Atendida"}</> : <><Clock3 size={14} /> {item.status === "acknowledged" ? "Reconocida" : "Abierta"}</>}</span><span>{item.channelCode ? <button className="ghost-button" onClick={() => onOpenTrend(item.channelCode!, new Date(new Date(item.openedAt).getTime() - 12 * 3600_000).toISOString(), new Date(Math.min(Date.now(), new Date(item.openedAt).getTime() + 12 * 3600_000)).toISOString())}><TrendingUp size={15} /> Tendencia</button> : "—"}</span></div>; })}{result?.items.length === 0 && <TableEmptyState title="No hay alarmas en este rango" detail="No se encontraron eventos con los filtros indicados." />}</div></div>}

        {!loading && !error && tab === "audit" && <div className="module-table-wrap"><div className="history-table audit-history"><div className="module-table-head"><span>Fecha</span><span>Usuario</span><span>Acción</span><span>Recurso</span><span>Resultado</span></div>{result?.items.map((raw) => { const item = raw as { id: number; createdAt: string; actor: string; action: string; resourceType: string; resourceId?: string; outcome: string }; return <div className="module-table-row" key={item.id}><span>{formatDateTime(item.createdAt)}</span><span><strong>{item.actor}</strong></span><span>{item.action}</span><span className="mono-cell">{item.resourceType}{item.resourceId ? ` · ${item.resourceId}` : ""}</span><span className={item.outcome === "success" ? "quality-ok" : "unack-state"}>{item.outcome === "success" ? "Correcto" : item.outcome}</span></div>; })}{result?.items.length === 0 && <TableEmptyState title="No hay movimientos auditados" detail="No existen acciones registradas para este periodo." />}</div></div>}

        {!loading && !error && result && <Pagination page={result.page} totalPages={result.totalPages} total={result.total} pageSize={result.pageSize} onPageChange={setPage} itemLabel={tab === "measurements" ? "canales" : tab === "alarms" ? "eventos" : "acciones"} />}
        <div className="module-footer"><span><Database size={14} /> Retención: 30 días crudos · 5 años agregados</span><small>Fuente actual: PostgreSQL · rango consultado inclusive.</small></div>
      </article>
    </>
  );
}

function OperationalHierarchyView({
  hierarchy,
  loading,
  permissions,
  onReload,
  onSwitchSite,
}: {
  hierarchy: PortalHierarchy | null;
  loading: boolean;
  permissions: string[];
  onReload: () => Promise<void>;
  onSwitchSite: (siteId: string) => Promise<void>;
}) {
  type Resource = "client" | "site" | "point" | "gateway" | "controller";
  type EditableResource = PortalHierarchy["clients"][number] | PortalHierarchy["sites"][number] | PortalHierarchy["points"][number] | PortalHierarchy["gateways"][number] | PortalHierarchy["controllers"][number];
  type EditorState = { resource: Resource; id: string; code: string; name: string; active: boolean; legalName: string; taxId: string; contactEmail: string; description: string; timezone: string; area: string; voltage: string; ipAddress: string; serialNumber: string; host: string; port: string; unitId: string };
  const notify = useFeedback();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"structure" | "connections">("structure");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [resource, setResource] = useState<Resource>("point");
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", clientId: "", area: "", voltage: "", ipAddress: "", pointId: "", gatewayId: "", host: "", port: "502", unitId: "1" });

  const canManageClients = permissions.includes("users.manage");
  const canManagePoints = permissions.includes("assets.write");
  const canManageConnections = permissions.includes("settings.write");
  const availableResources: Array<{ value: Resource; label: string }> = [
    ...(canManageClients ? [{ value: "client" as const, label: "Cliente" }, { value: "site" as const, label: "Sitio" }] : []),
    ...(canManagePoints ? [{ value: "point" as const, label: "Punto de medición" }] : []),
    ...(canManageConnections ? [{ value: "gateway" as const, label: "Gateway" }, { value: "controller" as const, label: "Controlador CAM5" }] : []),
  ];
  const resourceLabels: Record<Resource, string> = { client: "Cliente", site: "Sitio", point: "Punto de medición", gateway: "Gateway", controller: "Controlador CAM5" };
  const filteredPoints = (hierarchy?.points ?? []).filter((point) => `${point.code} ${point.name} ${point.area ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const filteredGateways = (hierarchy?.gateways ?? []).filter((gateway) => `${gateway.code} ${gateway.name} ${gateway.ipAddress ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const filteredControllers = (hierarchy?.controllers ?? []).filter((controller) => `${controller.code} ${controller.name} ${controller.host}`.toLowerCase().includes(query.toLowerCase()));
  const pointPage = useClientPagination(filteredPoints, 6);
  const gatewayPage = useClientPagination(filteredGateways, 6);
  const controllerPage = useClientPagination(filteredControllers, 8);

  const resetForm = () => setForm({ code: "", name: "", clientId: hierarchy?.active.clientId ?? "", area: "", voltage: "", ipAddress: "", pointId: "", gatewayId: "", host: "", port: "502", unitId: "1" });
  const changeResource = (value: Resource) => { setResource(value); resetForm(); };
  const openEditor = (nextResource: Resource, value: EditableResource) => {
    const item = value as unknown as Record<string, unknown>;
    const field = (key: string) => typeof item[key] === "string" ? String(item[key]) : "";
    setEditor({
      resource: nextResource,
      id: String(item.id),
      code: String(item.code),
      name: String(item.name),
      active: item.active !== false,
      legalName: field("legalName"),
      taxId: field("taxId"),
      contactEmail: field("contactEmail"),
      description: field("description"),
      timezone: field("timezone") || "America/Santiago",
      area: field("area"),
      voltage: item.nominalVoltageKv === null || item.nominalVoltageKv === undefined ? "" : String(item.nominalVoltageKv),
      ipAddress: field("ipAddress"),
      serialNumber: field("serialNumber"),
      host: field("host"),
      port: item.port === undefined ? "502" : String(item.port),
      unitId: item.unitId === undefined ? "1" : String(item.unitId),
    });
  };
  const createResource = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hierarchy) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { resource, code: form.code, name: form.name };
      if (resource === "site") Object.assign(payload, { clientId: form.clientId || hierarchy.active.clientId, timezone: "America/Santiago" });
      if (resource === "point") Object.assign(payload, { siteId: hierarchy.active.siteId, area: form.area, nominalVoltageKv: form.voltage ? Number(form.voltage) : undefined });
      if (resource === "gateway") Object.assign(payload, { siteId: hierarchy.active.siteId, ipAddress: form.ipAddress });
      if (resource === "controller") Object.assign(payload, { pointId: form.pointId, gatewayId: form.gatewayId, host: form.host, port: Number(form.port), unitId: Number(form.unitId) });
      await portalRequest("/api/v1/hierarchy", { method: "POST", body: JSON.stringify(payload) });
      await onReload();
      notify(`${availableResources.find((item) => item.value === resource)?.label ?? "Elemento"} registrado correctamente.`);
      setShowCreate(false);
      resetForm();
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No fue posible guardar el elemento.", "warning");
    } finally {
      setSaving(false);
    }
  };

  const updateResource = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    setEditorSaving(true);
    try {
      const payload: Record<string, unknown> = { resource: editor.resource, id: editor.id, name: editor.name, active: editor.active };
      if (editor.resource === "client") Object.assign(payload, { legalName: editor.legalName, taxId: editor.taxId, contactEmail: editor.contactEmail });
      if (editor.resource === "site") Object.assign(payload, { description: editor.description, timezone: editor.timezone });
      if (editor.resource === "point") Object.assign(payload, { area: editor.area, nominalVoltageKv: editor.voltage ? Number(editor.voltage) : null });
      if (editor.resource === "gateway") Object.assign(payload, { ipAddress: editor.ipAddress, serialNumber: editor.serialNumber });
      if (editor.resource === "controller") Object.assign(payload, { host: editor.host, port: Number(editor.port), unitId: Number(editor.unitId) });
      await portalRequest("/api/v1/hierarchy", { method: "PATCH", body: JSON.stringify(payload) });
      await onReload();
      notify(`${editor.name} actualizado correctamente.`);
      setEditor(null);
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No fue posible actualizar el elemento.", "warning");
    } finally {
      setEditorSaving(false);
    }
  };

  const deleteResource = async (target: EditorState) => {
    setEditorSaving(true);
    try {
      await portalRequest("/api/v1/hierarchy", { method: "DELETE", body: JSON.stringify({ resource: target.resource, id: target.id }) });
      setEditor(null);
      await onReload();
      notify(`${target.name} eliminado correctamente.`);
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No fue posible eliminar el elemento.", "warning");
    } finally {
      setEditorSaving(false);
    }
  };

  const requestDelete = () => {
    if (!editor) return;
    const target = editor;
    confirm({
      title: `Eliminar ${target.name}`,
      detail: "La eliminación solo se realizará si no existen dependencias ni telemetría. Si conserva trazabilidad, el sistema te pedirá desactivarlo.",
      confirmLabel: "Eliminar definitivamente",
      tone: "danger",
      onConfirm: () => void deleteResource(target),
    });
  };

  if (loading && !hierarchy) return <section className="panel hierarchy-loading"><Refresh className="spin" size={20} /> Cargando estructura operacional…</section>;
  if (!hierarchy) return <section className="panel permission-state"><span><AlertTriangle size={26} /></span><div><span className="eyebrow">Estructura no disponible</span><h2>No fue posible consultar la organización</h2><p>Revisa la conexión con la base de datos e inténtalo nuevamente.</p></div></section>;

  const activeSite = hierarchy.sites.find((site) => site.id === hierarchy.active.siteId);
  const activeGateway = hierarchy.gateways.find((gateway) => gateway.active);
  const stateLabel = (state: string, active = true) => !active ? "Desactivado" : state === "online" || state === "active" || state === "normal" ? "Operativo" : state === "commissioning" || state === "pending" ? "En puesta en marcha" : state === "warning" || state === "degraded" ? "Atención" : state === "critical" ? "Crítico" : state === "maintenance" ? "Mantenimiento" : "Sin conexión";

  return <>
    <section className="module-summary-grid hierarchy-summary">
      <article><span className="module-summary-icon blue"><Building2 size={19} /></span><div><small>Clientes accesibles</small><strong>{hierarchy.clients.length}</strong><span>{hierarchy.sites.length} sitios autorizados</span></div></article>
      <article><span className="module-summary-icon green"><MapPin size={19} /></span><div><small>Puntos de medición</small><strong>{hierarchy.points.length}</strong><span>En {hierarchy.active.siteName}</span></div></article>
      <article><span className="module-summary-icon amber"><Server size={19} /></span><div><small>Cadena de adquisición</small><strong>{hierarchy.gateways.length}</strong><span>{hierarchy.controllers.length} controladores asociados</span></div></article>
    </section>

    <article className="panel module-panel hierarchy-module">
      <div className="module-toolbar">
        <div className="module-tabs" role="tablist" aria-label="Estructura operacional">
          <button className={tab === "structure" ? "active" : ""} onClick={() => setTab("structure")}><Hierarchy size={16} /> Organización</button>
          <button className={tab === "connections" ? "active" : ""} onClick={() => setTab("connections")}><PlugConnected size={16} /> Conexiones Modbus</button>
        </div>
        {availableResources.length > 0 && <button className="primary-button" onClick={() => setShowCreate((current) => !current)}><Plus size={16} />{showCreate ? "Cancelar" : "Agregar elemento"}</button>}
      </div>

      {showCreate && <form className="hierarchy-create-form" onSubmit={createResource}>
        <div className="hierarchy-form-heading"><span className="eyebrow">Alta operacional</span><h3>Agregar a la estructura</h3></div>
        <label><span>Tipo de elemento</span><select value={resource} onChange={(event) => changeResource(event.target.value as Resource)}>{availableResources.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label><span>Código único</span><input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder={resource === "client" ? "CLIENTE-01" : resource === "site" ? "SITIO-01" : resource === "point" ? "MCC-01" : resource === "gateway" ? "GW-01" : "CAM5-01"} /></label>
        <label><span>Nombre</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nombre operacional" /></label>
        {resource === "site" && <label><span>Cliente</span><select required value={form.clientId || hierarchy.active.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}>{hierarchy.clients.filter((client) => client.active).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}
        {resource === "point" && <><label><span>Área</span><input value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })} placeholder="Sala o área eléctrica" /></label><label><span>Tensión nominal (kV)</span><input type="number" min="0" step="0.1" value={form.voltage} onChange={(event) => setForm({ ...form, voltage: event.target.value })} /></label></>}
        {resource === "gateway" && <label><span>Dirección IP</span><input value={form.ipAddress} onChange={(event) => setForm({ ...form, ipAddress: event.target.value })} placeholder="10.0.0.20" /></label>}
        {resource === "controller" && <><label><span>Punto de medición</span><select required value={form.pointId} onChange={(event) => setForm({ ...form, pointId: event.target.value })}><option value="">Seleccionar…</option>{hierarchy.points.filter((point) => point.active).map((point) => <option key={point.id} value={point.id}>{point.code} · {point.name}</option>)}</select></label><label><span>Gateway</span><select required value={form.gatewayId} onChange={(event) => setForm({ ...form, gatewayId: event.target.value })}><option value="">Seleccionar…</option>{hierarchy.gateways.filter((gateway) => gateway.active).map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.code} · {gateway.name}</option>)}</select></label><label><span>IP del CAM5</span><input required value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} placeholder="192.168.10.42" /></label><label><span>Puerto</span><input type="number" min="1" max="65535" required value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></label><label><span>Unit ID</span><input type="number" min="1" max="247" required value={form.unitId} onChange={(event) => setForm({ ...form, unitId: event.target.value })} /></label></>}
        <button className="primary-button" type="submit" disabled={saving || (resource === "controller" && (!hierarchy.points.length || !hierarchy.gateways.length))}>{saving ? "Guardando…" : "Registrar"}</button>
      </form>}

      <div className="hierarchy-scope-bar"><div><span className="eyebrow">Contexto operacional</span><strong>{hierarchy.active.clientName} <ChevronRight size={14} /> {hierarchy.active.siteName}</strong></div><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); pointPage.setPage(1); gatewayPage.setPage(1); controllerPage.setPage(1); }} placeholder="Buscar punto, gateway o controlador…" /></label></div>

      {tab === "structure" && <div className="hierarchy-workspace">
        <aside className="organization-tree">
          {hierarchy.clients.map((client) => <section key={client.id} className={client.active ? "" : "inactive-resource"}>
            <div className="organization-client"><span><Factory size={17} /></span><div><strong>{client.name}</strong><small>{client.code}{client.active ? "" : " · Desactivado"}</small></div>{canManageClients && <button className="resource-edit-button" onClick={() => openEditor("client", client)} aria-label={`Editar cliente ${client.name}`}><Pencil size={15} /></button>}</div>
            <div className="organization-sites">{hierarchy.sites.filter((site) => site.clientId === client.id).map((site) => <div className={`organization-site-row ${site.active && client.active ? "" : "inactive-resource"}`} key={site.id}><button className={site.id === hierarchy.active.siteId ? "active" : ""} disabled={!site.active || !client.active} onClick={() => onSwitchSite(site.id)}><span><Building2 size={16} /></span><span><strong>{site.name}</strong><small>{!client.active ? "Cliente desactivado" : site.active ? `${site.pointCount} puntos · ${site.gatewayCount} gateways` : "Sitio desactivado"}</small></span><ChevronRight size={15} /></button>{canManageClients && <button className="resource-edit-button" onClick={() => openEditor("site", site)} aria-label={`Editar sitio ${site.name}`}><Pencil size={15} /></button>}</div>)}{hierarchy.sites.every((site) => site.clientId !== client.id) && <p>Cliente sin sitios registrados.</p>}</div>
          </section>)}
        </aside>
        <div className="site-inventory">
          <section className="site-identity-card"><span><Building2 size={22} /></span><div><span className="eyebrow">Sitio activo · {activeSite?.code}</span><h2>{hierarchy.active.siteName}</h2><p>{hierarchy.active.clientName} · {activeSite?.roleName}</p></div><dl><div><dt>Puntos</dt><dd>{activeSite?.pointCount ?? 0}</dd></div><div><dt>Gateways</dt><dd>{activeSite?.gatewayCount ?? 0}</dd></div><div><dt>Controladores</dt><dd>{activeSite?.controllerCount ?? 0}</dd></div></dl></section>
          <div className="inventory-columns">
            <section>
              <div className="inventory-heading"><div><span className="eyebrow">Medición</span><h3>Puntos de medición</h3></div><span>{filteredPoints.length}</span></div>
              <div className="operational-card-list">{pointPage.pageItems.map((point) => {
                const linked = hierarchy.controllers.filter((controller) => controller.pointId === point.id);
                return <article key={point.id} className={point.active ? "" : "inactive-resource"}><span className={`operational-state state-${point.state}`}><CircuitBoard size={18} /></span><div><strong>{point.code} · {point.name}</strong><small>{point.area || "Área sin definir"} · {point.nominalVoltageKv ? `${point.nominalVoltageKv} kV` : "Tensión sin definir"}</small><em>{linked.length} controlador{linked.length === 1 ? "" : "es"} asociado{linked.length === 1 ? "" : "s"}</em></div><span className="operational-card-actions"><b>{stateLabel(point.state, point.active)}</b>{canManagePoints && <button className="resource-edit-button" onClick={() => openEditor("point", point)} aria-label={`Editar punto ${point.name}`}><Pencil size={15} /></button>}</span></article>;
              })}{pointPage.pageItems.length === 0 && <TableEmptyState title="No hay puntos de medición" detail="Registra el primer punto para asociar un controlador CAM5." />}</div>
              <Pagination page={pointPage.page} totalPages={pointPage.totalPages} total={filteredPoints.length} pageSize={6} onPageChange={pointPage.setPage} itemLabel="puntos" />
            </section>
            <section>
              <div className="inventory-heading"><div><span className="eyebrow">Conectividad</span><h3>Gateways del sitio</h3></div><span>{filteredGateways.length}</span></div>
              <div className="operational-card-list">{gatewayPage.pageItems.map((gateway) => {
                const linked = hierarchy.controllers.filter((controller) => controller.gatewayId === gateway.id);
                return <article key={gateway.id} className={gateway.active ? "" : "inactive-resource"}><span className={`operational-state state-${gateway.state}`}><Server size={18} /></span><div><strong>{gateway.code} · {gateway.name}</strong><small>{gateway.ipAddress || "IP pendiente"} · {gateway.softwareVersion || "Versión pendiente"}</small><em>{linked.length} punto{linked.length === 1 ? "" : "s"} conectado{linked.length === 1 ? "" : "s"}</em></div><span className="operational-card-actions"><b>{stateLabel(gateway.state, gateway.active)}</b>{canManageConnections && <button className="resource-edit-button" onClick={() => openEditor("gateway", gateway)} aria-label={`Editar gateway ${gateway.name}`}><Pencil size={15} /></button>}</span></article>;
              })}{gatewayPage.pageItems.length === 0 && <TableEmptyState title="No hay gateways" detail="Registra un gateway antes de configurar conexiones Modbus." />}</div>
              <Pagination page={gatewayPage.page} totalPages={gatewayPage.totalPages} total={filteredGateways.length} pageSize={6} onPageChange={gatewayPage.setPage} itemLabel="gateways" />
            </section>
          </div>
        </div>
      </div>}

      {tab === "connections" && <div className="connections-content">
        <div className="connection-explainer"><span><PlugConnected size={21} /></span><div><h3>Ruta de adquisición</h3><p>El gateway consulta por Modbus al controlador CAM5 instalado en cada punto. La base impide relacionar equipos de sitios distintos.</p></div><strong>{activeGateway?.code ?? "Sin gateway"} → CAM5 → HoitLive Core</strong></div>
        <div className="module-table-wrap"><div className="connections-table"><div className="module-table-head"><span>Controlador</span><span>Punto de medición</span><span>Gateway</span><span>Destino Modbus</span><span>Estado</span><span>Acciones</span></div>{controllerPage.pageItems.map((controller) => {
          const point = hierarchy.points.find((item) => item.id === controller.pointId);
          const gateway = hierarchy.gateways.find((item) => item.id === controller.gatewayId);
          return <div className={`module-table-row ${controller.active ? "" : "inactive-resource"}`} key={controller.id}><span><strong>{controller.code}</strong><small>{controller.model}</small></span><span>{point ? `${point.code} · ${point.name}` : "Punto no disponible"}</span><span>{gateway ? gateway.code : "Gateway no disponible"}</span><span className="mono-cell">{controller.host}:{controller.port} · ID {controller.unitId}</span><span><i className={`connection-status state-${controller.state}`}>{stateLabel(controller.state, controller.active)}</i></span><span>{canManageConnections && <button className="resource-edit-button" onClick={() => openEditor("controller", controller)} aria-label={`Editar controlador ${controller.name}`}><Pencil size={15} /> Editar</button>}</span></div>;
        })}{controllerPage.pageItems.length === 0 && <TableEmptyState title="No hay conexiones Modbus" detail="Asocia un controlador CAM5 a un punto de medición y a un gateway." />}</div></div>
        <Pagination page={controllerPage.page} totalPages={controllerPage.totalPages} total={filteredControllers.length} pageSize={8} onPageChange={controllerPage.setPage} itemLabel="conexiones" />
      </div>}
    </article>
    {editor && <div className="resource-editor-backdrop" role="presentation" onMouseDown={() => !editorSaving && setEditor(null)}>
      <section className="resource-editor" role="dialog" aria-modal="true" aria-labelledby="resource-editor-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">Administración operacional</span><h2 id="resource-editor-title">Editar {resourceLabels[editor.resource].toLowerCase()}</h2><p>Los cambios se guardan en la base de datos y quedan registrados en auditoría.</p></div><button onClick={() => setEditor(null)} disabled={editorSaving} aria-label="Cerrar editor"><X size={19} /></button></header>
        <form onSubmit={updateResource}>
          <div className="resource-identity"><span>{resourceLabels[editor.resource]}</span><strong>{editor.code}</strong><small>El código es la identidad técnica y no se modifica después de crear el elemento.</small></div>
          <div className="resource-editor-grid">
            <label className="field-wide"><span>Nombre</span><input required minLength={2} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
            {editor.resource === "client" && <><label className="field-wide"><span>Razón social</span><input value={editor.legalName} onChange={(event) => setEditor({ ...editor, legalName: event.target.value })} /></label><label><span>RUT / identificación tributaria</span><input value={editor.taxId} onChange={(event) => setEditor({ ...editor, taxId: event.target.value })} /></label><label><span>Correo de contacto</span><input type="email" value={editor.contactEmail} onChange={(event) => setEditor({ ...editor, contactEmail: event.target.value })} /></label></>}
            {editor.resource === "site" && <><label className="field-wide"><span>Descripción</span><input value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label><label className="field-wide"><span>Zona horaria</span><select value={editor.timezone} onChange={(event) => setEditor({ ...editor, timezone: event.target.value })}><option value="America/Santiago">America/Santiago</option><option value="UTC">UTC</option></select></label></>}
            {editor.resource === "point" && <><label><span>Área o sala</span><input value={editor.area} onChange={(event) => setEditor({ ...editor, area: event.target.value })} /></label><label><span>Tensión nominal (kV)</span><input type="number" min="0" step="0.1" value={editor.voltage} onChange={(event) => setEditor({ ...editor, voltage: event.target.value })} /></label></>}
            {editor.resource === "gateway" && <><label><span>Dirección IP</span><input value={editor.ipAddress} onChange={(event) => setEditor({ ...editor, ipAddress: event.target.value })} placeholder="10.0.0.20" /></label><label><span>Número de serie</span><input value={editor.serialNumber} onChange={(event) => setEditor({ ...editor, serialNumber: event.target.value })} /></label></>}
            {editor.resource === "controller" && <><label className="field-wide"><span>IP o host del CAM5</span><input required value={editor.host} onChange={(event) => setEditor({ ...editor, host: event.target.value })} /></label><label><span>Puerto</span><input required type="number" min="1" max="65535" value={editor.port} onChange={(event) => setEditor({ ...editor, port: event.target.value })} /></label><label><span>Unit ID</span><input required type="number" min="1" max="247" value={editor.unitId} onChange={(event) => setEditor({ ...editor, unitId: event.target.value })} /></label></>}
          </div>
          <label className={`resource-active-toggle ${(editor.resource === "client" && editor.id === hierarchy.active.clientId) || (editor.resource === "site" && editor.id === hierarchy.active.siteId) ? "locked" : ""}`}><input type="checkbox" checked={editor.active} disabled={(editor.resource === "client" && editor.id === hierarchy.active.clientId) || (editor.resource === "site" && editor.id === hierarchy.active.siteId)} onChange={(event) => setEditor({ ...editor, active: event.target.checked })} /><span><strong>Elemento activo</strong><small>{(editor.resource === "client" && editor.id === hierarchy.active.clientId) || (editor.resource === "site" && editor.id === hierarchy.active.siteId) ? "Cambia primero el contexto activo para poder desactivarlo." : editor.active ? "Disponible para operación y adquisición." : "Conserva el histórico, pero queda fuera de operación."}</small></span></label>
          <footer><button type="button" className="danger-button" onClick={requestDelete} disabled={editorSaving || (editor.resource === "site" && editor.id === hierarchy.active.siteId) || (editor.resource === "client" && editor.id === hierarchy.active.clientId)}><Trash size={16} /> Eliminar</button><span /><button type="button" className="secondary-button" onClick={() => setEditor(null)} disabled={editorSaving}>Cancelar</button><button type="submit" className="primary-button" disabled={editorSaving}>{editorSaving ? "Guardando…" : "Guardar cambios"}</button></footer>
        </form>
      </section>
    </div>}
  </>;
}

function UsersView({ currentUserId, sites, activeSiteId }: { currentUserId: string; sites: PortalSiteScope[]; activeSiteId: string }) {
  const notify = useFeedback();
  const confirm = useConfirm();
  const currentRole = useActiveRole();
  const manageableSites = sites.filter((site) => site.roleKey === "administrator");
  type UserRow = { id: string; displayName: string; email: string; status: "active" | "suspended" | "invited"; lastLoginAt: string | null; createdAt: string; role: { key: "administrator" | "engineer" | "operator" | "viewer"; name: UserRole }; siteIds: string[] };
  type UserResult = PaginationMeta & { items: UserRow[]; summary: { total: number; active: number; administrators: number; invited: number } };
  const blankForm = { displayName: "", email: "", password: "", role: "operator" as UserRow["role"]["key"], status: "active" as UserRow["status"], siteIds: [activeSiteId] };
  const [result, setResult] = useState<UserResult | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (currentRole !== "Administrador") return;
    let active = true;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "8", status: statusFilter });
        if (query.trim()) params.set("q", query.trim());
        const data = await portalRequest<UserResult>(`/api/v1/users?${params}`);
        if (active) setResult(data);
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : "No fue posible consultar los usuarios.");
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [currentRole, page, query, statusFilter, reload]);

  const openCreate = () => { setEditingId(null); setForm(blankForm); setShowForm(true); };
  const openEdit = (user: UserRow) => { setEditingId(user.id); setForm({ displayName: user.displayName, email: user.email, password: "", role: user.role.key, status: user.status, siteIds: user.siteIds }); setShowForm(true); };
  const toggleSite = (siteId: string) => setForm((current) => ({ ...current, siteIds: current.siteIds.includes(siteId) ? current.siteIds.filter((id) => id !== siteId) : [...current.siteIds, siteId] }));
  const submitUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await portalRequest(editingId ? `/api/v1/users/${editingId}` : "/api/v1/users", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(form),
      });
      notify(editingId ? "Usuario actualizado en la base de datos." : "Usuario creado y habilitado para iniciar sesión.");
      setShowForm(false);
      setEditingId(null);
      setForm(blankForm);
      setReload((value) => value + 1);
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No fue posible guardar el usuario.", "warning");
    } finally {
      setSaving(false);
    }
  };
  const deleteUser = (user: UserRow) => confirm({
    title: `Quitar acceso de ${user.displayName}`,
    detail: "Se revocará su acceso al sitio activo. Sus accesos a otros sitios se conservarán y la acción quedará registrada en auditoría.",
    confirmLabel: "Quitar acceso",
    tone: "danger",
    onConfirm: async () => {
      try {
        await portalRequest(`/api/v1/users/${user.id}`, { method: "DELETE" });
        notify(`Se quitó el acceso de ${user.displayName} al sitio activo.`);
        if ((result?.items.length ?? 0) === 1 && page > 1) setPage(page - 1);
        else setReload((value) => value + 1);
      } catch (requestError) {
        notify(requestError instanceof Error ? requestError.message : "No fue posible eliminar el usuario.", "warning");
      }
    },
  });

  if (currentRole !== "Administrador") return <PermissionState area="usuarios y roles" />;

  return (
    <>
      <section className="module-summary-grid user-summary-grid"><article><span className="module-summary-icon blue"><Users size={19} /></span><div><small>Usuarios registrados</small><strong>{result?.summary.total ?? 0}</strong><span>{result?.summary.active ?? 0} activos</span></div></article><article><span className="module-summary-icon green"><ShieldCheck size={19} /></span><div><small>Administradores</small><strong>{result?.summary.administrators ?? 0}</strong><span>Acceso total</span></div></article><article><span className="module-summary-icon amber"><Mail size={19} /></span><div><small>Invitaciones pendientes</small><strong>{result?.summary.invited ?? 0}</strong><span>Sin primer acceso</span></div></article></section>
      <article className="panel module-panel users-module">
        <div className="module-toolbar"><div><span className="eyebrow">Control de acceso</span><h2>Equipo con acceso al portal</h2></div><button className="primary-button" onClick={showForm ? () => setShowForm(false) : openCreate}><UserPlus size={16} />{showForm ? "Cancelar" : "Crear usuario"}</button></div>
        {showForm && <form className="user-editor-form" onSubmit={submitUser}><div><span className="eyebrow">{editingId ? "Editar acceso" : "Nuevo acceso"}</span><h3>{editingId ? "Actualizar usuario" : "Crear usuario conectado a PostgreSQL"}</h3></div><label><span>Nombre completo</span><input required minLength={3} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label><span>Correo electrónico</span><input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label><span>{editingId ? "Nueva contraseña (opcional)" : "Contraseña inicial"}</span><input type="password" required={!editingId} minLength={10} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Mínimo 10 caracteres" /></label><label><span>Perfil</span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRow["role"]["key"] })}><option value="administrator">Administrador</option><option value="engineer">Ingeniero</option><option value="operator">Operador</option><option value="viewer">Solo lectura</option></select></label><label><span>Estado</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as UserRow["status"] })}><option value="active">Activo</option><option value="suspended">Suspendido</option><option value="invited">Invitado</option></select></label><fieldset className="user-site-access"><legend>Sitios autorizados</legend><p>El perfil seleccionado se aplicará en cada sitio donde tienes administración.</p><div>{manageableSites.map((site) => <label key={site.id} className={form.siteIds.includes(site.id) ? "selected" : ""}><input type="checkbox" checked={form.siteIds.includes(site.id)} onChange={() => toggleSite(site.id)} /><span><strong>{site.name}</strong><small>{site.clientName} · {site.code}</small></span></label>)}</div>{!form.siteIds.length && <small className="field-error">Selecciona al menos un sitio.</small>}</fieldset><div className="user-editor-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button type="submit" className="primary-button" disabled={saving || !form.siteIds.length}>{saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear usuario"}</button></div></form>}
        <div className="user-list-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar por nombre o correo…" /></label><label className="status-filter"><span>Estado</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="all">Todos</option><option value="active">Activos</option><option value="suspended">Suspendidos</option><option value="invited">Invitados</option></select><ChevronDown size={13} /></label></div>
        {error && <div className="data-error"><AlertTriangle size={18} /><div><strong>No se pudieron cargar los usuarios</strong><p>{error}</p></div></div>}
        {loading && <div className="data-loading"><Refresh className="spin" size={18} /> Consultando usuarios…</div>}
        {!loading && !error && <><div className="module-table-wrap"><div className="users-table"><div className="module-table-head"><span>Usuario</span><span>Rol</span><span>Sitios</span><span>Estado</span><span>Último acceso</span><span>Acciones</span></div>{result?.items.map((user) => <div className="module-table-row" key={user.id}><span className="user-identity"><b>{user.displayName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</b><span><strong>{user.displayName}{user.id === currentUserId ? " · Tú" : ""}</strong><small>{user.email}</small></span></span><span><i className="role-chip">{user.role.name}</i></span><span><i className="site-count-chip">{user.siteIds.length} {user.siteIds.length === 1 ? "sitio" : "sitios"}</i></span><span><i className={`user-status status-${user.status}`}>{user.status === "active" ? "Activo" : user.status === "suspended" ? "Suspendido" : "Invitado"}</i></span><span>{formatDateTime(user.lastLoginAt)}</span><span className="row-actions"><button className="ghost-button" onClick={() => openEdit(user)}><Pencil size={14} /> Editar</button><button className="icon-danger-button" disabled={user.id === currentUserId} onClick={() => deleteUser(user)} aria-label={`Quitar acceso de ${user.displayName} al sitio activo`}><Trash size={15} /></button></span></div>)}{result?.items.length === 0 && <TableEmptyState title="No hay usuarios con estos filtros" detail="Cambia la búsqueda o crea un nuevo acceso." />}</div></div>{result && <Pagination page={result.page} totalPages={result.totalPages} total={result.total} pageSize={result.pageSize} onPageChange={setPage} itemLabel="usuarios" />}</>}
        <div className="role-matrix"><div><span className="eyebrow">Matriz de permisos</span><h3>Alcance de cada rol</h3></div><div className="role-matrix-grid"><span><strong>Administrador</strong><small>Configuración, usuarios y operación completa</small></span><span><strong>Ingeniero</strong><small>Diagnóstico, umbrales y reportes</small></span><span><strong>Operador</strong><small>Supervisión y reconocimiento de alarmas</small></span><span><strong>Solo lectura</strong><small>Consulta sin capacidad de modificación</small></span></div></div>
      </article>
    </>
  );
}

function NotificationsView({ canWrite }: { canWrite: boolean }) {
  const notify = useFeedback();
  const confirm = useConfirm();
  return <DatabaseNotificationsView canWrite={canWrite} notify={notify} confirm={confirm} />;
}
function LoginScreen({ checking, onAuthenticated }: { checking: boolean; onAuthenticated: (user: PortalSessionUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await portalRequest<{ user: PortalSessionUser }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      onAuthenticated(response.user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible iniciar sesión.");
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="login-shell">
    <section className="login-brand-panel">
      <span className="login-brand-mark"><Zap size={28} strokeWidth={2.2} /></span>
      <div><span className="eyebrow">HoitLive Core</span><h1>Condición eléctrica bajo control</h1><p>Supervisión centralizada de clientes, sitios y puntos de medición con trazabilidad operacional.</p></div>
      <dl><div><dt>Estructura</dt><dd>Cliente → Sitio → Punto</dd></div><div><dt>Adquisición</dt><dd>CAM5 → Gateway → HoitLive Core</dd></div><div><dt>Seguridad</dt><dd>Acceso por sitio y perfil</dd></div></dl>
    </section>
    <section className="login-form-panel">
      <div className="login-card">
        <span className="login-security-icon"><ShieldCheck size={24} /></span>
        <span className="eyebrow">Acceso seguro</span>
        <h2>{checking ? "Validando sesión" : "Iniciar sesión"}</h2>
        <p>{checking ? "Estamos comprobando tu acceso al portal." : "Usa el correo y la contraseña creados por el administrador."}</p>
        {checking ? <div className="login-checking"><Refresh className="spin" size={19} /> Consultando sesión…</div> : <form onSubmit={login}>
          <label><span>Correo electrónico</span><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@empresa.cl" /></label>
          <label><span>Contraseña</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tu contraseña" /></label>
          {error && <div className="login-error" role="alert"><AlertTriangle size={16} />{error}</div>}
          <button type="submit" disabled={submitting}>{submitting ? <><Refresh className="spin" size={17} /> Verificando…</> : <><Key size={17} /> Entrar al portal</>}</button>
        </form>}
        <small>Las sesiones duran 12 horas y pueden cerrarse desde cualquier módulo.</small>
      </div>
    </section>
  </main>;
}

export default function Home() {
  const [telemetryState, setTelemetryState] = useState<PortalTelemetryState>({ status: "loading", data: null });
  const sensors = useSensorData(telemetryState);
  const activeSensorRouteKey = sensors.filter((sensor) => sensor.enabled).map((sensor) => sensor.id).join(",");
  const [view, setView] = useState<View>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [period, setPeriod] = useState("24 h");
  const [trendSensorId, setTrendSensorId] = useState("");
  const [trendWindow, setTrendWindow] = useState<TrendWindow | null>(null);
  const [alarmSummary, setAlarmSummary] = useState({ critical: 0, warning: 0 });
  const [alarmPreview, setAlarmPreview] = useState<PortalAlarm[]>([]);
  const [systemMode, setSystemMode] = useState<SystemMode>("loading");
  const [telemetryRefreshKey, setTelemetryRefreshKey] = useState(0);
  const [sessionUser, setSessionUser] = useState<PortalSessionUser | null>(null);
  const [hierarchy, setHierarchy] = useState<PortalHierarchy | null>(null);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [activePointId, setActivePointId] = useState("");
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "anonymous">("checking");
  const [notice, setNotice] = useState<{ id: number; message: string; tone: NoticeTone } | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const notify = (message: string, tone: NoticeTone = "success") => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice({ id: Date.now(), message, tone });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  };

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    let active = true;
    portalRequest<{ user: PortalSessionUser }>("/api/v1/auth/session")
      .then(async (response) => {
        if (!active) return;
        setSessionUser(response.user);
        setAuthState("authenticated");
        setHierarchyLoading(true);
        try {
          const data = await portalRequest<PortalHierarchy>("/api/v1/hierarchy");
          if (active) {
            setHierarchy(data);
            setActivePointId(data.points.find((point) => point.active)?.id ?? "");
          }
        } catch {
          if (active) setHierarchy(null);
        } finally {
          if (active) setHierarchyLoading(false);
        }
      })
      .catch(() => { if (active) setAuthState("anonymous"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authState !== "authenticated" || !hierarchy) return;
    const pointId = activePointId || hierarchy.points[0]?.id;
    if (!pointId) return;
    let active = true;
    const refresh = async () => {
      try {
        const data = await portalRequest<PortalLiveTelemetry>(`/api/v1/telemetry/latest?pointId=${encodeURIComponent(pointId)}`);
        if (!active) return;
        setTelemetryState({ status: "ready", data });
        const enabled = data.items.filter((item) => item.enabled);
        const hasReadings = enabled.some((item) => item.recordedAt !== null);
        const allStale = hasReadings && enabled.every((item) => item.quality === "stale" || item.quality === "bad");
        setSystemMode(data.gateway?.state !== "online" || !hasReadings ? "offline" : allStale ? "stale" : "normal");
      } catch {
        if (!active) return;
        setTelemetryState((current) => ({ status: "error", data: current.data }));
        setSystemMode("offline");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activePointId, authState, hierarchy, telemetryRefreshKey]);

  useEffect(() => {
    if (authState !== "authenticated" || !hierarchy) return;
    const pointId = activePointId || hierarchy.points.find((point) => point.active)?.id;
    if (!pointId) return;
    let active = true;
    const refresh = async () => {
      try {
        const params = new URLSearchParams({ assetId: pointId, status: "active", page: "1", pageSize: "3" });
        const data = await portalRequest<{ items: PortalAlarm[]; summary: { critical: number; warning: number } }>(`/api/v1/alarms?${params}`);
        if (!active) return;
        setAlarmPreview(data.items);
        setAlarmSummary({ critical: data.summary.critical, warning: data.summary.warning });
      } catch {
        if (active) setAlarmPreview([]);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activePointId, authState, hierarchy]);

  const loadHierarchy = async () => {
    setHierarchyLoading(true);
    try {
      const data = await portalRequest<PortalHierarchy>("/api/v1/hierarchy");
      setHierarchy(data);
      setActivePointId((current) => data.points.some((point) => point.id === current && point.active) ? current : data.points.find((point) => point.active)?.id ?? "");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No fue posible cargar la estructura operacional.", "warning");
    } finally {
      setHierarchyLoading(false);
    }
  };

  useEffect(() => {
    const activeSensorIds = new Set(activeSensorRouteKey.split(","));
    const applyRoute = () => {
      const params = new URLSearchParams(window.location.search);
      const nextView = params.get("view");
      if (nextView && Object.prototype.hasOwnProperty.call(viewTitles, nextView)) setView(nextView as View);
      const channel = params.get("channel");
      if (channel && activeSensorIds.has(channel)) setTrendSensorId(channel);
      const routeFrom = params.get("from");
      const routeTo = params.get("to");
      if (nextView === "trends" && routeFrom && routeTo) {
        const fromDate = new Date(routeFrom);
        const toDate = new Date(routeTo);
        if (Number.isFinite(fromDate.getTime()) && Number.isFinite(toDate.getTime()) && fromDate < toDate) {
          setTrendWindow({ from: fromDate.toISOString(), to: toDate.toISOString() });
          setPeriod("Personalizado");
        }
      } else if (nextView === "trends") {
        setTrendWindow(null);
        setPeriod("24 h");
      }
    };
    if (!new URLSearchParams(window.location.search).has("view")) {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "overview");
      window.history.replaceState({}, "", url);
    }
    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => window.removeEventListener("popstate", applyRoute);
  }, [activeSensorRouteKey]);

  const navigate = (next: View, parameters?: Record<string, string>) => {
    setView(next);
    setMenuOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    url.searchParams.delete("channel");
    url.searchParams.delete("record");
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    Object.entries(parameters ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
    window.history.pushState({}, "", url);
  };
  const openChannelTrend = (id: string) => { setTrendWindow(null); setPeriod("24 h"); setTrendSensorId(id); navigate("trends", { channel: id }); };
  const openTrendRange = (id: string, from: string, to: string) => {
    const range = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
    setTrendSensorId(id);
    setTrendWindow(range);
    setPeriod("Personalizado");
    navigate("trends", { channel: id, ...range });
  };
  const openAlarmTrend = (id: string, openedAt: string) => {
    const eventTime = new Date(openedAt).getTime();
    openTrendRange(id, new Date(eventTime - 12 * 3600_000).toISOString(), new Date(Math.min(Date.now(), eventTime + 12 * 3600_000)).toISOString());
  };
  const selectTrendChannel = (id: string) => {
    setTrendSensorId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "trends");
    url.searchParams.set("channel", id);
    window.history.replaceState({}, "", url);
  };
  const acknowledge = (id: string) => {
    void portalRequest(`/api/v1/alarms/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ action: "acknowledge" }) })
      .then(() => {
        setAlarmPreview((current) => current.map((alarm) => alarm.id === id ? { ...alarm, status: "acknowledged" } : alarm));
        notify("Alarma reconocida y registrada en la trazabilidad.");
      })
      .catch((requestError) => notify(requestError instanceof Error ? requestError.message : "No fue posible reconocer la alarma.", "warning"));
  };
  const exportCsv = () => {
    const rows = ["canal,tipo,ubicacion,valor,unidad,estado", ...sensors.filter((sensor) => sensor.enabled).map((sensor) => [sensor.id, sensor.type, sensor.zone, sensor.value, sensor.unit, sensor.state].join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "cam5-telemetria.csv"; anchor.click(); URL.revokeObjectURL(url);
    notify("Telemetría exportada correctamente.", "info");
  };
  const logout = async () => {
    try { await portalRequest("/api/v1/auth/logout", { method: "POST" }); }
    finally { setSessionUser(null); setHierarchy(null); setAuthState("anonymous"); }
  };

  const switchSite = async (siteId: string) => {
    if (siteId === sessionUser?.siteId) return;
    try {
      const response = await portalRequest<{ user: PortalSessionUser }>("/api/v1/auth/context", { method: "PATCH", body: JSON.stringify({ siteId }) });
      setSessionUser(response.user);
      setTelemetryState({ status: "loading", data: null });
      setSystemMode("loading");
      setActivePointId("");
      await loadHierarchy();
      notify(`Contexto cambiado a ${response.user.siteName}.`, "info");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No fue posible cambiar de sitio.", "warning");
    }
  };

  if (authState !== "authenticated" || !sessionUser) return <LoginScreen checking={authState === "checking"} onAuthenticated={(user) => { setSessionUser(user); setAuthState("authenticated"); void loadHierarchy(); }} />;
  const activeRole = sessionUser.roleName;
  const activePoint = hierarchy?.points.find((point) => point.id === activePointId && point.active) ?? hierarchy?.points.find((point) => point.active);
  const activeGateway = hierarchy?.gateways.find((gateway) => gateway.active);
  const activeController = hierarchy?.controllers.find((controller) => controller.active && controller.pointId === activePoint?.id) ?? hierarchy?.controllers.find((controller) => controller.active);
  const gatewayState = telemetryState.data?.gateway?.state ?? activeGateway?.state;
  const gatewayCode = telemetryState.data?.gateway?.code ?? activeGateway?.code;
  const resolvedTrendSensorId = sensors.some((sensor) => sensor.enabled && sensor.id === trendSensorId) ? trendSensorId : sensors.find((sensor) => sensor.enabled)?.id ?? "";

  return (
    <FeedbackContext.Provider value={notify}>
    <ConfirmContext.Provider value={setConfirmRequest}>
    <RoleContext.Provider value={activeRole}>
    <TelemetryContext.Provider value={telemetryState}>
    <div className="app-shell">
      {menuOpen && <button className="mobile-scrim" aria-label="Cerrar navegación" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand-block">
          <span className="brand-mark"><Zap size={22} strokeWidth={2.3} /></span>
          <div className="brand-copy"><span className="brand-name"><strong>HoitLive</strong><b>Core</b></span><small>Monitoreo de condición eléctrica</small></div>
          <button className="sidebar-close" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}><X size={20} /></button>
        </div>

        <nav className="sidebar-nav" aria-label="Navegación principal">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-heading"><span>{group.index}</span><p>{group.label}</p><i /></div>
              <div className="nav-items">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const badgeCount = item.id === "alarms" ? alarmSummary.critical + alarmSummary.warning : item.badge ? Number(item.badge) : null;
                  return (
                    <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}>
                      <span className="nav-item-icon"><Icon size={19} strokeWidth={1.8} /></span>
                      <span className="nav-item-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                      {badgeCount !== null && badgeCount > 0 ? <b>{badgeCount}</b> : <ChevronRight className="nav-chevron" size={16} />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="sidebar-status">
          <div className="gateway-badge"><span className="gateway-icon"><Server size={17} /></span><span><strong>{gatewayState === "online" ? "Adquisición operativa" : "Adquisición en puesta en marcha"}</strong><small>{activeController?.code ?? "Controlador pendiente"} → {gatewayCode ?? "Gateway pendiente"}</small></span><i className={gatewayState === "online" ? "" : "pending"} /></div>
          <button className="user-card" onClick={() => navigate("account")} aria-label="Abrir mi cuenta"><span className="user-avatar">{sessionUser.displayName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span className="user-copy"><strong>{sessionUser.displayName}</strong><small>{sessionUser.roleName}</small></span><ChevronRight size={16} /></button>
          <button className="sidebar-logout" onClick={logout}><LogOut size={17} /> Cerrar sesión</button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-left"><button className="menu-button" aria-label="Abrir navegación" onClick={() => setMenuOpen(true)}><Menu size={22} /></button><span className="mobile-brand"><Zap size={18} fill="currentColor" /></span><div className="operational-context"><Building2 size={17} /><label><span>Cliente</span><select value={sessionUser.clientId} onChange={(event) => { const firstSite = hierarchy?.sites.find((site) => site.active && site.clientId === event.target.value); if (firstSite) void switchSite(firstSite.id); }} aria-label="Cliente activo">{hierarchy?.clients.filter((client) => client.active).map((client) => <option key={client.id} value={client.id}>{client.name}</option>) ?? <option value={sessionUser.clientId}>{sessionUser.clientName}</option>}</select></label><ChevronRight size={14} /><label><span>Sitio</span><select value={sessionUser.siteId} onChange={(event) => void switchSite(event.target.value)} aria-label="Sitio activo">{(hierarchy?.sites ?? sessionUser.sites).filter((site) => site.clientId === sessionUser.clientId && (!("active" in site) || site.active)).map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><ChevronRight size={14} /><label><span>Punto de medición</span><select value={activePoint?.id ?? ""} onChange={(event) => setActivePointId(event.target.value)} aria-label="Punto de medición activo"><option value="">Sin punto seleccionado</option>{hierarchy?.points.filter((point) => point.active).map((point) => <option key={point.id} value={point.id}>{point.code} · {point.name}</option>)}</select></label></div></div>
          <div className="topbar-right"><span className="authenticated-role"><ShieldCheck size={15} /><span><small>Sesión activa</small><strong>{sessionUser.roleName}</strong></span></span><div className={`live-state live-${gatewayState === "online" ? "normal" : "offline"}`}><span /><div><strong>{gatewayState === "online" ? "Adquisición operativa" : "Adquisición pendiente"}</strong><small>{gatewayCode ? `${gatewayCode} · ${gatewayState === "online" ? "en línea" : "sin telemetría"}` : "Gateway no configurado"}</small></div></div><button className="topbar-logout" onClick={logout} aria-label="Cerrar sesión"><LogOut size={18} /></button></div>
        </header>

        <div className="content-scroll">
          <div className="page-content">
            {systemMode !== "normal" && <section className={`operational-banner banner-${systemMode}`} role="alert"><span>{systemMode === "offline" ? <PlugConnected size={19} /> : systemMode === "loading" ? <Refresh className="spin" size={19} /> : <Clock3 size={19} />}</span><div><strong>{systemMode === "offline" ? "Gateway sin comunicación" : systemMode === "loading" ? "Sincronizando datos" : "Las lecturas están atrasadas"}</strong><p>{systemMode === "offline" ? "El portal muestra el último valor recibido cuando existe. Las funciones administrativas siguen disponibles, pero no hay telemetría nueva." : systemMode === "loading" ? "Solicitando la última configuración, lecturas y eventos disponibles." : "Los datos visibles superan el tiempo de frescura configurado. Revisa el enlace antes de tomar una decisión."}</p></div>{systemMode !== "loading" && <button onClick={() => { setSystemMode("loading"); setTelemetryRefreshKey((current) => current + 1); notify("Consultando nuevamente la telemetría.", "info"); }}><Refresh size={15} /> Reintentar</button>}</section>}
            <section className="page-heading"><div><span className="eyebrow"><Activity size={13} /> Gestión de activos críticos</span><h1>{viewTitles[view].title}</h1><p>{viewTitles[view].description}</p></div><div className="heading-actions">{view !== "assets" && view !== "settings" && view !== "users" && view !== "notifications" && view !== "account" && view !== "reports" && view !== "diagnostics" && view !== "commissioning" && view !== "trends" && view !== "history" && <button className="secondary-button" onClick={exportCsv}><Download size={16} /><span>Exportar</span></button>}<button className="primary-button" onClick={() => navigate("alarms")}><BellRing size={16} />{alarmSummary.critical + alarmSummary.warning} alertas activas</button></div></section>
            {view === "overview" && <Overview onNavigate={navigate} onAcknowledge={acknowledge} activeAlarms={alarmPreview} point={activePoint} />}
            {view === "cabinet" && <CabinetView onOpenTrend={openChannelTrend} />}
            {view === "diagnostics" && <DatabaseDiagnosticsView assetId={activePoint?.id ?? ""} canExecute={sessionUser.permissions.includes("diagnostics.execute")} notify={notify} />}
            {view === "commissioning" && <Cam5CommissioningView assetId={activePoint?.id ?? ""} canExecute={sessionUser.permissions.includes("commissioning.execute")} notify={notify} confirm={(request) => setConfirmRequest(request)} onOpenSettings={() => navigate("settings")} onOpenReports={() => navigate("reports")} />}
            {view === "trends" && <TrendsView assetId={activePoint?.id ?? ""} channels={sensors.map((sensor) => ({ id: sensor.id, label: sensor.label, zone: sensor.zone, unit: sensor.unit, state: sensor.state, enabled: sensor.enabled }))} period={period} setPeriod={setPeriod} selectedId={resolvedTrendSensorId} onSelectChannel={selectTrendChannel} onBackToMap={() => navigate("cabinet")} rangeWindow={trendWindow} setRangeWindow={setTrendWindow} canExport={sessionUser.permissions.includes("history.export")} notify={notify} />}
            {view === "alarms" && <AlarmsView assetId={activePoint?.id ?? ""} permissions={sessionUser.permissions} onSummaryChange={setAlarmSummary} onOpenTrend={openAlarmTrend} />}
            {view === "history" && <HistoryView assetId={activePoint?.id ?? ""} canExport={sessionUser.permissions.includes("history.export")} onOpenTrend={openTrendRange} />}
            {view === "assets" && <OperationalHierarchyView hierarchy={hierarchy} loading={hierarchyLoading} permissions={sessionUser.permissions} onReload={loadHierarchy} onSwitchSite={switchSite} />}
            {view === "reports" && <DatabaseReportsView assetId={activePoint?.id ?? ""} assetLabel={activePoint ? `${activePoint.code} · ${activePoint.name}` : "Sin punto seleccionado"} timezone={hierarchy?.sites.find((site) => site.id === sessionUser.siteId)?.timezone ?? "America/Santiago"} canGenerate={sessionUser.permissions.includes("reports.generate")} canSchedule={sessionUser.permissions.includes("reports.schedule")} notify={notify} confirm={(request) => setConfirmRequest(request)} />}
            {view === "settings" && <DatabaseSettingsView assetId={activePoint?.id ?? ""} canWrite={sessionUser.permissions.includes("settings.write")} notify={notify} confirm={(request) => setConfirmRequest(request)} onReloadHierarchy={loadHierarchy} />}
            {view === "users" && <UsersView currentUserId={sessionUser.id} sites={sessionUser.sites} activeSiteId={sessionUser.siteId} />}
            {view === "notifications" && <NotificationsView canWrite={sessionUser.permissions.includes("notifications.write")} />}
            {view === "account" && <AccountView notify={notify} confirm={(request) => setConfirmRequest(request)} onProfileUpdated={(displayName) => setSessionUser((current) => current ? { ...current, displayName } : current)} />}
          </div>
        </div>
      </main>
      {notice && <div className={`portal-notice notice-${notice.tone}`} role="status" aria-live="polite" key={notice.id}><CheckCircle2 size={18} /><span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Cerrar notificación"><X size={16} /></button></div>}
      {confirmRequest && <div className="confirm-backdrop" role="presentation" onMouseDown={() => setConfirmRequest(null)}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}><span className={`confirm-icon ${confirmRequest.tone === "danger" ? "danger" : ""}`}>{confirmRequest.tone === "danger" ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}</span><div><span className="eyebrow">Confirmación requerida</span><h2 id="confirm-title">{confirmRequest.title}</h2><p>{confirmRequest.detail}</p></div><div className="confirm-actions"><button className="secondary-button" onClick={() => setConfirmRequest(null)}>Cancelar</button><button className={confirmRequest.tone === "danger" ? "danger-button" : "primary-button"} onClick={() => { const action = confirmRequest.onConfirm; setConfirmRequest(null); action(); }}>{confirmRequest.confirmLabel}</button></div></section></div>}
    </div>
    </TelemetryContext.Provider>
    </RoleContext.Provider>
    </ConfirmContext.Provider>
    </FeedbackContext.Provider>
  );
}

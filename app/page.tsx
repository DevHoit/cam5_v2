"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { usePersistentState } from "./use-persistent-state";
import { Cam5CommissioningView } from "./cam5-engineering";
import { cam5OperationalChannels, cam5PdMetrics, cam5RegisterCatalog } from "./cam5-model";
import { Pagination, useClientPagination } from "./pagination";
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
  IconCopy as Copy,
  IconClock as Clock3,
  IconCalendarEvent as CalendarEvent,
  IconDatabase as Database,
  IconDeviceDesktopAnalytics as MonitorDot,
  IconDeviceFloppy as Save,
  IconDownload as Download,
  IconDroplet as Droplets,
  IconFileReport as FileReport,
  IconFileTypePdf as FileTypePdf,
  IconGauge as Gauge,
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
  IconPrinter as Printer,
  IconRadio as Radio,
  IconRefresh as Refresh,
  IconSearch as Search,
  IconServer as Server,
  IconSettings as Settings,
  IconShieldCheck as ShieldCheck,
  IconTemperature as Thermometer,
  IconTimeline as Timeline,
  IconTool as Tool,
  IconTrash as Trash,
  IconTrendingUp as TrendingUp,
  IconUserPlus as UserPlus,
  IconUsers as Users,
  IconWifi as Wifi,
  IconWebhook as Webhook,
  IconX as X,
} from "@tabler/icons-react";

type View = "overview" | "cabinet" | "diagnostics" | "commissioning" | "trends" | "alarms" | "history" | "assets" | "reports" | "maintenance" | "settings" | "integrations" | "users" | "notifications";
type Severity = "critical" | "warning" | "info";
type SensorState = "normal" | "warning" | "critical";
type HistoryTab = "measurements" | "alarms" | "audit";
type SettingsTab = "asset" | "channels" | "registers" | "gateway";
type ModbusDataType = "Int16" | "UInt16";
type ModbusByteOrder = "AB" | "BA";
type UserRole = "Administrador" | "Ingeniero" | "Operador" | "Solo lectura";
type WorkStatus = "Pendiente" | "En curso" | "Completada";
type WorkPriority = "Crítica" | "Alta" | "Normal";
type WorkOrder = { id: string; title: string; source: string; sourceAlarmId?: string; due: string; priority: WorkPriority; assignee: string; status: WorkStatus };
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
  point: { id: string; code: string; name: string; state: PortalHierarchy["points"][number]["state"] };
  gateway: { id: string; code: string; state: PortalHierarchy["gateways"][number]["state"]; lastSeenAt: string | null } | null;
  device: { id: string; code: string; state: string; lastReadAt: string | null } | null;
  staleAfterSeconds: number;
  items: Array<{
    id: string;
    code: string;
    name: string;
    zone: string | null;
    metric: string;
    unit: string;
    enabled: boolean;
    register: number;
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

function formatDateTime(value?: string | null) {
  if (!value) return "Sin acceso";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

const sensors = cam5OperationalChannels;

const defaultAssetConfig = { name: "MCC-01", description: "Alimentador Norte", voltage: "13.8", location: "Subestación Norte", timezone: "America/Santiago" };

function defaultChannelConfiguration() {
  return sensors.map((sensor) => ({
    ...sensor,
    enabled: sensor.configured,
    warning: String(sensor.warningDefault),
    critical: String(sensor.criticalDefault),
  }));
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
  const [configuration] = usePersistentState("cam5.front.channel-config.v2", defaultChannelConfiguration());
  const context = useContext(TelemetryContext);
  const telemetry = override ?? context;
  return sensors.map((sensor) => {
    const configured = configuration.find((item) => item.id === sensor.id);
    const live = telemetry.data?.items.find((item) => item.code === sensor.id);
    const warning = live?.warningThreshold ?? Number(configured?.warning ?? sensor.threshold.split(" ")[0]);
    const critical = live?.criticalThreshold ?? Number(configured?.critical ?? warning + 10);
    const reading = live ? live.value : telemetry.status === "preview" ? Number(sensor.value) : null;
    const enabled = live?.enabled ?? configured?.enabled ?? sensor.configured;
    const state: SensorState = live?.severity ?? (enabled && reading !== null && Number.isFinite(reading) ? reading >= critical ? "critical" : reading >= warning ? "warning" : "normal" : "normal");
    const activeThreshold = state === "critical" ? critical : warning;
    const quality = !enabled
      ? "Deshabilitado"
      : live?.quality === "good"
        ? "Válida"
        : live?.quality === "stale"
          ? "Atrasada"
          : live?.quality === "bad"
            ? "Inválida"
            : telemetry.status === "loading"
              ? "Esperando datos"
              : telemetry.status === "error"
                ? "Sin comunicación"
                : sensor.quality;
    return {
      ...sensor,
      enabled,
      warning,
      critical,
      state,
      value: live ? formatTelemetryValue(live.value, sensor.unit) : telemetry.status === "preview" ? sensor.value : "—",
      threshold: `${activeThreshold} ${sensor.unit}`,
      quality,
      trend: live ? telemetryAge(live.recordedAt) : telemetry.status === "preview" ? sensor.trend : "Sin telemetría",
    };
  });
}

const initialAlarms = [
  { id: "AL-260811-031", severity: "critical" as Severity, title: "Aceleración de descarga parcial", detail: "PD1 · Compartimiento de cables", since: "Hace 12 min", value: "Φ 2.8×", acknowledged: false },
  { id: "AL-260811-028", severity: "warning" as Severity, title: "Diferencial térmico elevado", detail: "T01 Barra L1 vs. L2/L3", since: "Hace 34 min", value: "+15.6 °C", acknowledged: false },
  { id: "AL-260811-019", severity: "warning" as Severity, title: "Humedad sobre umbral", detail: "H01 Ambiente cabina", since: "Hace 2 h", value: "78 %RH", acknowledged: false },
  { id: "AL-260810-104", severity: "info" as Severity, title: "Sincronización recuperada", detail: "Gateway CAM5-GW-01", since: "Ayer 18:42", value: "Resuelta", acknowledged: true },
];

const initialWorkOrders: WorkOrder[] = [
  { id: "OT-260811-018", title: "Diagnóstico de descarga parcial", source: "PD1 · Evento AL-260811-031", sourceAlarmId: "AL-260811-031", due: "Hoy · 16:00", priority: "Crítica", assignee: "Emerson Allende", status: "En curso" },
  { id: "OT-260811-017", title: "Inspección termográfica dirigida", source: "T01 · Evento AL-260811-028", sourceAlarmId: "AL-260811-028", due: "21 ago 2026", priority: "Alta", assignee: "Paula Rojas", status: "Pendiente" },
  { id: "OT-260810-014", title: "Control de humedad en cabina", source: "H01 · Evento AL-260811-019", sourceAlarmId: "AL-260811-019", due: "22 ago 2026", priority: "Alta", assignee: "Felipe Soto", status: "Pendiente" },
  { id: "OT-260731-009", title: "Verificación mensual de gateway", source: "Plan preventivo PM-04", due: "31 jul 2026", priority: "Normal", assignee: "Felipe Soto", status: "Completada" },
];

const chartData = [
  [42, 16], [44, 18], [43, 17], [46, 19], [48, 21], [47, 22], [50, 24], [51, 27],
  [53, 31], [52, 30], [55, 36], [57, 39], [58, 42], [60, 46], [62, 51], [61, 50],
  [63, 55], [65, 59], [64, 61], [66, 66], [67, 70], [68, 72], [67, 71], [68, 74],
];

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
      { id: "diagnostics" as View, label: "Diagnóstico OT", description: "Controlador y gateway", icon: Radio },
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
      { id: "maintenance" as View, label: "Mantenimiento", description: "Planes y órdenes", icon: Tool },
    ],
  },
  {
    index: "04",
    label: "Administración",
    items: [
      { id: "settings" as View, label: "Configuración", description: "Activo, Modbus y gateway", icon: Settings },
      { id: "integrations" as View, label: "Integraciones", description: "Datos y sistemas externos", icon: PlugConnected },
      { id: "users" as View, label: "Usuarios y roles", description: "Acceso y permisos", icon: Users },
      { id: "notifications" as View, label: "Notificaciones", description: "Canales y escalamiento", icon: Mail },
    ],
  },
];

const viewTitles: Record<View, { title: string; description: string }> = {
  overview: { title: "Resumen de condición", description: "Estado predictivo de activos críticos en tiempo real." },
  cabinet: { title: "Mapa de condición", description: "Ubicación, lectura y estado de cada canal instrumentado." },
  diagnostics: { title: "Diagnóstico OT", description: "Puesta en marcha y comprobación de la cadena Controlador → Gateway → HoitLive Core." },
  commissioning: { title: "Puesta en marcha CAM-5", description: "Identidad, entradas, registros, alarmas y controles previos a la conexión productiva." },
  trends: { title: "Tendencias", description: "Evolución térmica, descarga parcial y humedad ambiental." },
  alarms: { title: "Centro de alertas", description: "Triage operativo, reconocimiento y trazabilidad de eventos." },
  history: { title: "Histórico", description: "Mediciones, alarmas y cambios administrativos en una sola trazabilidad." },
  assets: { title: "Estructura operacional", description: "Clientes, sitios, puntos de medición, gateways y controladores asociados." },
  reports: { title: "Reportes", description: "Informes de condición, eventos y cumplimiento para operación y mantenimiento." },
  maintenance: { title: "Mantenimiento", description: "Plan preventivo y órdenes de trabajo priorizadas por condición." },
  settings: { title: "Configuración", description: "Parámetros del activo, canales de adquisición y comunicaciones." },
  integrations: { title: "Integraciones", description: "Conexiones, flujo de datos y acceso seguro para sistemas externos." },
  users: { title: "Usuarios y roles", description: "Control de acceso y permisos para la operación OT." },
  notifications: { title: "Notificaciones", description: "Canales de entrega, reglas de escalamiento y trazabilidad." },
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

function SensorMarker({ id, selectedId, onSelect }: { id: string; selectedId?: string; onSelect?: (id: string) => void }) {
  const sensors = useSensorData();
  const sensor = sensors.find((item) => item.id === id)!;
  const stateLabel = !sensor.enabled ? "No configurado" : sensor.state === "critical" ? "Crítico" : sensor.state === "warning" ? "Advertencia" : "Normal";
  return (
    <button
      type="button"
      className={`sensor-marker ${sensor.enabled ? `marker-${sensor.state}` : "marker-disabled"} ${selectedId === id ? "selected" : ""}`}
      aria-label={`${sensor.id}, ${sensor.label}, ${sensor.value} ${sensor.unit}, ${sensor.state}`}
      aria-pressed={selectedId === id}
      disabled={!sensor.enabled}
      onClick={() => onSelect?.(id)}
    >
      <span className="sensor-marker-top"><span className="sensor-marker-id">{sensor.id}</span><span className="sensor-marker-state"><i />{stateLabel}</span></span>
      <strong className="sensor-marker-value">{sensor.value}<small>{sensor.unit}</small></strong>
      <span className="sensor-marker-label">{sensor.label}</span>
    </button>
  );
}

function CabinetDiagram({ selectedId, onSelect }: { selectedId?: string; onSelect?: (id: string) => void }) {
  const telemetry = useContext(TelemetryContext).data;
  const gatewayOnline = telemetry?.gateway?.state === "online";
  return (
    <div className="condition-map" aria-label="Mapa de condición de la cabina MCC-01">
      <div className="condition-map-header"><span className="map-asset-icon"><CircuitBoard size={20} /></span><div><strong>MCC-01</strong><small>13.8 kV · Alimentador Norte</small></div><b>CAM5-01</b></div>

      <div className="condition-map-zones">
        <section className="equipment-zone">
          <header className="zone-header"><span className="zone-index">01</span><div><h3>Barras principales</h3><p>Temperatura por fase y actividad UHF</p></div><span className="zone-status warning"><i />1 advertencia</span></header>
          <div className="bus-map">
            <div className="phase-rows">
              <div className="phase-row"><span className="phase-tag phase-l1">L1</span><span className="phase-line" /><SensorMarker id="T01" selectedId={selectedId} onSelect={onSelect} /></div>
              <div className="phase-row"><span className="phase-tag">L2</span><span className="phase-line" /><SensorMarker id="T02" selectedId={selectedId} onSelect={onSelect} /></div>
              <div className="phase-row"><span className="phase-tag">L3</span><span className="phase-line" /><SensorMarker id="T03" selectedId={selectedId} onSelect={onSelect} /></div>
            </div>
            <div className="aux-channel"><span>Monitoreo UHF</span><SensorMarker id="PD2" selectedId={selectedId} onSelect={onSelect} /></div>
          </div>
        </section>

        <section className="equipment-zone">
          <header className="zone-header"><span className="zone-index">02</span><div><h3>Interruptor de potencia</h3><p>Temperatura de contactos superior e inferior</p></div><span className="zone-status normal"><i />Condición normal</span></header>
          <div className="breaker-map">
            <SensorMarker id="T04" selectedId={selectedId} onSelect={onSelect} />
            <span className="device-connector" />
            <div className="breaker-device"><strong>52</strong><span>Interruptor CA</span></div>
            <span className="device-connector" />
            <SensorMarker id="T05" selectedId={selectedId} onSelect={onSelect} />
          </div>
        </section>

        <section className="equipment-zone zone-critical">
          <header className="zone-header"><span className="zone-index">03</span><div><h3>Compartimiento de cables</h3><p>Descarga parcial y humedad ambiental</p></div><span className="zone-status critical"><i />1 crítico · 1 advertencia</span></header>
          <div className="cable-map">
            <SensorMarker id="H01" selectedId={selectedId} onSelect={onSelect} />
            <div className="cable-device"><div><span><b>L1</b><i /></span><span><b>L2</b><i /></span><span><b>L3</b><i /></span></div><small>Salida de cables</small></div>
            <SensorMarker id="PD1" selectedId={selectedId} onSelect={onSelect} />
          </div>
        </section>
      </div>

      <div className="condition-map-footer"><span><Wifi size={15} /><span><strong>{telemetry?.device?.code ?? "CAM5-CTRL-01"}</strong><small>Modbus TCP · vía {telemetry?.gateway?.code ?? "CAM5-GW-01"} · {telemetryAge(telemetry?.device?.lastReadAt ?? null).toLowerCase()}</small></span></span><StatusPill state={gatewayOnline ? "online" : "offline"}>{gatewayOnline ? "En línea" : "Sin conexión"}</StatusPill></div>
    </div>
  );
}

function Overview({ onNavigate, onAcknowledge, acknowledged }: { onNavigate: (view: View) => void; onAcknowledge: (id: string) => void; acknowledged: string[] }) {
  const sensors = useSensorData();
  const [assetConfig] = usePersistentState("cam5.front.asset-config", defaultAssetConfig);
  const activeSensors = sensors.filter((sensor) => sensor.enabled);
  const activeInputCount = new Set(activeSensors.map((sensor) => sensor.sourceId)).size;
  const temperature = activeSensors.filter((sensor) => sensor.type === "Temperatura").sort((a, b) => Number(b.value) - Number(a.value))[0];
  const partialDischarge = activeSensors.find((sensor) => sensor.id === "PD1");
  const humidity = activeSensors.find((sensor) => sensor.id === "H01");
  const conditionCounts = {
    critical: activeSensors.filter((sensor) => sensor.state === "critical").length,
    warning: activeSensors.filter((sensor) => sensor.state === "warning").length,
    normal: activeSensors.filter((sensor) => sensor.state === "normal").length,
  };
  const activeAlarms = initialAlarms.filter((alarm) => !alarm.acknowledged && !acknowledged.includes(alarm.id));
  return (
    <>
      <section className="metrics-grid">
        <MetricCard label="Temperatura máxima" value={temperature?.value ?? "—"} unit={temperature?.unit} note={temperature ? `${temperature.id} · ${temperature.trend}` : "Sin canales activos"} tone={temperature?.state === "critical" ? "red" : temperature?.state === "warning" ? "amber" : "green"} icon={Thermometer} />
        <MetricCard label="Descarga parcial" value={partialDischarge?.value ?? "—"} unit={partialDischarge?.unit} note={partialDischarge ? `${partialDischarge.id} · ${partialDischarge.trend}` : "Canal deshabilitado"} tone={partialDischarge?.state === "critical" ? "red" : partialDischarge?.state === "warning" ? "amber" : "green"} icon={Activity} />
        <MetricCard label="Humedad relativa" value={humidity?.value ?? "—"} unit={humidity?.unit} note={humidity ? `${humidity.id} · ${humidity.trend}` : "Canal deshabilitado"} tone={humidity?.state === "critical" ? "red" : humidity?.state === "warning" ? "amber" : "blue"} icon={Droplets} />
        <MetricCard label="Entradas supervisadas" value={`${activeInputCount}/24`} note={`${activeSensors.length} señales de telemetría activas`} tone="green" icon={Server} />
      </section>

      <section className="overview-grid">
        <article className="panel asset-summary-panel">
          <div className="panel-header asset-summary-header">
            <div><span className="eyebrow">Punto de medición prioritario</span><h2>{assetConfig.name} · {assetConfig.description}</h2><p>Cabina de {assetConfig.voltage} kV · condición consolidada</p></div>
            <StatusPill state="critical">Atención prioritaria</StatusPill>
          </div>

          <div className="asset-summary-body">
            <section className="primary-finding" aria-label="Hallazgo de mayor prioridad">
              <div className="finding-heading">
                <span className="finding-icon"><AlertTriangle size={20} /></span>
                <div><span>Evento de mayor prioridad</span><h3>Descarga parcial en aceleración</h3><p>PD1 · Compartimiento de cables · activo hace 12 min</p></div>
                <strong>72<small>idx</small></strong>
              </div>
              <div className="finding-evidence">
                <div><span>Aceleración</span><strong>Φ 2.8×</strong></div>
                <div><span>Umbral configurado</span><strong>60 idx</strong></div>
                <div><span>Prioridad sugerida</span><strong>Inspección en terreno</strong></div>
              </div>
              <div className="finding-action"><ShieldCheck size={17} /><p><strong>Acción recomendada:</strong> revisar terminaciones y cableado del compartimiento antes del próximo ciclo de carga.</p></div>
            </section>

            <aside className="condition-summary" aria-label="Resumen de canales">
              <div className="condition-summary-title"><div><span className="eyebrow">Estado actual</span><h3>{activeSensors.length} canales supervisados</h3></div><span className="online-mini"><i />Datos sincronizados</span></div>
              <div className="condition-counts">
                <div className="count-critical"><strong>{conditionCounts.critical}</strong><span>Crítico</span></div>
                <div className="count-warning"><strong>{conditionCounts.warning}</strong><span>Advertencia</span></div>
                <div className="count-normal"><strong>{conditionCounts.normal}</strong><span>Normal</span></div>
              </div>
              <div className="secondary-findings">
                <div><span className="sensor-code sensor-warning">T01</span><p><strong>68.4 °C</strong><small>Barra L1 · sobre umbral</small></p><b>+1.8 °C/h</b></div>
                <div><span className="sensor-code sensor-warning">H01</span><p><strong>78 %RH</strong><small>Humedad de cabina elevada</small></p><b>+4 % / 24h</b></div>
              </div>
            </aside>
          </div>

          <div className="asset-summary-footer"><span><Wifi size={15} /> CAM5-GW-01 · 42 ms</span><button onClick={() => onNavigate("cabinet")}>Revisar condición del activo <ChevronRight size={16} /></button></div>
        </article>

        <article className="panel alarms-panel">
          <div className="panel-header compact">
            <div><span className="eyebrow">Triage</span><h2>Alarmas activas</h2></div>
            <button className="icon-button" aria-label="Abrir centro de alertas" onClick={() => onNavigate("alarms")}><BellRing size={18} /></button>
          </div>
          <div className="alarm-list">
            {activeAlarms.slice(0, 3).map((alarm) => (
              <div className={`alarm-item alarm-${alarm.severity}`} key={alarm.id}>
                <div className="alarm-indicator"><AlertTriangle size={17} /></div>
                <div className="alarm-copy"><strong>{alarm.title}</strong><span>{alarm.detail}</span><small>{alarm.since}</small></div>
                <div className="alarm-side"><b>{alarm.value}</b><button onClick={() => onAcknowledge(alarm.id)}>Reconocer</button></div>
              </div>
            ))}
          </div>
          <button className="text-action" onClick={() => onNavigate("alarms")}>Ver todas las alertas <span>→</span></button>
        </article>
      </section>

      <section className="lower-grid">
        <article className="panel trend-preview">
          <div className="panel-header compact"><div><span className="eyebrow">Últimas 24 horas</span><h2>Tendencia combinada</h2></div><StatusPill state="critical">PD acelerando</StatusPill></div>
          <div className="mini-chart" aria-label="Gráfico de temperatura y descarga parcial">
            {chartData.map(([temp, pd], index) => <span key={index}><i style={{ height: `${temp}%` }} /><b style={{ height: `${pd}%` }} /></span>)}
          </div>
          <div className="chart-legend"><span><i className="legend-temp" />Temperatura T01</span><span><i className="legend-pd" />Índice PD1</span><button onClick={() => onNavigate("trends")}>Analizar tendencia</button></div>
        </article>
        <article className="panel connection-panel">
          <div className="panel-header compact"><div><span className="eyebrow">Comunicaciones</span><h2>Salud del gateway</h2></div><Radio size={20} className="brand-icon" /></div>
          <div className="connection-score"><strong>99.96%</strong><span>Disponibilidad 30 días</span></div>
          <dl className="connection-stats"><div><dt>Último dato</dt><dd>Hace 2 s</dd></div><div><dt>Protocolo</dt><dd>Modbus TCP</dd></div><div><dt>Latencia</dt><dd>42 ms</dd></div></dl>
          <div className="freshness"><span style={{ width: "96%" }} /></div>
        </article>
      </section>
    </>
  );
}

function CabinetView({ onOpenTrend }: { onOpenTrend: (id: string) => void }) {
  const sensors = useSensorData();
  const activeSensors = sensors.filter((sensor) => sensor.enabled);
  const activeInputCount = new Set(activeSensors.map((sensor) => sensor.sourceId)).size;
  const [selectedId, setSelectedId] = useState("PD1");
  const selected = sensors.find((sensor) => sensor.id === selectedId && sensor.enabled) ?? sensors.find((sensor) => sensor.enabled) ?? sensors[0];
  const SelectedIcon = selected.metric === "temperature" || selected.metric === "ambient" ? Thermometer : selected.metric === "humidity" ? Droplets : Activity;
  const selectedStateLabel = !selected.enabled ? "No configurado" : selected.state === "critical" ? "Crítico" : selected.state === "warning" ? "Advertencia" : "Normal";

  return (
    <section className="cabinet-view-grid">
      <article className="panel cabinet-full-panel">
        <div className="panel-header"><div><span className="eyebrow">Mapa de condición de la cabina</span><h2>MCC-01 · Alimentador Norte</h2><p>{activeInputCount} entradas asignadas · {24 - activeInputCount} disponibles · {activeSensors.length} señales</p></div><StatusPill state="critical">{activeSensors.filter((sensor) => sensor.state === "critical").length} crítico · {activeSensors.filter((sensor) => sensor.state === "warning").length} advertencias</StatusPill></div>
        <CabinetDiagram selectedId={selectedId} onSelect={setSelectedId} />
        <div className="diagram-legend"><span><i className="dot-normal" />Normal</span><span><i className="dot-warning" />Advertencia</span><span><i className="dot-critical" />Crítico</span><span><i className="dot-disabled" />No configurado</span><small>Selecciona una tarjeta para revisar el canal.</small></div>
      </article>
      <article className="panel sensor-panel">
        <div className={`selected-sensor-card selected-${selected.state}`}>
          <div className="selected-sensor-head"><span className="selected-sensor-icon"><SelectedIcon size={21} /></span><div><small>Canal seleccionado</small><strong>{selected.id} · {selected.type}</strong></div><StatusPill state={selected.state}>{selectedStateLabel}</StatusPill></div>
          <div className="selected-sensor-value">{selected.value}<span>{selected.unit}</span></div>
          <p>{selected.label} · {selected.zone}</p>
          <dl><div><dt>Tendencia</dt><dd>{selected.trend}</dd></div><div><dt>Umbral</dt><dd>{selected.threshold}</dd></div><div><dt>Registro CAM-5</dt><dd>{selected.nativeRegister} · {selected.register}</dd></div><div><dt>Calidad</dt><dd>{selected.quality}</dd></div></dl>
          <button type="button" onClick={() => onOpenTrend(selected.id)}>Abrir tendencia del canal <TrendingUp size={16} /></button>
        </div>
        <div className="panel-header compact sensor-list-header"><div><span className="eyebrow">Canales configurados</span><h2>Matriz de sensores</h2></div><span className="data-fresh"><Wifi size={14} /> Hace 2 s</span></div>
        <div className="sensor-list">
          {activeSensors.map((sensor) => (
            <button type="button" className={`sensor-row ${!sensor.enabled ? "disabled" : ""} ${selectedId === sensor.id ? "selected" : ""}`} key={sensor.id} onClick={() => setSelectedId(sensor.id)} disabled={!sensor.enabled}>
              <span className={`sensor-code sensor-${sensor.state}`}>{sensor.id}</span>
              <div><strong>{sensor.label}</strong><small>{sensor.zone}</small></div>
              <div className="sensor-reading"><strong>{sensor.value}<small>{sensor.unit}</small></strong><span>{sensor.trend}</span></div>
            </button>
          ))}
        </div>
      </article>
    </section>
  );
}

function TrendsView({ period, setPeriod, selectedId, onSelectChannel, onBackToMap }: { period: string; setPeriod: (period: string) => void; selectedId: string; onSelectChannel: (id: string) => void; onBackToMap: () => void }) {
  const sensors = useSensorData();
  const [pdMetric, setPdMetric] = useState<(typeof cam5PdMetrics)[number]["key"]>("total");
  const [pdScale, setPdScale] = useState<"lineal" | "log">("lineal");
  const activeSensors = sensors.filter((sensor) => sensor.enabled);
  const selected = activeSensors.find((sensor) => sensor.id === selectedId) ?? activeSensors[0] ?? sensors[0];
  const isDischarge = selected.metric === "pd" || selected.metric === "sd";
  const supportsUhfMetrics = selected.metric === "pd";
  const pdMetricDefinition = cam5PdMetrics.find((metric) => metric.key === pdMetric) ?? cam5PdMetrics[0];
  const currentValue = supportsUhfMetrics && selected.id === "PD1" ? pdMetricDefinition.value : Number(selected.value);
  const displayUnit = supportsUhfMetrics && pdMetric === "phi" ? "×" : selected.unit;
  const thresholdValue = supportsUhfMetrics && pdMetric === "phi" ? 2 : Number.parseFloat(selected.threshold);
  const amplitude = isDischarge ? (selected.state === "critical" ? Math.max(2, currentValue * .66) : 8) : selected.type === "Humedad" ? 14 : selected.state === "warning" ? 17 : 5;
  const profile = [-1, -.96, -.98, -.9, -.84, -.87, -.78, -.73, -.68, -.7, -.62, -.56, -.5, -.45, -.38, -.4, -.3, -.25, -.27, -.18, -.12, -.08, -.05, 0];
  const series = profile.map((point) => Math.max(0, Number((currentValue + point * amplitude).toFixed(1))));
  const chartMax = Math.ceil(Math.max(currentValue, thresholdValue, ...series) * 1.15 / 10) * 10;
  const variation = currentValue - series[0];
  const stateLabel = selected.state === "critical" ? "Crítico" : selected.state === "warning" ? "Advertencia" : "Normal";
  const stateTone = selected.state === "critical" ? "red" : selected.state === "warning" ? "amber" : "green";
  const SelectedIcon = selected.metric === "temperature" || selected.metric === "ambient" ? Thermometer : selected.metric === "humidity" ? Droplets : Activity;
  const insight = selected.state === "critical"
    ? `${selected.id} mantiene crecimiento sostenido y supera el umbral configurado. Se recomienda inspección prioritaria de ${selected.zone.toLowerCase()}.`
    : selected.state === "warning"
      ? `${selected.id} se encuentra sobre el umbral operativo y presenta una tendencia ascendente. Conviene verificar el activo durante el próximo ciclo de carga.`
      : `${selected.id} permanece dentro del rango esperado y sin cambios relevantes durante el periodo seleccionado.`;

  return (
    <>
      <section className="toolbar-row">
        <div className="trend-toolbar-controls">
          <label className="channel-select"><Activity size={16} /><span><small>Canal</small><select value={selected.id} onChange={(event) => onSelectChannel(event.target.value)} aria-label="Seleccionar canal de tendencia">{activeSensors.map((sensor) => <option key={sensor.id} value={sensor.id}>{sensor.id} · {sensor.label}</option>)}</select></span><ChevronDown size={14} /></label>
          <div className="segmented" aria-label="Rango temporal">{["24 h", "7 días", "30 días"].map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div>
        </div>
      </section>
      {supportsUhfMetrics && <section className="pd-analysis-toolbar"><div><span>Variable UHF</span>{cam5PdMetrics.map((metric) => <button key={metric.key} className={pdMetric === metric.key ? "active" : ""} onClick={() => setPdMetric(metric.key)}>{metric.label}</button>)}</div><label><span>Escala</span><select value={pdScale} onChange={(event) => setPdScale(event.target.value as typeof pdScale)}><option value="lineal">Lineal</option><option value="log">Logarítmica</option></select><ChevronDown size={12} /></label><p>{pdMetricDefinition.description} · magnitud UHF aproximada y no lineal</p></section>}
      <section className="metrics-grid compact-metrics">
        <MetricCard label={supportsUhfMetrics ? pdMetricDefinition.label : "Lectura actual"} value={String(currentValue)} unit={displayUnit} note={`${selected.id} · ${selected.label}`} tone={stateTone} icon={SelectedIcon} />
        <MetricCard label="Umbral configurado" value={String(thresholdValue)} unit={displayUnit} note={currentValue > thresholdValue ? "Umbral superado" : "Dentro del rango"} tone={currentValue > thresholdValue ? "amber" : "green"} icon={Gauge} />
        <MetricCard label="Variación del periodo" value={`${variation >= 0 ? "+" : ""}${variation.toFixed(1)}`} unit={displayUnit} note={selected.trend} tone="blue" icon={TrendingUp} />
        <MetricCard label="Calidad del dato" value="100" unit="%" note={`${selected.quality} · actualizado hace 2 s`} tone="green" icon={ShieldCheck} />
      </section>
      <article className="panel chart-panel">
        <div className="panel-header"><div><span className="eyebrow">{selected.id} · Resolución 1 hora · {period}</span><h2>{selected.label}{supportsUhfMetrics ? ` · ${pdMetricDefinition.label}` : ""}</h2><p>{selected.zone} · {selected.type}{supportsUhfMetrics ? ` · escala ${pdScale}` : ""}</p></div><StatusPill state={selected.state}>{stateLabel}</StatusPill></div>
        <div className="chart-scale"><span>{chartMax}</span><span>{Math.round(chartMax * .75)}</span><span>{Math.round(chartMax * .5)}</span><span>{Math.round(chartMax * .25)}</span><span>0</span></div>
        <div className={`large-chart channel-chart chart-${selected.state}`}>
          <div className="threshold-line" style={{ bottom: `${Math.min(100, thresholdValue / chartMax * 100)}%` }}><span>Umbral {thresholdValue} {displayUnit}</span></div>
          {series.map((value, index) => <span key={index} title={`${String(index).padStart(2, "0")}:00 · ${value} ${displayUnit}`}><i style={{ height: `${Math.max(3, value / chartMax * 100)}%` }} /></span>)}
        </div>
        <div className="chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
        <div className="chart-legend centered"><span><i className={`legend-channel legend-${selected.state}`} />{selected.id} · {supportsUhfMetrics ? pdMetricDefinition.label : displayUnit}</span><span><i className="legend-threshold" />Umbral {thresholdValue} {displayUnit}</span></div>
      </article>
      <article className={`panel insight-panel insight-${selected.state}`}><span className="insight-icon"><TrendingUp size={20} /></span><div><strong>Interpretación del canal</strong><p>{insight}</p></div><button onClick={onBackToMap}><CircuitBoard size={15} /> Volver al mapa</button></article>
    </>
  );
}

function AlarmsView({ acknowledged, onAcknowledge, workOrders, onOpenWorkOrder, closedIds, setClosedIds, assignees, setAssignees, notes, setNotes }: { acknowledged: string[]; onAcknowledge: (id: string) => void; workOrders: WorkOrder[]; onOpenWorkOrder: (alarm: (typeof initialAlarms)[number], assignee: string) => void; closedIds: string[]; setClosedIds: React.Dispatch<React.SetStateAction<string[]>>; assignees: Record<string, string>; setAssignees: React.Dispatch<React.SetStateAction<Record<string, string>>>; notes: Record<string, string[]>; setNotes: React.Dispatch<React.SetStateAction<Record<string, string[]>>> }) {
  const notify = useFeedback();
  const confirm = useConfirm();
  const role = useActiveRole();
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const [workflowStatus, setWorkflowStatus] = useState<"all" | "open" | "acknowledged" | "closed">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(initialAlarms[0].id);
  const [noteInput, setNoteInput] = useState("");
  const getWorkflowStatus = (alarm: (typeof initialAlarms)[number]) => closedIds.includes(alarm.id) ? "closed" : alarm.acknowledged || acknowledged.includes(alarm.id) ? "acknowledged" : "open";
  const filtered = initialAlarms.filter((alarm) => (severity === "all" || alarm.severity === severity) && (workflowStatus === "all" || getWorkflowStatus(alarm) === workflowStatus) && `${alarm.title} ${alarm.detail}`.toLowerCase().includes(query.toLowerCase()));
  const alarmPage = useClientPagination(filtered, 6);
  const selected = filtered.find((alarm) => alarm.id === selectedId) ?? filtered[0] ?? initialAlarms[0];
  const selectedStatus = getWorkflowStatus(selected);
  const selectedNotes = notes[selected.id] ?? [];
  const linkedOrder = workOrders.find((order) => order.sourceAlarmId === selected.id);
  const interventionComplete = linkedOrder?.status === "Completada";
  const addNote = (event: React.FormEvent) => { event.preventDefault(); if (!noteInput.trim()) return; setNotes((current) => ({ ...current, [selected.id]: [...(current[selected.id] ?? []), noteInput.trim()] })); setNoteInput(""); };
  const closeEvent = () => confirm({ title: `Cerrar ${selected.id}`, detail: "Confirma que la condición fue revisada y que no requiere seguimiento operativo adicional.", confirmLabel: "Cerrar evento", tone: "danger", onConfirm: () => { if (selectedStatus === "open") onAcknowledge(selected.id); setClosedIds((current) => current.includes(selected.id) ? current : [...current, selected.id]); notify(`Evento ${selected.id} cerrado.`); } });
  const reopenEvent = () => { setClosedIds((current) => current.filter((id) => id !== selected.id)); notify(`Evento ${selected.id} reabierto.`, "warning"); };
  const openCritical = initialAlarms.filter((alarm) => alarm.severity === "critical" && !closedIds.includes(alarm.id)).length;
  const openWarnings = initialAlarms.filter((alarm) => alarm.severity === "warning" && !closedIds.includes(alarm.id)).length;
  return (
    <>
      <section className="alarm-summary">
        <div className="summary-tile critical"><span>Críticas abiertas</span><strong>{openCritical}</strong><AlertTriangle size={24} /></div>
        <div className="summary-tile warning"><span>Advertencias abiertas</span><strong>{openWarnings}</strong><BellRing size={24} /></div>
        <div className="summary-tile normal"><span>MTTA promedio</span><strong>8.5<small> min</small></strong><Clock3 size={24} /></div>
      </section>
      <article className={`panel alarm-table-panel ${role === "Solo lectura" ? "role-readonly" : ""}`}>
        <div className="alarm-toolbar">
          <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); alarmPage.setPage(1); }} placeholder="Filtrar mensaje, sensor o zona…" /></label>
          <div className="alarm-filters"><label className="status-filter"><span>Estado</span><select value={workflowStatus} onChange={(event) => { setWorkflowStatus(event.target.value as typeof workflowStatus); alarmPage.setPage(1); }}><option value="all">Todos</option><option value="open">Abiertas</option><option value="acknowledged">Reconocidas</option><option value="closed">Cerradas</option></select><ChevronDown size={13} /></label><div className="segmented">{(["all", "critical", "warning", "info"] as const).map((item) => <button key={item} className={severity === item ? "active" : ""} onClick={() => { setSeverity(item); alarmPage.setPage(1); }}>{item === "all" ? "Todas" : item === "critical" ? "Críticas" : item === "warning" ? "Advertencias" : "Info"}</button>)}</div></div>
        </div>
        <div className="alarm-table-wrap"><div className="alarm-table">
          <div className="alarm-table-head"><span>Severidad</span><span>Evento / activo</span><span>Tiempo activo</span><span>Valor</span><span>Estado</span><span>Acción</span></div>
          {alarmPage.pageItems.map((alarm) => {
            const status = getWorkflowStatus(alarm);
            return <div className={`alarm-table-row ${selected.id === alarm.id ? "selected" : ""}`} key={alarm.id}>
              <span><StatusPill state={alarm.severity}>{alarm.severity === "critical" ? "Crítica" : alarm.severity === "warning" ? "Advertencia" : "Informativa"}</StatusPill></span>
              <span className="event-cell"><strong>{alarm.title}</strong><small>{alarm.detail} · {alarm.id}</small></span>
              <span>{alarm.since}</span><span><strong>{alarm.value}</strong></span>
              <span>{status === "closed" ? <span className="closed-state"><CheckCircle2 size={15} /> Cerrada</span> : status === "acknowledged" ? <span className="ack-state"><CheckCircle2 size={15} /> Reconocida</span> : <span className="unack-state"><Clock3 size={15} /> Sin reconocer</span>}</span>
              <span><button className={selected.id === alarm.id ? "ack-button" : "ghost-button"} onClick={() => setSelectedId(alarm.id)}>Gestionar</button></span>
            </div>;
          })}
          {filtered.length === 0 && <TableEmptyState title="No hay eventos con estos filtros" detail="Ajusta el estado, la severidad o el texto de búsqueda." />}
        </div></div>
        <Pagination page={alarmPage.page} totalPages={alarmPage.totalPages} total={alarmPage.total} pageSize={alarmPage.pageSize} onPageChange={alarmPage.setPage} itemLabel="eventos" />
        {filtered.length > 0 && <section className={`event-detail-panel event-${selected.severity}`}>
          <div className="event-detail-header"><span className="event-detail-icon"><AlertTriangle size={20} /></span><div><span className="eyebrow">Evento seleccionado · {selected.id}</span><h2>{selected.title}</h2><p>{selected.detail}</p></div><span className={`workflow-badge workflow-${selectedStatus}`}>{selectedStatus === "closed" ? "Cerrada" : selectedStatus === "acknowledged" ? "Reconocida" : "Abierta"}</span></div>
          <div className="event-workspace">
            <div className="event-management">
              <dl className="event-facts"><div><dt>Valor detectado</dt><dd>{selected.value}</dd></div><div><dt>Inicio</dt><dd>{selected.since}</dd></div><div><dt>Responsable</dt><dd><select value={assignees[selected.id] ?? "Sin asignar"} onChange={(event) => setAssignees((current) => ({ ...current, [selected.id]: event.target.value }))}><option>Sin asignar</option><option>Emerson Allende</option><option>Paula Rojas</option><option>Felipe Soto</option></select></dd></div></dl>
              {interventionComplete && selectedStatus !== "closed" && <div className="event-remediation-state"><CheckCircle2 size={17} /><div><strong>Intervención completada</strong><p>{linkedOrder.id} finalizó. Verifica que la condición se haya normalizado antes de cerrar el evento.</p></div></div>}
              <div className="event-actions">{selectedStatus === "open" && <button className="primary-button" onClick={() => onAcknowledge(selected.id)}><CheckCircle2 size={15} /> Reconocer evento</button>}<button className={`work-order-action ${linkedOrder ? "linked" : ""}`} onClick={() => onOpenWorkOrder(selected, assignees[selected.id] ?? "Sin asignar")}><ClipboardCheck size={15} /> {linkedOrder ? `Abrir ${linkedOrder.id}` : "Crear orden de trabajo"}</button>{selectedStatus === "closed" ? <button className="secondary-button" onClick={reopenEvent}>Reabrir evento</button> : <button className="secondary-button" onClick={closeEvent}><ShieldCheck size={15} /> Cerrar evento</button>}</div>
            </div>
            <div className="event-timeline"><h3>Línea de tiempo</h3><div><span className="timeline-dot critical" /><p><strong>Evento detectado</strong><small>{selected.since} · Motor de reglas HoitLive Core</small></p></div>{selectedStatus !== "open" && <div><span className="timeline-dot normal" /><p><strong>Evento reconocido</strong><small>Emerson Allende · Portal web</small></p></div>}{linkedOrder && <div><span className={`timeline-dot ${interventionComplete ? "normal" : "info"}`} /><p><strong>{interventionComplete ? "Orden de trabajo completada" : "Orden de trabajo vinculada"}</strong><small>{linkedOrder.id} · {linkedOrder.status}</small></p></div>}{selectedNotes.map((note, index) => <div key={`${selected.id}-${index}`}><span className="timeline-dot info" /><p><strong>Nota operativa</strong><small>{note}</small></p></div>)}{selectedStatus === "closed" && <div><span className="timeline-dot normal" /><p><strong>Evento cerrado</strong><small>Condición revisada por el operador</small></p></div>}</div>
          </div>
          <form className="event-note-form" onSubmit={addNote}><input value={noteInput} onChange={(event) => setNoteInput(event.target.value)} placeholder="Agregar una nota de seguimiento…" /><button type="submit">Agregar nota</button></form>
        </section>}
      </article>
    </>
  );
}

function HistoryView() {
  const sensors = useSensorData();
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

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ tab, from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z`, page: String(page), pageSize: "8" });
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
  }, [tab, from, to, page, query, channel]);

  const changeTab = (next: HistoryTab) => { setTab(next); setPage(1); };
  const total = result?.total ?? 0;

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
        </div>
        <div className="history-search-bar">
          <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={tab === "audit" ? "Buscar acción o recurso…" : "Buscar canal, código o evento…"} /></label>
          {tab === "measurements" && <label><span>Canal</span><select value={channel} onChange={(event) => { setChannel(event.target.value); setPage(1); }}><option value="all">Todos los canales</option>{activeSensors.map((sensor) => <option key={sensor.id} value={sensor.id}>{sensor.id} · {sensor.label}</option>)}</select><ChevronDown size={13} /></label>}
          <label><span>Desde</span><input type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
          <label><span>Hasta</span><input type="date" value={to} min={from} max={today} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
        </div>

        {error && <div className="data-error"><AlertTriangle size={18} /><div><strong>No se pudo cargar el histórico</strong><p>{error}</p></div></div>}
        {loading && <div className="data-loading"><Refresh className="spin" size={18} /> Consultando PostgreSQL…</div>}

        {!loading && !error && tab === "measurements" && <div className="module-table-wrap"><div className="history-table measurement-history"><div className="module-table-head"><span>Canal</span><span>Última lectura</span><span>Promedio</span><span>Mínimo</span><span>Máximo</span><span>Calidad</span></div>{result?.items.map((raw) => {
          const item = raw as { id: string; code: string; name: string; zone?: string; unit: string; lastValue?: string | null; averageValue?: string | null; minimumValue?: string | null; maximumValue?: string | null; qualityPercent?: number | null; lastRecordedAt?: string | null };
          const value = (entry?: string | null) => entry === null || entry === undefined ? "—" : `${Number(entry).toFixed(1)} ${item.unit}`;
          return <div className="module-table-row" key={item.id}><span className="history-channel"><b className="sensor-code sensor-normal">{item.code}</b><span><strong>{item.name}</strong><small>{item.zone || "Sin zona"}</small></span></span><span className="mono-cell">{value(item.lastValue)}<small>{item.lastRecordedAt ? formatDateTime(item.lastRecordedAt) : "Sin muestras"}</small></span><span className="mono-cell">{value(item.averageValue)}</span><span className="mono-cell">{value(item.minimumValue)}</span><span className="mono-cell">{value(item.maximumValue)}</span><span className={item.qualityPercent === null ? "muted-state" : "quality-ok"}>{item.qualityPercent === null ? "Sin datos" : <><CheckCircle2 size={14} /> {item.qualityPercent}%</>}</span></div>;
        })}{result?.items.length === 0 && <TableEmptyState title="No hay mediciones en este rango" detail="Ajusta las fechas o espera la primera ingestión del CAM-5." />}</div></div>}

        {!loading && !error && tab === "alarms" && <div className="module-table-wrap"><div className="history-table alarm-history"><div className="module-table-head"><span>Fecha</span><span>Severidad</span><span>Evento</span><span>Valor</span><span>Estado</span></div>{result?.items.map((raw) => { const item = raw as { id: string; code: string; openedAt: string; severity: Severity; status: string; title: string; detail?: string; triggerValue?: string; channelCode?: string; unit?: string }; return <div className="module-table-row" key={item.id}><span>{formatDateTime(item.openedAt)}</span><span><StatusPill state={item.severity}>{item.severity === "critical" ? "Crítica" : item.severity === "warning" ? "Advertencia" : "Normal"}</StatusPill></span><span className="event-cell"><strong>{item.title}</strong><small>{item.detail || item.code}</small></span><span className="mono-cell">{item.triggerValue ? `${Number(item.triggerValue).toFixed(1)} ${item.unit || ""}` : "—"}</span><span className={item.status === "closed" ? "quality-ok" : "unack-state"}>{item.status === "closed" ? <><CheckCircle2 size={14} /> Cerrada</> : <><Clock3 size={14} /> {item.status === "acknowledged" ? "Reconocida" : "Abierta"}</>}</span></div>; })}{result?.items.length === 0 && <TableEmptyState title="No hay alarmas en este rango" detail="No se encontraron eventos con los filtros indicados." />}</div></div>}

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

function ReportsView() {
  const notify = useFeedback();
  const sensors = useSensorData();
  const activeChannelCount = sensors.filter((sensor) => sensor.enabled).length;
  const templates = [
    { id: "condition", name: "Condición del activo", detail: "Salud general, hallazgos y recomendación técnica", icon: "condition", accent: "blue" },
    { id: "events", name: "Eventos y alarmas", detail: "Tiempos de atención, causas y trazabilidad operativa", icon: "events", accent: "amber" },
    { id: "executive", name: "Resumen ejecutivo", detail: "Indicadores consolidados para jefatura y confiabilidad", icon: "executive", accent: "green" },
  ];
  const [templateId, setTemplateId] = useState("condition");
  const [period, setPeriod] = useState("30 días");
  const [format, setFormat] = useState("PDF");
  const [automatic, setAutomatic] = usePersistentState("cam5.front.report-schedule", true);
  const [generating, setGenerating] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reports, setReports] = usePersistentState("cam5.front.reports", [
    { id: "RPT-260811-012", name: "Condición mensual MCC-01", period: "12 jul – 11 ago", created: "Hoy 11:50", format: "PDF", owner: "Emerson Allende" },
    { id: "RPT-260804-011", name: "Eventos críticos · Semana 32", period: "29 jul – 4 ago", created: "4 ago 18:10", format: "PDF", owner: "Sistema" },
    { id: "RPT-260801-010", name: "Resumen ejecutivo · Julio", period: "1 – 31 jul", created: "1 ago 08:00", format: "XLSX", owner: "Sistema" },
  ]);
  const reportPage = useClientPagination(reports, 8);
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];
  const generateReport = () => {
    setGenerating(true);
    window.setTimeout(() => {
      setReports((current) => [{ id: `RPT-${Date.now().toString().slice(-9)}`, name: `${selectedTemplate.name} · MCC-01`, period, created: "Ahora", format, owner: "Emerson Allende" }, ...current]);
      reportPage.setPage(1);
      setGenerating(false);
      setPreviewOpen(true);
      notify(`${selectedTemplate.name} generado y agregado a la biblioteca.`);
    }, 850);
  };
  const downloadReportData = (name: string) => {
    const rows = ["reporte,activo,canal,valor,unidad,estado", ...sensors.filter((sensor) => sensor.enabled).map((sensor) => [name, "MCC-01", sensor.id, sensor.value, sensor.unit, sensor.state].join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "cam5-datos-reporte.csv"; anchor.click(); URL.revokeObjectURL(url);
    notify("Datos del reporte exportados correctamente.", "info");
  };

  return (
    <>
      <section className="module-summary-grid report-summary-grid">
        <article><span className="module-summary-icon blue"><FileReport size={19} /></span><div><small>Informes disponibles</small><strong>{reports.length}</strong><span>Últimos 90 días</span></div></article>
        <article><span className="module-summary-icon green"><CalendarEvent size={19} /></span><div><small>Programaciones activas</small><strong>{automatic ? 3 : 2}</strong><span>Próximo: lunes 08:00</span></div></article>
        <article><span className="module-summary-icon amber"><Database size={19} /></span><div><small>Cobertura de datos</small><strong>99.98%</strong><span>{activeChannelCount} canales incluidos</span></div></article>
      </section>

      <article className="panel module-panel report-module">
        <div className="module-toolbar"><div><span className="eyebrow">Constructor de informes</span><h2>Crear un reporte operacional</h2></div><span className="autosave-state"><ShieldCheck size={14} /> Trazabilidad habilitada</span></div>
        <div className="report-builder">
          <section className="report-template-section">
            <div className="settings-section-head"><span className="settings-icon"><FileReport size={20} /></span><div><h2>Tipo de informe</h2><p>Selecciona la estructura según la audiencia y el objetivo.</p></div></div>
            <div className="report-template-list">{templates.map((template) => <button key={template.id} className={`report-template-card ${templateId === template.id ? "selected" : ""}`} onClick={() => setTemplateId(template.id)}><span className={`report-template-icon ${template.accent}`}>{template.icon === "events" ? <BellRing size={19} /> : template.icon === "executive" ? <Gauge size={19} /> : <CircuitBoard size={19} />}</span><span><strong>{template.name}</strong><small>{template.detail}</small></span><i>{templateId === template.id && <CheckCircle2 size={16} />}</i></button>)}</div>
          </section>
          <aside className="report-config-card">
            <span className="eyebrow">Parámetros del reporte</span>
            <h3>{selectedTemplate.name}</h3>
            <p>El informe se genera para MCC-01 · Alimentador Norte con los canales activos.</p>
            <div className="report-config-fields"><label><span>Periodo</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option>24 horas</option><option>7 días</option><option>30 días</option><option>90 días</option></select></label><label><span>Formato</span><select value={format} onChange={(event) => setFormat(event.target.value)}><option>PDF</option><option>XLSX</option></select></label></div>
            <button className={`report-schedule ${automatic ? "active" : ""}`} onClick={() => setAutomatic((current) => !current)}><span><CalendarEvent size={17} /><span><strong>Programación automática</strong><small>Primer lunes de cada mes · 08:00</small></span></span><i>{automatic ? "Activa" : "Inactiva"}</i></button>
            <button className="report-preview-button" onClick={() => setPreviewOpen(true)}><MonitorDot size={17} /> Vista previa</button>
            <button className="generate-report-button" onClick={generateReport} disabled={generating}>{generating ? <><Timeline size={17} /> Generando informe…</> : <><FileTypePdf size={17} /> Generar informe</>}</button>
            <small className="report-disclaimer">La vista previa utiliza el mismo contrato que consumirá el servicio definitivo de reportes.</small>
          </aside>
        </div>

        {previewOpen && <section className="report-preview" aria-label="Vista previa del informe"><div className="report-preview-toolbar"><div><span className="eyebrow">Vista previa · {format}</span><h2>{selectedTemplate.name}</h2></div><div><button className="secondary-button" onClick={() => setPreviewOpen(false)}><X size={15} /> Cerrar</button><button className="primary-button" onClick={() => window.print()}><Printer size={15} /> Imprimir / guardar PDF</button></div></div><div className="report-sheet"><header><span className="brand-mark"><Zap size={21} /></span><div><strong>HoitLive Core</strong><small>Informe de condición del punto de medición</small></div><time>Subestación Norte · MCC-01</time></header><section><span className="eyebrow">Resumen del periodo · {period}</span><h1>{selectedTemplate.name}</h1><p>Evaluación consolidada de temperatura, descarga parcial, humedad y disponibilidad de comunicaciones.</p></section><div className="report-kpi-row"><article><small>Condición</small><strong>Atención prioritaria</strong></article><article><small>Canales incluidos</small><strong>{sensors.filter((sensor) => sensor.enabled).length} de {sensors.length}</strong></article><article><small>Integridad</small><strong>99.98%</strong></article></div><section className="report-finding"><AlertTriangle size={20} /><div><strong>Hallazgo principal</strong><h2>Descarga parcial en aceleración · PD1</h2><p>El índice actual supera el umbral crítico configurado. Se recomienda inspección dirigida del compartimiento de cables.</p></div><b>72 idx</b></section><section className="report-channel-summary"><h2>Lecturas incluidas</h2><div>{sensors.filter((sensor) => sensor.enabled).map((sensor) => <span key={sensor.id}><b className={`sensor-code sensor-${sensor.state}`}>{sensor.id}</b><span><strong>{sensor.label}</strong><small>{sensor.zone}</small></span><em>{sensor.value} {sensor.unit}</em></span>)}</div></section><footer><ShieldCheck size={16} /><span>Documento preliminar hasta completar la conexión del historiador CAM5.</span></footer></div></section>}

        <div className="report-library-head"><div><span className="eyebrow">Biblioteca</span><h2>Informes recientes</h2></div><span>{reports.length} documentos</span></div>
        <div className="module-table-wrap"><div className="report-table"><div className="module-table-head"><span>Informe</span><span>Periodo</span><span>Generado</span><span>Formato</span><span>Responsable</span><span>Datos</span></div>{reportPage.pageItems.map((report) => <div className="module-table-row" key={report.id}><span className="report-name-cell"><b><FileReport size={16} /></b><span><strong>{report.name}</strong><small>{report.id}</small></span></span><span>{report.period}</span><span>{report.created}</span><span><i className="report-format">{report.format}</i></span><span>{report.owner}</span><span><button className="ghost-button" onClick={() => downloadReportData(report.name)}><Download size={14} /> Descargar datos</button></span></div>)}</div></div>
        <Pagination page={reportPage.page} totalPages={reportPage.totalPages} total={reportPage.total} pageSize={reportPage.pageSize} onPageChange={reportPage.setPage} itemLabel="informes" />
      </article>
    </>
  );
}

function MaintenanceView({ orders, setOrders, focusOrderId }: { orders: WorkOrder[]; setOrders: React.Dispatch<React.SetStateAction<WorkOrder[]>>; focusOrderId: string | null }) {
  const notify = useFeedback();
  const confirm = useConfirm();
  const role = useActiveRole();
  const [tab, setTab] = useState<"plan" | "orders">(focusOrderId ? "orders" : "plan");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", priority: "Alta", assignee: "Paula Rojas" });
  const plans = [
    { code: "PM-01", name: "Inspección termográfica", frequency: "Mensual", next: "21 ago 2026", progress: 82, state: "Próxima" },
    { code: "PM-02", name: "Diagnóstico UHF de descarga parcial", frequency: "Trimestral", next: "Hoy", progress: 100, state: "Vencida" },
    { code: "PM-03", name: "Limpieza y control ambiental", frequency: "Trimestral", next: "22 ago 2026", progress: 78, state: "Próxima" },
    { code: "PM-04", name: "Verificación de gateway y registros", frequency: "Mensual", next: "31 ago 2026", progress: 36, state: "En plazo" },
  ];
  const openOrders = orders.filter((order) => order.status !== "Completada").length;
  const orderPage = useClientPagination(orders, 8);
  const createOrder = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    const id = `OT-${Date.now().toString().slice(-9)}`;
    setOrders((current) => [{ id, title: form.title.trim(), source: "Creación manual · Portal web", due: "Sin programar", priority: form.priority as WorkPriority, assignee: form.assignee, status: "Pendiente" }, ...current]);
    orderPage.setPage(1);
    notify(`Orden ${id} creada correctamente.`);
    setForm({ title: "", priority: "Alta", assignee: "Paula Rojas" }); setShowCreate(false); setTab("orders");
  };
  const applyOrderStatus = (id: string, status: WorkStatus) => { setOrders((current) => current.map((order) => order.id === id ? { ...order, status } : order)); notify(`${id} actualizada a “${status}”.`, "info"); };
  const updateOrder = (id: string, status: WorkStatus) => status === "Completada" ? confirm({ title: `Completar ${id}`, detail: "La orden quedará finalizada y el evento asociado podrá cerrarse desde el Centro de alertas.", confirmLabel: "Completar orden", onConfirm: () => applyOrderStatus(id, status) }) : applyOrderStatus(id, status);

  return (
    <>
      <section className="module-summary-grid maintenance-summary-grid">
        <article><span className="module-summary-icon green"><ClipboardCheck size={19} /></span><div><small>Cumplimiento preventivo</small><strong>87%</strong><span>Meta mensual: 90%</span></div></article>
        <article><span className="module-summary-icon amber"><CalendarEvent size={19} /></span><div><small>Tareas próximas</small><strong>3</strong><span>1 requiere atención hoy</span></div></article>
        <article><span className="module-summary-icon blue"><Tool size={19} /></span><div><small>Órdenes abiertas</small><strong>{openOrders}</strong><span>1 crítica · 2 altas</span></div></article>
      </section>

      <article className={`panel module-panel maintenance-module ${role === "Solo lectura" ? "role-readonly" : ""}`}>
        <div className="module-toolbar"><div className="module-tabs" role="tablist" aria-label="Secciones de mantenimiento"><button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}><CalendarEvent size={16} /> Plan preventivo</button><button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><ClipboardCheck size={16} /> Órdenes de trabajo</button></div><button className="primary-button" onClick={() => setShowCreate((current) => !current)}><Plus size={16} /> {showCreate ? "Cancelar" : "Nueva orden"}</button></div>

        {showCreate && <form className="work-order-form" onSubmit={createOrder}><label><span>Trabajo requerido</span><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ej.: Revisar conexión del sensor T02" /></label><label><span>Prioridad</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option>Crítica</option><option>Alta</option><option>Normal</option></select></label><label><span>Responsable</span><select value={form.assignee} onChange={(event) => setForm({ ...form, assignee: event.target.value })}><option>Paula Rojas</option><option>Emerson Allende</option><option>Felipe Soto</option></select></label><button type="submit"><ClipboardCheck size={15} /> Crear orden</button></form>}

        {tab === "plan" && <div className="maintenance-plan-content"><div className="settings-section-head"><span className="settings-icon"><CalendarEvent size={20} /></span><div><h2>Plan basado en condición</h2><p>La frecuencia se complementa con los hallazgos de telemetría y eventos activos.</p></div></div><div className="maintenance-plan-grid">{plans.map((plan) => <article className={`maintenance-plan-card plan-${plan.state.toLowerCase().replace(" ", "-")}`} key={plan.code}><div className="maintenance-plan-head"><span>{plan.code}</span><i>{plan.state}</i></div><h3>{plan.name}</h3><dl><div><dt>Frecuencia</dt><dd>{plan.frequency}</dd></div><div><dt>Próxima ejecución</dt><dd>{plan.next}</dd></div></dl><div className="maintenance-progress"><span><i style={{ width: `${plan.progress}%` }} /></span><small>{plan.progress}% del intervalo consumido</small></div><button onClick={() => { setForm({ title: plan.name, priority: plan.state === "Vencida" ? "Alta" : "Normal", assignee: "Paula Rojas" }); setShowCreate(true); }}><Plus size={14} /> Crear orden desde el plan</button></article>)}</div><div className="maintenance-recommendation"><AlertTriangle size={19} /><div><strong>Recomendación prioritaria</strong><p>Adelantar el diagnóstico UHF de PD1 y coordinar una ventana de inspección antes de cualquier intervención invasiva.</p></div><button onClick={() => setTab("orders")}>Revisar órdenes <ChevronRight size={15} /></button></div></div>}

        {tab === "orders" && <div className="maintenance-orders">{focusOrderId && <div className="work-order-focus-banner"><ClipboardCheck size={17} /><div><strong>Orden abierta desde el Centro de alertas</strong><p>{focusOrderId} quedó seleccionada para mantener la trazabilidad del evento.</p></div></div>}<div className="report-library-head"><div><span className="eyebrow">Ejecución</span><h2>Órdenes de trabajo</h2></div><span>{openOrders} abiertas</span></div><div className="module-table-wrap"><div className="work-order-table"><div className="module-table-head"><span>Orden / trabajo</span><span>Origen</span><span>Vencimiento</span><span>Prioridad</span><span>Responsable</span><span>Estado</span></div>{orderPage.pageItems.map((order) => <div className={`module-table-row ${order.id === focusOrderId ? "focused-order" : ""}`} key={order.id}><span className="event-cell"><strong>{order.title}</strong><small>{order.id}</small></span><span>{order.source}</span><span>{order.due}</span><span><i className={`maintenance-priority priority-${order.priority.toLowerCase()}`}>{order.priority}</i></span><span>{order.assignee}</span><span><select className={`work-status status-${order.status.toLowerCase().replace(" ", "-")}`} value={order.status} onChange={(event) => updateOrder(order.id, event.target.value as WorkStatus)}><option>Pendiente</option><option>En curso</option><option>Completada</option></select></span></div>)}</div></div><Pagination page={orderPage.page} totalPages={orderPage.totalPages} total={orderPage.total} pageSize={orderPage.pageSize} onPageChange={orderPage.setPage} itemLabel="órdenes" /></div>}
        <div className="module-footer"><span><ShieldCheck size={14} /> Toda modificación queda asociada al usuario y al activo.</span><small>Estado local sincronizado · preparado para integración con CMMS.</small></div>
      </article>
    </>
  );
}

function DiagnosticsView() {
  const notify = useFeedback();
  const [diagnosticState, setDiagnosticState] = useState<"idle" | "running" | "success">("idle");
  const [lastRun, setLastRun] = useState("No ejecutado en esta sesión");
  const transactions = [
    { time: "11:52:08", request: "FC 03", range: "418–445", result: "28 registros", latency: "42 ms" },
    { time: "11:52:06", request: "FC 03", range: "446–490", result: "45 registros", latency: "38 ms" },
    { time: "11:52:04", request: "FC 03", range: "491–522", result: "32 registros", latency: "31 ms" },
  ];
  const runDiagnostic = () => {
    setDiagnosticState("running");
    setLastRun("Comprobación en curso…");
    window.setTimeout(() => { setDiagnosticState("success"); setLastRun("Ahora · 4 de 4 etapas correctas"); notify("Diagnóstico completado: 4 de 4 etapas correctas."); }, 1200);
  };
  const stateClass = diagnosticState === "running" ? "testing" : diagnosticState === "success" ? "passed" : "ready";

  return (
    <>
      <section className="module-summary-grid diagnostic-summary-grid">
        <article><span className="module-summary-icon green"><Radio size={19} /></span><div><small>Cadena OT</small><strong>Operativa</strong><span>Controlador + gateway + HoitLive Core</span></div></article>
        <article><span className="module-summary-icon blue"><Refresh size={19} /></span><div><small>Ciclo de sondeo</small><strong>2.0 s</strong><span>105 registros documentados</span></div></article>
        <article><span className="module-summary-icon green"><CheckCircle2 size={19} /></span><div><small>Éxito últimas 24 h</small><strong>99.98%</strong><span>0 excepciones Modbus</span></div></article>
      </section>

      <article className="panel module-panel diagnostics-module">
        <div className="diagnostics-toolbar"><div><span className="eyebrow">Puesta en marcha</span><h2>Comprobación de extremo a extremo</h2><p>Verifica cada etapa de la adquisición antes de habilitar datos reales.</p></div><button className={`diagnostic-run-button ${diagnosticState}`} onClick={runDiagnostic} disabled={diagnosticState === "running"}>{diagnosticState === "running" ? <><Refresh size={16} /> Comprobando…</> : diagnosticState === "success" ? <><CheckCircle2 size={16} /> Repetir diagnóstico</> : <><Activity size={16} /> Ejecutar diagnóstico</>}</button></div>

        <div className={`diagnostic-chain ${stateClass}`} aria-live="polite">
          <article><span><CircuitBoard size={21} /></span><small>Etapa 01</small><strong>CAM5-CTRL-01</strong><p>192.168.10.42:502</p><i>{diagnosticState === "running" ? "Probando" : "Disponible"}</i></article>
          <b><ChevronRight size={19} /></b>
          <article><span><Radio size={21} /></span><small>Etapa 02</small><strong>Modbus TCP</strong><p>FC 03 · Unit ID 1</p><i>{diagnosticState === "running" ? "Leyendo" : "105/105 registros"}</i></article>
          <b><ChevronRight size={19} /></b>
          <article><span><Server size={21} /></span><small>Etapa 03</small><strong>CAM5-GW-01</strong><p>LAN 192.168.10.40</p><i>{diagnosticState === "running" ? "Enviando" : "En línea"}</i></article>
          <b><ChevronRight size={19} /></b>
          <article><span><Zap size={21} /></span><small>Etapa 04</small><strong>HoitLive Core</strong><p>Ingesta y reglas</p><i>{diagnosticState === "running" ? "Validando" : "Actualizado hace 2 s"}</i></article>
        </div>

        <div className="diagnostics-result-bar"><span className={stateClass}>{diagnosticState === "running" ? <Refresh size={16} /> : <CheckCircle2 size={16} />}</span><div><strong>{diagnosticState === "running" ? "Comprobando la cadena OT" : diagnosticState === "success" ? "Diagnóstico completado sin hallazgos" : "Cadena preparada para comprobar"}</strong><p>{lastRun}</p></div><small>Tiempo objetivo ≤ 3 s</small></div>

        <div className="diagnostics-grid">
          <section className="diagnostic-health-card"><div className="report-library-head"><div><span className="eyebrow">Salud de comunicación</span><h2>Indicadores actuales</h2></div><StatusPill state="online">En línea</StatusPill></div><dl><div><dt>Latencia controlador</dt><dd>42 ms <small>Normal</small></dd></div><div><dt>Latencia hacia HoitLive Core</dt><dd>86 ms <small>Normal</small></dd></div><div><dt>Última respuesta válida</dt><dd>Hace 2 s <small>FC 03</small></dd></div><div><dt>Reintentos / 24 h</dt><dd>2 <small>0.01%</small></dd></div><div><dt>Excepciones Modbus</dt><dd>0 <small>Sin errores</small></dd></div><div><dt>Calidad de datos</dt><dd>105 / 105 <small>Válidos</small></dd></div></dl></section>
          <section className="diagnostic-transactions"><div className="report-library-head"><div><span className="eyebrow">Tráfico reciente</span><h2>Últimas lecturas Modbus</h2></div><span>FC 03</span></div><div className="module-table-wrap"><div className="diagnostic-transaction-table"><div className="module-table-head"><span>Hora</span><span>Solicitud</span><span>Rango</span><span>Resultado</span><span>Tiempo</span></div>{transactions.map((transaction) => <div className="module-table-row" key={`${transaction.time}-${transaction.range}`}><span className="mono-cell">{transaction.time}</span><span className="mono-cell">{transaction.request}</span><span className="mono-cell">{transaction.range}</span><span className="quality-ok"><CheckCircle2 size={14} /> {transaction.result}</span><span className="mono-cell">{transaction.latency}</span></div>)}</div></div></section>
        </div>
        <div className="configuration-note diagnostics-note"><ShieldCheck size={17} /><p><strong>Adquisición pendiente de conexión.</strong> Esta vista consumirá las respuestas del gateway y las excepciones Modbus del controlador cuando el servicio OT quede habilitado.</p></div>
      </article>
    </>
  );
}

function IntegrationsView() {
  const notify = useFeedback();
  const confirm = useConfirm();
  const role = useActiveRole();
  const sensors = useSensorData();
  const activeChannelCount = sensors.filter((sensor) => sensor.enabled).length;
  const [tab, setTab] = useState<"connections" | "flow" | "api">("connections");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showApiForm, setShowApiForm] = useState(false);
  const [apiForm, setApiForm] = useState({ name: "", scope: "Solo lectura" });
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [connections, setConnections] = usePersistentState("cam5.front.integrations", [
    { id: "controller", name: "Controlador CAM5-CTRL-01", role: "Adquisición de campo", protocol: "Modbus TCP", endpoint: "192.168.10.42:502 · Unit ID 1", enabled: true, locked: true, status: "Operativa", freshness: "Hace 2 s" },
    { id: "gateway", name: "Gateway CAM5-GW-01", role: "Puente OT / plataforma", protocol: "Ethernet · HTTPS/MQTT", endpoint: "LAN 192.168.10.40", enabled: true, locked: true, status: "Operativa", freshness: "Hace 2 s" },
    { id: "historian", name: "Historiador OT", role: "Integración futura", protocol: "OPC UA", endpoint: "No configurado", enabled: false, locked: false, status: "Fuera del MVP", freshness: "Sin sincronizar" },
    { id: "cmms", name: "CMMS de mantenimiento", role: "Integración futura", protocol: "REST / Webhook", endpoint: "No configurado", enabled: false, locked: false, status: "Fuera del MVP", freshness: "Sin sincronizar" },
  ]);
  const [apiKeys, setApiKeys] = usePersistentState("cam5.front.api-keys", [
    { id: 1, name: "Integración de pruebas", token: "cam5_test_••••••••7K2P", scope: "Solo lectura", created: "11 ago 2026", lastUse: "Nunca", active: false },
  ]);
  const activeConnections = connections.filter((connection) => connection.enabled).length;
  const testConnection = (id: string) => {
    setTestingId(id);
    setConnections((current) => current.map((connection) => connection.id === id ? { ...connection, status: "Probando…" } : connection));
    window.setTimeout(() => {
      setConnections((current) => current.map((connection) => connection.id === id ? { ...connection, status: "Operativa", freshness: "Ahora" } : connection));
      setTestingId(null);
      notify("Conexión comprobada correctamente.");
    }, 900);
  };
  const toggleConnection = (id: string) => setConnections((current) => current.map((connection) => connection.id === id && !connection.locked ? { ...connection, enabled: !connection.enabled, status: connection.enabled ? "Desactivada" : "Operativa", freshness: connection.enabled ? "Sin sincronizar" : "Ahora" } : connection));
  const createApiKey = (event: React.FormEvent) => {
    event.preventDefault();
    if (!apiForm.name.trim()) return;
    const rawKey = `cam5_live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    setApiKeys((current) => [{ id: Date.now(), name: apiForm.name.trim(), token: `${rawKey.slice(0, 10)}••••••••${rawKey.slice(-4).toUpperCase()}`, scope: apiForm.scope, created: "Ahora", lastUse: "Nunca", active: true }, ...current]);
    setNewApiKey(rawKey); setApiForm({ name: "", scope: "Solo lectura" }); setShowApiForm(false); notify("Clave creada. Cópiala antes de abandonar esta sección.", "info");
  };
  const revokeApiKey = (id: number) => { const key = apiKeys.find((item) => item.id === id); const apply = () => { setApiKeys((current) => current.map((item) => item.id === id ? { ...item, active: !item.active } : item)); notify(`Clave ${key?.active ? "revocada" : "reactivada"}.`, key?.active ? "warning" : "success"); }; if (key?.active) confirm({ title: `Revocar “${key.name}”`, detail: "Los servicios que utilicen esta credencial dejarán de acceder al sistema inmediatamente.", confirmLabel: "Revocar clave", tone: "danger", onConfirm: apply }); else apply(); };
  const copyApiKey = async () => { if (!newApiKey) return; await navigator.clipboard?.writeText(newApiKey); setCopied(true); notify("Clave copiada al portapapeles.", "info"); window.setTimeout(() => setCopied(false), 1800); };
  const syncLog = [
    { time: "11:52:08", system: "CAM5-CTRL-01", action: "Lectura Modbus completada", detail: `${activeChannelCount} canales · 42 ms`, state: "Correcta" },
    { time: "11:52:07", system: "CAM5-GW-01", action: "Paquete de telemetría enviado", detail: "Subestación Norte", state: "Correcta" },
    { time: "11:52:06", system: "HoitLive Core", action: "Reglas de condición evaluadas", detail: `${activeChannelCount} señales`, state: "Correcta" },
    { time: "11:48:04", system: "Motor de eventos", action: "Evento crítico registrado", detail: "AL-260811-031", state: "Correcta" },
  ];

  return (
    <>
      <section className="module-summary-grid integration-summary-grid">
        <article><span className="module-summary-icon green"><PlugConnected size={19} /></span><div><small>Enlaces OT operativos</small><strong>{activeConnections}</strong><span>Controlador + gateway</span></div></article>
        <article><span className="module-summary-icon blue"><Refresh size={19} /></span><div><small>Sincronización</small><strong>99.98%</strong><span>Últimas 24 horas</span></div></article>
        <article><span className="module-summary-icon amber"><Webhook size={19} /></span><div><small>Integraciones futuras</small><strong>2</strong><span>Historiador + CMMS</span></div></article>
      </section>

      <article className={`panel module-panel integration-module ${role === "Solo lectura" ? "role-readonly" : ""}`}>
        <div className="module-toolbar"><div className="module-tabs" role="tablist" aria-label="Secciones de integraciones"><button className={tab === "connections" ? "active" : ""} onClick={() => setTab("connections")}><PlugConnected size={16} /> Conexiones</button><button className={tab === "flow" ? "active" : ""} onClick={() => setTab("flow")}><Timeline size={16} /> Flujo de datos</button><button className={tab === "api" ? "active" : ""} onClick={() => setTab("api")}><Key size={16} /> Acceso API</button></div><span className="autosave-state"><ShieldCheck size={14} /> Configuración local protegida</span></div>

        {tab === "connections" && <div className="integration-content"><div className="settings-section-head"><span className="settings-icon"><PlugConnected size={20} /></span><div><h2>Arquitectura del sitio activo</h2><p>Enlaces configurados entre controladores, gateways y servicios externos.</p></div></div><div className="integration-card-grid">{connections.map((connection) => <article className={`integration-card ${connection.enabled ? "enabled" : "disabled"}`} key={connection.id}><div className="integration-card-head"><span className="integration-card-icon">{connection.id === "controller" ? <Radio size={21} /> : connection.id === "gateway" ? <Server size={21} /> : connection.id === "historian" ? <Database size={21} /> : <Tool size={21} />}</span>{connection.locked ? <span className="core-link-label"><ShieldCheck size={13} /> Requerida</span> : <button className={`switch-control ${connection.enabled ? "on" : ""}`} onClick={() => toggleConnection(connection.id)} aria-label={`${connection.enabled ? "Desactivar" : "Activar"} ${connection.name}`}><i /></button>}</div><span className="eyebrow">{connection.role}</span><h3>{connection.name}</h3><dl><div><dt>Protocolo</dt><dd>{connection.protocol}</dd></div><div><dt>Destino</dt><dd title={connection.endpoint}>{connection.endpoint}</dd></div><div><dt>Última actividad</dt><dd>{connection.freshness}</dd></div></dl><div className="integration-card-footer"><span className={connection.enabled && connection.status === "Operativa" ? "quality-ok" : connection.status === "Probando…" ? "integration-testing" : "muted-state"}>{connection.status === "Operativa" && <CheckCircle2 size={14} />}{connection.status}</span><button onClick={() => testConnection(connection.id)} disabled={!connection.enabled || testingId === connection.id}>{testingId === connection.id ? "Probando…" : "Probar conexión"}</button></div></article>)}</div><div className="configuration-note"><ShieldCheck size={17} /><p><strong>Cadena OT configurada.</strong> Cada sitio puede incorporar uno o más gateways y asociarlos a sus puntos de medición. Historiador y CMMS quedan disponibles para integración.</p></div></div>}

        {tab === "flow" && <div className="integration-content flow-content"><div className="settings-section-head"><span className="settings-icon"><Timeline size={20} /></span><div><h2>Ruta de datos del sitio activo</h2><p>Cadena de adquisición y procesamiento desde cada sensor hasta el portal.</p></div></div><div className="data-flow"><article><span><Activity size={21} /></span><small>Origen</small><strong>24 entradas CAM5</strong><p>{activeChannelCount} señales activas · temperatura, UHF y ambiente</p></article><i><ChevronRight size={19} /></i><article><span><CircuitBoard size={21} /></span><small>Controlador</small><strong>CAM5-CTRL-01</strong><p>Modbus TCP · Unit ID 1</p></article><i><ChevronRight size={19} /></i><article><span><Server size={21} /></span><small>Gateway</small><strong>CAM5-GW-01</strong><p>Ethernet · HTTPS/MQTT</p></article><i><ChevronRight size={19} /></i><article className="flow-core"><span><Zap size={21} /></span><small>Procesamiento</small><strong>HoitLive Core</strong><p>Reglas, eventos e histórico</p></article><i><ChevronRight size={19} /></i><article><span><MonitorDot size={21} /></span><small>Aplicación</small><strong>HoitLive Core</strong><p>Dashboard, alertas y reportes</p></article></div><div className="flow-grid"><section><div className="report-library-head"><div><span className="eyebrow">Mapeo Modbus</span><h2>Señales publicadas</h2></div><span>{activeChannelCount} activas</span></div><div className="module-table-wrap"><div className="integration-mapping-table"><div className="module-table-head"><span>Canal</span><span>Registro</span><span>Variable publicada</span><span>Publicación</span><span>Calidad</span></div>{sensors.filter((sensor) => sensor.enabled).map((sensor) => <div className="module-table-row" key={sensor.id}><span><b className={`sensor-code sensor-${sensor.state}`}>{sensor.id}</b></span><span className="mono-cell">{sensor.nativeRegister} · {sensor.register.replace("HR ", "")}</span><span className="mono-cell">cam5.mcc01.{sensor.id.toLowerCase()}</span><span>{sensor.id === "PD1" ? "HoitLive Core + eventos" : "HoitLive Core"}</span><span className="quality-ok"><CheckCircle2 size={14} /> {sensor.quality}</span></div>)}</div></div></section><aside className="sync-activity"><div className="report-library-head"><div><span className="eyebrow">Actividad</span><h2>Últimas sincronizaciones</h2></div></div><div>{syncLog.map((entry) => <article key={`${entry.time}-${entry.system}`}><span className={entry.state === "Correcta" ? "normal" : "warning"}><Refresh size={15} /></span><div><strong>{entry.action}</strong><small>{entry.system} · {entry.detail}</small></div><time>{entry.time}</time></article>)}</div></aside></div></div>}

        {tab === "api" && <div className="integration-content api-content"><div className="api-section-head"><div className="settings-section-head"><span className="settings-icon"><Key size={20} /></span><div><h2>Credenciales de integración</h2><p>Claves para servicios que consumen o publican información en HoitLive Core.</p></div></div><button className="primary-button" onClick={() => setShowApiForm((current) => !current)}><Plus size={16} /> {showApiForm ? "Cancelar" : "Nueva clave"}</button></div>{showApiForm && <form className="api-key-form" onSubmit={createApiKey}><label><span>Nombre de la integración</span><input required value={apiForm.name} onChange={(event) => setApiForm({ ...apiForm, name: event.target.value })} placeholder="Ej.: Panel de confiabilidad" /></label><label><span>Alcance</span><select value={apiForm.scope} onChange={(event) => setApiForm({ ...apiForm, scope: event.target.value })}><option>Solo lectura</option><option>Telemetría · lectura</option><option>Eventos · escritura</option></select></label><button type="submit"><Key size={15} /> Crear clave</button></form>}{newApiKey && <div className="api-key-reveal"><ShieldCheck size={19} /><div><strong>Copia la nueva clave ahora</strong><code>{newApiKey}</code><small>Por seguridad, no volverá a mostrarse completa.</small></div><button onClick={copyApiKey}>{copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}{copied ? "Copiada" : "Copiar"}</button></div>}<div className="api-layout"><section className="api-key-list"><div className="report-library-head"><div><span className="eyebrow">Credenciales</span><h2>Claves registradas</h2></div><span>{apiKeys.filter((key) => key.active).length} activas</span></div>{apiKeys.map((key) => <article key={key.id}><span className={`api-key-icon ${key.active ? "active" : ""}`}><Key size={18} /></span><div><strong>{key.name}</strong><code>{key.token}</code><small>{key.scope} · Creada {key.created} · Uso: {key.lastUse}</small></div><button className="ghost-button" onClick={() => revokeApiKey(key.id)}>{key.active ? "Revocar" : "Reactivar"}</button></article>)}</section><aside className="api-endpoints"><span className="eyebrow">Endpoints disponibles</span><h3>API HoitLive Core v1</h3><p>Rutas propuestas para la futura integración con servicios autorizados.</p><dl><div><dt>GET</dt><dd>/api/v1/assets/mcc-01/readings</dd></div><div><dt>GET</dt><dd>/api/v1/assets/mcc-01/events</dd></div><div><dt>POST</dt><dd>/api/v1/work-orders</dd></div><div><dt>POST</dt><dd>/api/v1/webhooks/events</dd></div></dl><div className="configuration-note"><Webhook size={16} /><p>Los endpoints son parte del diseño del frontend; todavía no exponen información real.</p></div></aside></div></div>}
      </article>
    </>
  );
}

function SettingsView() {
  const notify = useFeedback();
  const confirm = useConfirm();
  const sensors = useSensorData();
  const role = useActiveRole();
  const [tab, setTab] = useState<SettingsTab>("asset");
  const [saved, setSaved] = useState(false);
  const [connection, setConnection] = useState<"idle" | "testing" | "success">("idle");
  const [assetConfig, setAssetConfig] = usePersistentState("cam5.front.asset-config", defaultAssetConfig);
  const [gatewayConfig, setGatewayConfig] = usePersistentState("cam5.front.gateway-config", { gateway: "CAM5-GW-01", controller: "CAM5-CTRL-01", protocol: "Modbus TCP", controllerIp: "192.168.10.42", gatewayIp: "192.168.10.40", port: "502", unit: "1", polling: "2", uplink: "Ethernet / HTTPS" });
  const [channels, setChannels] = usePersistentState("cam5.front.channel-config.v2", defaultChannelConfiguration());
  const [registerMap, setRegisterMap] = usePersistentState("cam5.front.register-map.v2", cam5RegisterCatalog.map((register) => {
    const liveChannel = sensors.find((sensor) => sensor.nativeRegister === register.register);
    return { id: String(register.register), label: register.description, reference: register.reference, nativeRegister: register.register, functionCode: "03", dataType: register.dataType as ModbusDataType, scale: register.scale, byteOrder: "AB" as ModbusByteOrder, unit: register.unit, value: liveChannel?.value ?? "—", errorCode: register.errorCode, group: register.group };
  }));
  const [registerGroup, setRegisterGroup] = useState("Todos");
  const [mapValidation, setMapValidation] = useState<"idle" | "validating" | "success" | "error">("idle");
  const registerGroups = ["Todos", ...new Set(registerMap.map((row) => row.group))];
  const visibleRegisterMap = registerMap.filter((row) => registerGroup === "Todos" || row.group === registerGroup);
  const channelPage = useClientPagination(channels, 10);
  const registerPage = useClientPagination(visibleRegisterMap, 12);
  const duplicateReferences = new Set(registerMap.filter((row, index, rows) => rows.findIndex((candidate) => candidate.reference === row.reference) !== index).map((row) => row.reference));
  const invalidReferences = registerMap.filter((row) => {
    if (!/^400\d{3}$/.test(row.reference)) return true;
    const native = Number(row.reference.slice(3));
    return native < 418 || native > 522 || native !== row.nativeRegister;
  }).map((row) => row.id);
  const mappingIssues = duplicateReferences.size + invalidReferences.length;
  const thresholdIssues = channels.filter((channel) => !Number.isFinite(Number(channel.warning)) || !Number.isFinite(Number(channel.critical)) || Number(channel.warning) >= Number(channel.critical));
  const validIp = (value: string) => { const parts = value.split(".").map(Number); return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255); };
  const gatewayIssues = [!validIp(gatewayConfig.gatewayIp), !validIp(gatewayConfig.controllerIp), Number(gatewayConfig.port) < 1 || Number(gatewayConfig.port) > 65535, Number(gatewayConfig.unit) < 0 || Number(gatewayConfig.unit) > 247, Number(gatewayConfig.polling) < 1].filter(Boolean).length;
  const configurationIssues = mappingIssues + thresholdIssues.length + gatewayIssues;
  const saveChanges = () => { if (configurationIssues) { setTab(thresholdIssues.length ? "channels" : mappingIssues ? "registers" : "gateway"); notify(`Hay ${configurationIssues} campo${configurationIssues === 1 ? "" : "s"} por corregir antes de guardar.`, "warning"); return; } setSaved(true); notify("Configuración validada. La publicación al controlador se habilitará mediante el servicio del gateway."); window.setTimeout(() => setSaved(false), 2400); };
  const testConnection = () => { setConnection("testing"); window.setTimeout(() => { setConnection("success"); notify("Prueba Modbus completada correctamente."); }, 900); };
  const updateChannel = (id: string, field: "enabled" | "warning" | "critical", value: boolean | string) => { const apply = () => setChannels((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item)); if (field === "enabled" && value === false) confirm({ title: `Desactivar canal ${id}`, detail: "El canal dejará de aparecer en tendencias, reportes e indicadores operativos.", confirmLabel: "Desactivar canal", tone: "danger", onConfirm: apply }); else apply(); };
  const updateRegister = (id: string, field: "reference" | "dataType" | "scale" | "byteOrder", value: string) => { setMapValidation("idle"); setRegisterMap((current) => current.map((row) => row.id === id ? { ...row, [field]: value } : row)); };
  const validateRegisterMap = () => { setMapValidation("validating"); window.setTimeout(() => { setMapValidation(mappingIssues ? "error" : "success"); notify(mappingIssues ? `${mappingIssues} conflicto${mappingIssues === 1 ? "" : "s"} en el mapa Modbus.` : "Mapa Modbus validado sin conflictos.", mappingIssues ? "warning" : "success"); }, 700); };

  return (
    <article className={`panel module-panel settings-module ${role === "Solo lectura" ? "role-readonly" : ""}`}>
      <div className="module-toolbar">
        <div className="module-tabs" role="tablist" aria-label="Secciones de configuración">
          <button className={tab === "asset" ? "active" : ""} onClick={() => setTab("asset")}><Building2 size={16} /> Activo</button>
          <button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}><Activity size={16} /> Canales y umbrales</button>
          <button className={tab === "registers" ? "active" : ""} onClick={() => setTab("registers")}><Database size={16} /> Mapa Modbus</button>
          <button className={tab === "gateway" ? "active" : ""} onClick={() => setTab("gateway")}><PlugConnected size={16} /> Gateway + Modbus</button>
        </div>
        <button className={`save-config-button ${saved ? "saved" : ""}`} onClick={saveChanges}>{saved ? <CheckCircle2 size={16} /> : <Save size={16} />}{saved ? "Cambios guardados" : "Guardar cambios"}</button>
      </div>
      {configurationIssues > 0 && <div className="validation-summary" role="alert"><AlertTriangle size={17} /><div><strong>Configuración pendiente de validar</strong><p>{thresholdIssues.length} umbrales · {mappingIssues} conflictos Modbus · {gatewayIssues} parámetros de comunicación.</p></div></div>}

      {tab === "asset" && <div className="settings-content"><div className="settings-section-head"><span className="settings-icon"><Building2 size={20} /></span><div><h2>Identificación del punto de medición</h2><p>Datos utilizados en navegación, reportes y trazabilidad.</p></div></div><div className="form-grid"><label><span>Código del punto</span><input value={assetConfig.name} onChange={(event) => setAssetConfig({ ...assetConfig, name: event.target.value })} /></label><label><span>Descripción</span><input value={assetConfig.description} onChange={(event) => setAssetConfig({ ...assetConfig, description: event.target.value })} /></label><label><span>Tensión nominal</span><div className="input-unit"><input value={assetConfig.voltage} onChange={(event) => setAssetConfig({ ...assetConfig, voltage: event.target.value })} /><b>kV</b></div></label><label><span>Sitio activo</span><input value={assetConfig.location} readOnly /></label><label className="form-span-2"><span>Zona horaria</span><select value={assetConfig.timezone} onChange={(event) => setAssetConfig({ ...assetConfig, timezone: event.target.value })}><option>America/Santiago</option><option>UTC</option></select></label></div><div className="configuration-note"><ShieldCheck size={17} /><p><strong>Configuración contextual.</strong> El punto de medición se administra dentro del sitio seleccionado y puede asociarse a uno de sus gateways.</p></div></div>}

      {tab === "channels" && <div className="settings-content channels-settings"><div className="settings-section-head"><span className="settings-icon"><Activity size={20} /></span><div><h2>Canales y umbrales</h2><p>Habilita señales y define niveles operativos de alarma.</p></div></div><div className="channel-config-table"><div className="channel-config-head"><span>Canal</span><span>Registro</span><span>Advertencia</span><span>Crítico</span><span>Estado</span></div>{channelPage.pageItems.map((channel) => <div className="channel-config-row" key={channel.id}><span className="history-channel"><b className={`sensor-code sensor-${channel.state}`}>{channel.id}</b><span><strong>{channel.label}</strong><small>{channel.type}</small></span></span><span className="mono-cell">{channel.register}</span><label className="compact-input"><input value={channel.warning} onChange={(event) => updateChannel(channel.id, "warning", event.target.value)} /><b>{channel.unit}</b></label><label className="compact-input"><input value={channel.critical} onChange={(event) => updateChannel(channel.id, "critical", event.target.value)} /><b>{channel.unit}</b></label><button className={`channel-toggle ${channel.enabled ? "on" : ""}`} onClick={() => updateChannel(channel.id, "enabled", !channel.enabled)}><i />{channel.enabled ? "Activo" : "Inactivo"}</button></div>)}</div><Pagination page={channelPage.page} totalPages={channelPage.totalPages} total={channelPage.total} pageSize={channelPage.pageSize} onPageChange={channelPage.setPage} itemLabel="canales" /></div>}

      {tab === "registers" && <div className="settings-content register-settings">
        <div className="register-settings-head">
          <div className="settings-section-head"><span className="settings-icon"><Database size={20} /></span><div><h2>Mapa de registros Modbus</h2><p>Define cómo el controlador CAM5 expone cada señal al gateway asignado.</p></div></div>
          <div className="register-header-actions"><label><span>Grupo</span><select value={registerGroup} onChange={(event) => { setRegisterGroup(event.target.value); registerPage.setPage(1); }}>{registerGroups.map((group) => <option key={group}>{group}</option>)}</select><ChevronDown size={12} /></label><button className={`register-validate-button ${mapValidation}`} onClick={validateRegisterMap} disabled={mapValidation === "validating"}>{mapValidation === "validating" ? <><Refresh size={15} /> Validando…</> : mapValidation === "success" ? <><CheckCircle2 size={15} /> Mapa válido</> : mapValidation === "error" ? <><AlertTriangle size={15} /> Revisar mapa</> : <><ShieldCheck size={15} /> Validar mapa</>}</button></div>
        </div>
        <div className="register-map-summary">
          <article><small>Registros documentados</small><strong>{registerMap.length}</strong><span>Bloque nativo completo 418–522</span></article>
          <article><small>Función de lectura</small><strong>FC 03</strong><span>Holding Registers</span></article>
          <article className={mappingIssues ? "has-issues" : "is-valid"}><small>Conflictos detectados</small><strong>{mappingIssues}</strong><span>{mappingIssues ? "Corregir antes de conectar" : "Referencias únicas y válidas"}</span></article>
        </div>
        <div className="modbus-address-note"><CircuitBoard size={17} /><div><strong>Registro nativo y referencia humana</strong><p>El manual identifica el registro 418 como referencia 400418 y dirección 0x01A2 en la trama. El gateway debe conservar esta convención o declarar explícitamente cualquier remapeo.</p></div></div>
        <div className="register-map-scroll"><div className="register-map-table">
          <div className="register-map-row register-map-header"><span>Variable</span><span>Referencia</span><span>Registro nativo</span><span>Función</span><span>Tipo de dato</span><span>Escala</span><span>Orden</span><span>Lectura / error</span></div>
          {registerPage.pageItems.map((row) => { const invalid = invalidReferences.includes(row.id) || duplicateReferences.has(row.reference); const liveChannel = sensors.find((sensor) => sensor.nativeRegister === row.nativeRegister); return <div className={`register-map-row ${invalid ? "row-invalid" : ""}`} key={row.id}><span className="register-channel"><b className={`sensor-code sensor-${liveChannel?.state ?? "normal"}`}>R{row.id}</b><span><strong>{row.label}</strong><small>{row.group} · {row.unit}</small></span></span><label><input value={row.reference} onChange={(event) => updateRegister(row.id, "reference", event.target.value)} aria-label={`Referencia Modbus ${row.id}`} />{invalid && <small>Referencia inválida, duplicada o fuera del mapa</small>}</label><span className="register-offset">{row.nativeRegister}</span><span className="register-function"><b>03</b><small>Holding</small></span><label><select value={row.dataType} onChange={(event) => updateRegister(row.id, "dataType", event.target.value)} aria-label={`Tipo de dato ${row.id}`}><option>Int16</option><option>UInt16</option></select></label><label className="register-scale"><input value={row.scale} onChange={(event) => updateRegister(row.id, "scale", event.target.value)} aria-label={`Escala ${row.id}`} /></label><label><select value={row.byteOrder} onChange={(event) => updateRegister(row.id, "byteOrder", event.target.value)} aria-label={`Orden de bytes ${row.id}`}><option>AB</option><option>BA</option></select></label><span className="register-live-value"><i className={liveChannel?.enabled ? "" : "waiting"} /><strong>{liveChannel?.enabled ? `${row.value} ${row.unit}` : "Pendiente"}</strong><small>Error {row.errorCode}</small></span></div>; })}
        </div></div><Pagination page={registerPage.page} totalPages={registerPage.totalPages} total={registerPage.total} pageSize={registerPage.pageSize} onPageChange={registerPage.setPage} itemLabel="registros" />
        <div className="configuration-note"><ShieldCheck size={17} /><p><strong>Mapa base incorporado desde el manual CAM-5/IRM-48.</strong> Al conectar el equipo solo será necesario confirmar modelo, versión de datos y convención efectiva del driver del gateway.</p></div>
      </div>}

      {tab === "gateway" && <div className="settings-content"><div className="settings-section-head"><span className="settings-icon"><PlugConnected size={20} /></span><div><h2>Gateway y controlador Modbus</h2><p>Cadena de adquisición del punto de medición seleccionado.</p></div></div><div className="single-stack-note"><Radio size={18} /><div><strong>CAM5-CTRL-01 → CAM5-GW-01 → HoitLive Core</strong><p>El controlador concentra los registros Modbus TCP. El gateway transporta la telemetría hacia la plataforma.</p></div></div><div className="gateway-layout"><div className="form-grid"><label><span>Gateway asignado</span><input value={gatewayConfig.gateway} readOnly /></label><label><span>IP del gateway</span><input value={gatewayConfig.gatewayIp} onChange={(event) => setGatewayConfig({ ...gatewayConfig, gatewayIp: event.target.value })} /></label><label><span>Enlace hacia HoitLive Core</span><input value={gatewayConfig.uplink} readOnly /></label><label><span>Controlador Modbus</span><input value={gatewayConfig.controller} readOnly /></label><label><span>Protocolo de campo</span><select value={gatewayConfig.protocol} onChange={(event) => setGatewayConfig({ ...gatewayConfig, protocol: event.target.value })}><option>Modbus TCP</option></select></label><label><span>IP del controlador</span><input value={gatewayConfig.controllerIp} onChange={(event) => setGatewayConfig({ ...gatewayConfig, controllerIp: event.target.value })} /></label><label><span>Puerto Modbus</span><input value={gatewayConfig.port} onChange={(event) => setGatewayConfig({ ...gatewayConfig, port: event.target.value })} /></label><label><span>Unit ID</span><input value={gatewayConfig.unit} onChange={(event) => setGatewayConfig({ ...gatewayConfig, unit: event.target.value })} /></label><label><span>Intervalo de lectura</span><div className="input-unit"><input value={gatewayConfig.polling} onChange={(event) => setGatewayConfig({ ...gatewayConfig, polling: event.target.value })} /><b>s</b></div></label></div><aside className="connection-test-card"><span className={`connection-test-icon ${connection}`}><Radio size={24} /></span><h3>Controlador CAM5-CTRL-01</h3><p>Valida acceso, puerto y respuesta Modbus desde el gateway asignado.</p><dl><div><dt>Destino</dt><dd>{gatewayConfig.controllerIp}:{gatewayConfig.port}</dd></div><div><dt>Gateway</dt><dd>{gatewayConfig.gateway}</dd></div><div><dt>Timeout</dt><dd>3 segundos</dd></div></dl><button onClick={testConnection} disabled={connection === "testing"}>{connection === "testing" ? "Probando…" : connection === "success" ? <><CheckCircle2 size={15} /> Controlador disponible</> : <><PlugConnected size={15} /> Probar Modbus</>}</button></aside></div></div>}
    </article>
  );
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

function NotificationsView() {
  const notify = useFeedback();
  const role = useActiveRole();
  const [tab, setTab] = useState<"channels" | "rules" | "delivery">("channels");
  const [testedChannel, setTestedChannel] = useState<string | null>(null);
  const [channels, setChannels] = usePersistentState("cam5.front.notification-channels", [
    { id: "email", name: "Correo OT", detail: "Alertas a responsables y turnos", destination: "operaciones@cam5.local", enabled: true, status: "Verificado" },
    { id: "teams", name: "Microsoft Teams", detail: "Canal del equipo de mantenimiento", destination: "Equipo · Mantenimiento eléctrico", enabled: true, status: "Conectado" },
    { id: "webhook", name: "Webhook CMMS", detail: "Creación de avisos externos", destination: "https://cmms.local/cam5/events", enabled: false, status: "Sin configurar" },
  ]);
  const [rules, setRules] = usePersistentState("cam5.front.notification-rules", [
    { id: 1, event: "Evento crítico", scope: "Todos los activos", delay: "Inmediato", recipients: "Administrador + Ingeniero", enabled: true },
    { id: 2, event: "Advertencia persistente", scope: "Más de 5 minutos", delay: "5 minutos", recipients: "Ingeniero + Operador", enabled: true },
    { id: 3, event: "Pérdida de comunicación", scope: "Gateway sin datos", delay: "10 minutos", recipients: "Administrador", enabled: true },
    { id: 4, event: "Recuperación del activo", scope: "Retorno a normal", delay: "Inmediato", recipients: "Operador", enabled: false },
  ]);
  const deliveries = [
    { time: "Hoy 11:48:04", event: "AL-260811-031 · Descarga parcial", channel: "Correo OT", recipient: "2 destinatarios", state: "Entregada" },
    { time: "Hoy 11:48:05", event: "AL-260811-031 · Descarga parcial", channel: "Microsoft Teams", recipient: "Mantenimiento eléctrico", state: "Entregada" },
    { time: "Hoy 09:22:18", event: "AL-260811-028 · Diferencial térmico", channel: "Correo OT", recipient: "3 destinatarios", state: "Entregada" },
    { time: "Ayer 18:43:11", event: "Recuperación de gateway", channel: "Correo OT", recipient: "1 destinatario", state: "Entregada" },
  ];
  const testChannel = (id: string) => { const channel = channels.find((item) => item.id === id); setTestedChannel(id); notify(`Prueba enviada por ${channel?.name ?? "el canal"}.`, "info"); window.setTimeout(() => setTestedChannel(null), 2200); };
  const toggleChannel = (id: string) => setChannels((current) => current.map((channel) => channel.id === id ? { ...channel, enabled: !channel.enabled } : channel));
  const updateRule = (id: number, field: "delay" | "recipients" | "enabled", value: string | boolean) => setRules((current) => current.map((rule) => rule.id === id ? { ...rule, [field]: value } : rule));

  return (
    <>
      <section className="module-summary-grid notification-summary"><article><span className="module-summary-icon green"><Mail size={19} /></span><div><small>Canales activos</small><strong>{channels.filter((channel) => channel.enabled).length}</strong><span>de {channels.length} configurados</span></div></article><article><span className="module-summary-icon blue"><BellRing size={19} /></span><div><small>Reglas habilitadas</small><strong>{rules.filter((rule) => rule.enabled).length}</strong><span>Escalamiento automático</span></div></article><article><span className="module-summary-icon amber"><CheckCircle2 size={19} /></span><div><small>Entrega últimas 24 h</small><strong>100%</strong><span>4 de 4 entregadas</span></div></article></section>
      <article className={`panel module-panel notification-module ${role === "Solo lectura" ? "role-readonly" : ""}`}>
        <div className="module-toolbar"><div className="module-tabs" role="tablist" aria-label="Secciones de notificaciones"><button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}><Mail size={16} /> Canales</button><button className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}><BellRing size={16} /> Escalamiento</button><button className={tab === "delivery" ? "active" : ""} onClick={() => setTab("delivery")}><Timeline size={16} /> Entregas</button></div><span className="autosave-state"><CheckCircle2 size={14} /> Cambios locales guardados</span></div>

        {tab === "channels" && <div className="notification-content"><div className="settings-section-head"><span className="settings-icon"><Mail size={20} /></span><div><h2>Canales de notificación</h2><p>Define cómo se informa un evento a los equipos responsables.</p></div></div><div className="notification-channel-grid">{channels.map((channel) => <article className={`notification-channel-card ${channel.enabled ? "enabled" : ""}`} key={channel.id}><div className="notification-channel-head"><span className="notification-channel-icon">{channel.id === "email" ? <Mail size={20} /> : channel.id === "teams" ? <Users size={20} /> : <PlugConnected size={20} />}</span><button className={`switch-control ${channel.enabled ? "on" : ""}`} onClick={() => toggleChannel(channel.id)} aria-label={`${channel.enabled ? "Desactivar" : "Activar"} ${channel.name}`}><i /></button></div><h3>{channel.name}</h3><p>{channel.detail}</p><dl><div><dt>Destino</dt><dd>{channel.destination}</dd></div><div><dt>Estado</dt><dd className={channel.enabled ? "quality-ok" : "muted-state"}>{channel.status}</dd></div></dl><button className="test-notification-button" onClick={() => testChannel(channel.id)} disabled={!channel.enabled}>{testedChannel === channel.id ? <><CheckCircle2 size={15} /> Prueba enviada</> : <><BellRing size={15} /> Enviar prueba</>}</button></article>)}</div></div>}

        {tab === "rules" && <div className="notification-content notification-rules"><div className="settings-section-head"><span className="settings-icon"><BellRing size={20} /></span><div><h2>Reglas de escalamiento</h2><p>Relaciona severidad, espera y destinatarios responsables.</p></div></div><div className="notification-rule-table"><div className="notification-rule-head"><span>Condición</span><span>Alcance</span><span>Espera</span><span>Destinatarios</span><span>Estado</span></div>{rules.map((rule) => <div className="notification-rule-row" key={rule.id}><span><strong>{rule.event}</strong></span><span>{rule.scope}</span><span><select value={rule.delay} onChange={(event) => updateRule(rule.id, "delay", event.target.value)}><option>Inmediato</option><option>5 minutos</option><option>10 minutos</option><option>30 minutos</option></select></span><span><select value={rule.recipients} onChange={(event) => updateRule(rule.id, "recipients", event.target.value)}><option>Administrador</option><option>Administrador + Ingeniero</option><option>Ingeniero + Operador</option><option>Operador</option></select></span><span><button className={`channel-toggle ${rule.enabled ? "on" : ""}`} onClick={() => updateRule(rule.id, "enabled", !rule.enabled)}><i />{rule.enabled ? "Activa" : "Inactiva"}</button></span></div>)}</div><div className="configuration-note"><ShieldCheck size={17} /><p>Las reglas críticas se envían de inmediato. Las esperas solo se aplican cuando la condición permanece activa durante el periodo configurado.</p></div></div>}

        {tab === "delivery" && <div className="notification-content delivery-content"><div className="settings-section-head"><span className="settings-icon"><Timeline size={20} /></span><div><h2>Registro de entregas</h2><p>Trazabilidad de mensajes emitidos por el motor de notificaciones.</p></div></div><div className="module-table-wrap"><div className="delivery-table"><div className="module-table-head"><span>Fecha</span><span>Evento</span><span>Canal</span><span>Destino</span><span>Resultado</span></div>{deliveries.map((delivery) => <div className="module-table-row" key={`${delivery.time}-${delivery.channel}`}><span className="mono-cell">{delivery.time}</span><span>{delivery.event}</span><span>{delivery.channel}</span><span>{delivery.recipient}</span><span className="quality-ok"><CheckCircle2 size={14} /> {delivery.state}</span></div>)}</div></div></div>}
      </article>
    </>
  );
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
  const [trendSensorId, setTrendSensorId] = useState("T01");
  const [acknowledged, setAcknowledged] = usePersistentState<string[]>("cam5.front.acknowledged", []);
  const [workOrders, setWorkOrders] = usePersistentState<WorkOrder[]>("cam5.front.work-orders", initialWorkOrders);
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null);
  const [closedAlarmIds, setClosedAlarmIds] = usePersistentState<string[]>("cam5.front.closed-alarms", []);
  const [alarmAssignees, setAlarmAssignees] = usePersistentState<Record<string, string>>("cam5.front.alarm-assignees", { "AL-260811-031": "Emerson Allende", "AL-260811-028": "Paula Rojas", "AL-260811-019": "Felipe Soto" });
  const [alarmNotes, setAlarmNotes] = usePersistentState<Record<string, string[]>>("cam5.front.alarm-notes", {});
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
    if (next !== "maintenance") setFocusOrderId(null);
    setMenuOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    url.searchParams.delete("channel");
    url.searchParams.delete("record");
    Object.entries(parameters ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
    window.history.pushState({}, "", url);
  };
  const openChannelTrend = (id: string) => { setTrendSensorId(id); navigate("trends", { channel: id }); };
  const selectTrendChannel = (id: string) => {
    setTrendSensorId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "trends");
    url.searchParams.set("channel", id);
    window.history.replaceState({}, "", url);
  };
  const acknowledge = (id: string) => {
    setAcknowledged((current) => current.includes(id) ? current : [...current, id]);
    notify(`Evento ${id} reconocido.`);
  };
  const openWorkOrderFromAlarm = (alarm: (typeof initialAlarms)[number], assignee: string) => {
    const existing = workOrders.find((order) => order.sourceAlarmId === alarm.id);
    if (existing) { setFocusOrderId(existing.id); navigate("maintenance"); notify(`Orden ${existing.id} abierta.`, "info"); return; }
    const id = `OT-${Date.now().toString().slice(-9)}`;
    const signal = alarm.detail.split(" · ")[0];
    const order: WorkOrder = { id, title: `Atender ${alarm.title.toLowerCase()}`, source: `${signal} · Evento ${alarm.id}`, sourceAlarmId: alarm.id, due: alarm.severity === "critical" ? "Hoy · Prioritario" : alarm.severity === "warning" ? "Próximas 24 h" : "Sin programar", priority: alarm.severity === "critical" ? "Crítica" : alarm.severity === "warning" ? "Alta" : "Normal", assignee: assignee === "Sin asignar" ? "Paula Rojas" : assignee, status: "Pendiente" };
    setWorkOrders((current) => [order, ...current]); setFocusOrderId(id); navigate("maintenance"); notify(`Orden ${id} creada y vinculada al evento.`);
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
                  const badgeCount = item.badge ? Math.max(0, Number(item.badge) - acknowledged.length) : null;
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
          <div className="gateway-badge"><span className="gateway-icon"><Server size={17} /></span><span><strong>{gatewayState === "online" ? "Cadena OT operativa" : "Cadena OT en puesta en marcha"}</strong><small>{activeController?.code ?? "Controlador pendiente"} → {gatewayCode ?? "Gateway pendiente"}</small></span><i className={gatewayState === "online" ? "" : "pending"} /></div>
          <button className="user-card" onClick={() => navigate("users")} aria-label="Abrir usuarios y roles"><span className="user-avatar">{sessionUser.displayName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span className="user-copy"><strong>{sessionUser.displayName}</strong><small>{sessionUser.roleName}</small></span><ChevronRight size={16} /></button>
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
            <section className="page-heading"><div><span className="eyebrow"><Activity size={13} /> Gestión de activos críticos</span><h1>{viewTitles[view].title}</h1><p>{viewTitles[view].description}</p></div><div className="heading-actions">{view !== "assets" && view !== "settings" && view !== "integrations" && view !== "users" && view !== "notifications" && view !== "reports" && view !== "maintenance" && view !== "diagnostics" && view !== "commissioning" && <button className="secondary-button" onClick={exportCsv}><Download size={16} /><span>Exportar</span></button>}<button className="primary-button" onClick={() => navigate("alarms")}><BellRing size={16} />{3 - acknowledged.length} alertas abiertas</button></div></section>
            {view === "overview" && <Overview onNavigate={navigate} onAcknowledge={acknowledge} acknowledged={acknowledged} />}
            {view === "cabinet" && <CabinetView onOpenTrend={openChannelTrend} />}
            {view === "diagnostics" && <DiagnosticsView />}
            {view === "commissioning" && <Cam5CommissioningView notify={notify} />}
            {view === "trends" && <TrendsView period={period} setPeriod={setPeriod} selectedId={trendSensorId} onSelectChannel={selectTrendChannel} onBackToMap={() => navigate("cabinet")} />}
            {view === "alarms" && <AlarmsView acknowledged={acknowledged} onAcknowledge={acknowledge} workOrders={workOrders} onOpenWorkOrder={openWorkOrderFromAlarm} closedIds={closedAlarmIds} setClosedIds={setClosedAlarmIds} assignees={alarmAssignees} setAssignees={setAlarmAssignees} notes={alarmNotes} setNotes={setAlarmNotes} />}
            {view === "history" && <HistoryView />}
            {view === "assets" && <OperationalHierarchyView hierarchy={hierarchy} loading={hierarchyLoading} permissions={sessionUser.permissions} onReload={loadHierarchy} onSwitchSite={switchSite} />}
            {view === "reports" && <ReportsView />}
            {view === "maintenance" && <MaintenanceView orders={workOrders} setOrders={setWorkOrders} focusOrderId={focusOrderId} />}
            {view === "settings" && <SettingsView />}
            {view === "integrations" && <IntegrationsView />}
            {view === "users" && <UsersView currentUserId={sessionUser.id} sites={sessionUser.sites} activeSiteId={sessionUser.siteId} />}
            {view === "notifications" && <NotificationsView />}
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

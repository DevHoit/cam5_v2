"use client";

import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  IconActivity as Activity,
  IconAlertTriangle as AlertTriangle,
  IconBellRinging as BellRing,
  IconBolt as Zap,
  IconBuilding as Building2,
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconCircleCheck as CheckCircle2,
  IconCircuitCell as CircuitBoard,
  IconClipboardCheck as ClipboardCheck,
  IconCopy as Copy,
  IconClock as Clock3,
  IconCalendarEvent as CalendarEvent,
  IconDatabase as Database,
  IconDeviceFloppy as Save,
  IconDownload as Download,
  IconDroplet as Droplets,
  IconFileReport as FileReport,
  IconFileTypePdf as FileTypePdf,
  IconGauge as Gauge,
  IconHistory as History,
  IconKey as Key,
  IconLayoutDashboard as LayoutDashboard,
  IconMail as Mail,
  IconMenu2 as Menu,
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
  IconTool as Tool,
  IconTrendingUp as TrendingUp,
  IconUserPlus as UserPlus,
  IconUsers as Users,
  IconWifi as Wifi,
  IconWebhook as Webhook,
  IconX as X,
} from "@tabler/icons-react";

type View = "overview" | "cabinet" | "trends" | "alarms" | "history" | "reports" | "maintenance" | "settings" | "integrations" | "users" | "notifications";
type Severity = "critical" | "warning" | "info";
type SensorState = "normal" | "warning" | "critical";
type HistoryTab = "measurements" | "alarms" | "audit";
type SettingsTab = "asset" | "channels" | "gateway";
type UserRole = "Administrador" | "Ingeniero" | "Operador" | "Solo lectura";

const sensors = [
  { id: "T01", label: "Barra fase L1", zone: "Barras principales", value: "68.4", unit: "°C", type: "Temperatura", state: "warning" as SensorState, trend: "+1.8 °C/h", threshold: "65 °C", register: "HR 40001", quality: "Válida" },
  { id: "T02", label: "Barra fase L2", zone: "Barras principales", value: "54.1", unit: "°C", type: "Temperatura", state: "normal" as SensorState, trend: "+0.2 °C/h", threshold: "65 °C", register: "HR 40002", quality: "Válida" },
  { id: "T03", label: "Barra fase L3", zone: "Barras principales", value: "52.8", unit: "°C", type: "Temperatura", state: "normal" as SensorState, trend: "+0.1 °C/h", threshold: "65 °C", register: "HR 40003", quality: "Válida" },
  { id: "T04", label: "Contacto superior", zone: "Interruptor", value: "47.2", unit: "°C", type: "Temperatura", state: "normal" as SensorState, trend: "Estable", threshold: "70 °C", register: "HR 40004", quality: "Válida" },
  { id: "T05", label: "Contacto inferior", zone: "Interruptor", value: "49.5", unit: "°C", type: "Temperatura", state: "normal" as SensorState, trend: "+0.3 °C/h", threshold: "70 °C", register: "HR 40005", quality: "Válida" },
  { id: "PD1", label: "Canal UHF 01", zone: "Compartimiento de cables", value: "72", unit: "idx", type: "Descarga parcial", state: "critical" as SensorState, trend: "Acelerando · Φ 2.8×", threshold: "60 idx", register: "HR 40121", quality: "Válida" },
  { id: "PD2", label: "Canal UHF 02", zone: "Barras principales", value: "18", unit: "idx", type: "Descarga parcial", state: "normal" as SensorState, trend: "Estable", threshold: "60 idx", register: "HR 40122", quality: "Válida" },
  { id: "H01", label: "Ambiente de cabina", zone: "Compartimiento de cables", value: "78", unit: "%RH", type: "Humedad", state: "warning" as SensorState, trend: "+4 % / 24h", threshold: "75 %RH", register: "HR 40201", quality: "Válida" },
];

const initialAlarms = [
  { id: "AL-260811-031", severity: "critical" as Severity, title: "Aceleración de descarga parcial", detail: "PD1 · Compartimiento de cables", since: "Hace 12 min", value: "Φ 2.8×", acknowledged: false },
  { id: "AL-260811-028", severity: "warning" as Severity, title: "Diferencial térmico elevado", detail: "T01 Barra L1 vs. L2/L3", since: "Hace 34 min", value: "+15.6 °C", acknowledged: false },
  { id: "AL-260811-019", severity: "warning" as Severity, title: "Humedad sobre umbral", detail: "H01 Ambiente cabina", since: "Hace 2 h", value: "78 %RH", acknowledged: false },
  { id: "AL-260810-104", severity: "info" as Severity, title: "Sincronización recuperada", detail: "Gateway CAM5-GW-01", since: "Ayer 18:42", value: "Resuelta", acknowledged: true },
];

const chartData = [
  [42, 16], [44, 18], [43, 17], [46, 19], [48, 21], [47, 22], [50, 24], [51, 27],
  [53, 31], [52, 30], [55, 36], [57, 39], [58, 42], [60, 46], [62, 51], [61, 50],
  [63, 55], [65, 59], [64, 61], [66, 66], [67, 70], [68, 72], [67, 71], [68, 74],
];

const auditEntries = [
  { time: "Hoy 11:48", user: "Emerson Allende", action: "Umbral crítico actualizado", target: "PD1 · 65 → 60 idx", origin: "Portal web" },
  { time: "Hoy 09:22", user: "Paula Rojas", action: "Alarma reconocida", target: "AL-260811-028 · T01", origin: "Portal web" },
  { time: "Ayer 18:43", user: "Sistema", action: "Gateway reconectado", target: "CAM5-GW-01", origin: "Servicio OT" },
  { time: "Ayer 16:15", user: "Emerson Allende", action: "Registro Modbus modificado", target: "H01 · HR 40201", origin: "Portal web" },
  { time: "10 ago 14:06", user: "Felipe Soto", action: "Informe exportado", target: "MCC-01 · 30 días", origin: "Portal web" },
];

const closedAlarms = [
  ...initialAlarms,
  { id: "AL-260809-087", severity: "warning" as Severity, title: "Latencia de gateway elevada", detail: "CAM5-GW-01 · Comunicaciones", since: "9 ago 13:22", value: "218 ms", acknowledged: true },
  { id: "AL-260807-044", severity: "info" as Severity, title: "Reinicio programado", detail: "CAM5-GW-01 · Firmware", since: "7 ago 02:00", value: "Completado", acknowledged: true },
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
      { id: "trends" as View, label: "Tendencias", description: "Evolución por canal", icon: History },
      { id: "alarms" as View, label: "Centro de alertas", description: "Triage y seguimiento", icon: BellRing, badge: "3" },
      { id: "history" as View, label: "Histórico", description: "Mediciones y trazabilidad", icon: Database },
    ],
  },
  {
    index: "03",
    label: "Gestión",
    items: [
      { id: "reports" as View, label: "Reportes", description: "Informes y programación", icon: FileReport },
      { id: "maintenance" as View, label: "Mantenimiento", description: "Planes y órdenes", icon: Tool },
    ],
  },
  {
    index: "04",
    label: "Administración",
    items: [
      { id: "settings" as View, label: "Configuración", description: "Activo, canales y gateway", icon: Settings },
      { id: "integrations" as View, label: "Integraciones", description: "Datos y sistemas externos", icon: PlugConnected },
      { id: "users" as View, label: "Usuarios y roles", description: "Acceso y permisos", icon: Users },
      { id: "notifications" as View, label: "Notificaciones", description: "Canales y escalamiento", icon: Mail },
    ],
  },
];

const viewTitles: Record<View, { title: string; description: string }> = {
  overview: { title: "Resumen de condición", description: "Estado predictivo de activos críticos en tiempo real." },
  cabinet: { title: "Mapa de condición", description: "Ubicación, lectura y estado de cada canal instrumentado." },
  trends: { title: "Tendencias", description: "Evolución térmica, descarga parcial y humedad ambiental." },
  alarms: { title: "Centro de alertas", description: "Triage operativo, reconocimiento y trazabilidad de eventos." },
  history: { title: "Histórico", description: "Mediciones, alarmas y cambios administrativos en una sola trazabilidad." },
  reports: { title: "Reportes", description: "Informes de condición, eventos y cumplimiento para operación y mantenimiento." },
  maintenance: { title: "Mantenimiento", description: "Plan preventivo y órdenes de trabajo priorizadas por condición." },
  settings: { title: "Configuración", description: "Parámetros del activo, canales de adquisición y comunicaciones." },
  integrations: { title: "Integraciones", description: "Conexiones, flujo de datos y acceso seguro para sistemas externos." },
  users: { title: "Usuarios y roles", description: "Control de acceso y permisos para la operación OT." },
  notifications: { title: "Notificaciones", description: "Canales de entrega, reglas de escalamiento y trazabilidad." },
};

function StatusPill({ state, children }: { state: SensorState | Severity | "online"; children: React.ReactNode }) {
  return <span className={`status-pill status-${state}`}><span className="status-dot" />{children}</span>;
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
  const sensor = sensors.find((item) => item.id === id)!;
  const stateLabel = sensor.state === "critical" ? "Crítico" : sensor.state === "warning" ? "Advertencia" : "Normal";
  return (
    <button
      type="button"
      className={`sensor-marker marker-${sensor.state} ${selectedId === id ? "selected" : ""}`}
      aria-label={`${sensor.id}, ${sensor.label}, ${sensor.value} ${sensor.unit}, ${sensor.state}`}
      aria-pressed={selectedId === id}
      onClick={() => onSelect?.(id)}
    >
      <span className="sensor-marker-top"><span className="sensor-marker-id">{sensor.id}</span><span className="sensor-marker-state"><i />{stateLabel}</span></span>
      <strong className="sensor-marker-value">{sensor.value}<small>{sensor.unit}</small></strong>
      <span className="sensor-marker-label">{sensor.label}</span>
    </button>
  );
}

function CabinetDiagram({ selectedId, onSelect }: { selectedId?: string; onSelect?: (id: string) => void }) {
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

      <div className="condition-map-footer"><span><Wifi size={15} /><span><strong>CAM5-GW-01</strong><small>Modbus TCP · último dato hace 2 s</small></span></span><StatusPill state="online">En línea</StatusPill></div>
    </div>
  );
}

function Overview({ onNavigate, onAcknowledge, acknowledged }: { onNavigate: (view: View) => void; onAcknowledge: (id: string) => void; acknowledged: string[] }) {
  const activeAlarms = initialAlarms.filter((alarm) => !alarm.acknowledged && !acknowledged.includes(alarm.id));
  return (
    <>
      <section className="metrics-grid">
        <MetricCard label="Temperatura máxima" value="68.4" unit="°C" note="T01 · +1.8 °C/h" tone="amber" icon={Thermometer} />
        <MetricCard label="Descarga parcial" value="72" unit="idx" note="PD1 · aceleración 2.8×" tone="red" icon={Activity} />
        <MetricCard label="Humedad relativa" value="78" unit="%" note="Sobre umbral operativo" tone="blue" icon={Droplets} />
        <MetricCard label="Disponibilidad" value="9/10" note="1 lector con latencia alta" tone="green" icon={Server} />
      </section>

      <section className="overview-grid">
        <article className="panel asset-summary-panel">
          <div className="panel-header asset-summary-header">
            <div><span className="eyebrow">Activo prioritario</span><h2>MCC-01 · Alimentador Norte</h2><p>Cabina de 13.8 kV · evaluación actualizada hace 2 s</p></div>
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
              <div className="condition-summary-title"><div><span className="eyebrow">Estado actual</span><h3>8 canales supervisados</h3></div><span className="online-mini"><i />Todos comunicando</span></div>
              <div className="condition-counts">
                <div className="count-critical"><strong>1</strong><span>Crítico</span></div>
                <div className="count-warning"><strong>2</strong><span>Advertencia</span></div>
                <div className="count-normal"><strong>5</strong><span>Normal</span></div>
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
  const [selectedId, setSelectedId] = useState("PD1");
  const selected = sensors.find((sensor) => sensor.id === selectedId)!;
  const SelectedIcon = selected.type === "Temperatura" ? Thermometer : selected.type === "Humedad" ? Droplets : Activity;
  const selectedStateLabel = selected.state === "critical" ? "Crítico" : selected.state === "warning" ? "Advertencia" : "Normal";

  return (
    <section className="cabinet-view-grid">
      <article className="panel cabinet-full-panel">
        <div className="panel-header"><div><span className="eyebrow">Mapa de condición de la cabina</span><h2>MCC-01 · Alimentador Norte</h2><p>8 canales activos · 16 disponibles</p></div><StatusPill state="critical">1 crítico · 2 advertencias</StatusPill></div>
        <CabinetDiagram selectedId={selectedId} onSelect={setSelectedId} />
        <div className="diagram-legend"><span><i className="dot-normal" />Normal</span><span><i className="dot-warning" />Advertencia</span><span><i className="dot-critical" />Crítico</span><span><i className="dot-disabled" />No configurado</span><small>Selecciona una tarjeta para revisar el canal.</small></div>
      </article>
      <article className="panel sensor-panel">
        <div className={`selected-sensor-card selected-${selected.state}`}>
          <div className="selected-sensor-head"><span className="selected-sensor-icon"><SelectedIcon size={21} /></span><div><small>Canal seleccionado</small><strong>{selected.id} · {selected.type}</strong></div><StatusPill state={selected.state}>{selectedStateLabel}</StatusPill></div>
          <div className="selected-sensor-value">{selected.value}<span>{selected.unit}</span></div>
          <p>{selected.label} · {selected.zone}</p>
          <dl><div><dt>Tendencia</dt><dd>{selected.trend}</dd></div><div><dt>Umbral</dt><dd>{selected.threshold}</dd></div><div><dt>Registro asumido</dt><dd>{selected.register}</dd></div><div><dt>Calidad</dt><dd>{selected.quality}</dd></div></dl>
          <button type="button" onClick={() => onOpenTrend(selected.id)}>Abrir tendencia del canal <TrendingUp size={16} /></button>
        </div>
        <div className="panel-header compact sensor-list-header"><div><span className="eyebrow">Canales configurados</span><h2>Matriz de sensores</h2></div><span className="data-fresh"><Wifi size={14} /> Hace 2 s</span></div>
        <div className="sensor-list">
          {sensors.map((sensor) => (
            <button type="button" className={`sensor-row ${selectedId === sensor.id ? "selected" : ""}`} key={sensor.id} onClick={() => setSelectedId(sensor.id)}>
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
  const selected = sensors.find((sensor) => sensor.id === selectedId) ?? sensors[0];
  const currentValue = Number(selected.value);
  const thresholdValue = Number.parseFloat(selected.threshold);
  const amplitude = selected.type === "Descarga parcial" ? (selected.state === "critical" ? 48 : 8) : selected.type === "Humedad" ? 14 : selected.state === "warning" ? 17 : 5;
  const profile = [-1, -.96, -.98, -.9, -.84, -.87, -.78, -.73, -.68, -.7, -.62, -.56, -.5, -.45, -.38, -.4, -.3, -.25, -.27, -.18, -.12, -.08, -.05, 0];
  const series = profile.map((point) => Math.max(0, Number((currentValue + point * amplitude).toFixed(1))));
  const chartMax = Math.ceil(Math.max(currentValue, thresholdValue, ...series) * 1.15 / 10) * 10;
  const variation = currentValue - series[0];
  const stateLabel = selected.state === "critical" ? "Crítico" : selected.state === "warning" ? "Advertencia" : "Normal";
  const stateTone = selected.state === "critical" ? "red" : selected.state === "warning" ? "amber" : "green";
  const SelectedIcon = selected.type === "Temperatura" ? Thermometer : selected.type === "Humedad" ? Droplets : Activity;
  const insight = selected.state === "critical"
    ? `${selected.id} mantiene crecimiento sostenido y supera el umbral configurado. Se recomienda inspección prioritaria de ${selected.zone.toLowerCase()}.`
    : selected.state === "warning"
      ? `${selected.id} se encuentra sobre el umbral operativo y presenta una tendencia ascendente. Conviene verificar el activo durante el próximo ciclo de carga.`
      : `${selected.id} permanece dentro del rango esperado y sin cambios relevantes durante el periodo seleccionado.`;

  return (
    <>
      <section className="toolbar-row">
        <div className="trend-toolbar-controls">
          <label className="channel-select"><Activity size={16} /><span><small>Canal</small><select value={selected.id} onChange={(event) => onSelectChannel(event.target.value)} aria-label="Seleccionar canal de tendencia">{sensors.map((sensor) => <option key={sensor.id} value={sensor.id}>{sensor.id} · {sensor.label}</option>)}</select></span><ChevronDown size={14} /></label>
          <div className="segmented" aria-label="Rango temporal">{["24 h", "7 días", "30 días"].map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div>
        </div>
      </section>
      <section className="metrics-grid compact-metrics">
        <MetricCard label="Lectura actual" value={selected.value} unit={selected.unit} note={`${selected.id} · ${selected.label}`} tone={stateTone} icon={SelectedIcon} />
        <MetricCard label="Umbral configurado" value={String(thresholdValue)} unit={selected.unit} note={currentValue > thresholdValue ? "Umbral superado" : "Dentro del rango"} tone={currentValue > thresholdValue ? "amber" : "green"} icon={Gauge} />
        <MetricCard label="Variación del periodo" value={`+${variation.toFixed(selected.type === "Descarga parcial" ? 0 : 1)}`} unit={selected.unit} note={selected.trend} tone="blue" icon={TrendingUp} />
        <MetricCard label="Calidad del dato" value="100" unit="%" note={`${selected.quality} · actualizado hace 2 s`} tone="green" icon={ShieldCheck} />
      </section>
      <article className="panel chart-panel">
        <div className="panel-header"><div><span className="eyebrow">{selected.id} · Resolución 1 hora · {period}</span><h2>{selected.label}</h2><p>{selected.zone} · {selected.type}</p></div><StatusPill state={selected.state}>{stateLabel}</StatusPill></div>
        <div className="chart-scale"><span>{chartMax}</span><span>{Math.round(chartMax * .75)}</span><span>{Math.round(chartMax * .5)}</span><span>{Math.round(chartMax * .25)}</span><span>0</span></div>
        <div className={`large-chart channel-chart chart-${selected.state}`}>
          <div className="threshold-line" style={{ bottom: `${Math.min(100, thresholdValue / chartMax * 100)}%` }}><span>Umbral {selected.threshold}</span></div>
          {series.map((value, index) => <span key={index} title={`${String(index).padStart(2, "0")}:00 · ${value} ${selected.unit}`}><i style={{ height: `${Math.max(3, value / chartMax * 100)}%` }} /></span>)}
        </div>
        <div className="chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
        <div className="chart-legend centered"><span><i className={`legend-channel legend-${selected.state}`} />{selected.id} · {selected.unit}</span><span><i className="legend-threshold" />Umbral {selected.threshold}</span></div>
      </article>
      <article className={`panel insight-panel insight-${selected.state}`}><span className="insight-icon"><TrendingUp size={20} /></span><div><strong>Interpretación del canal</strong><p>{insight}</p></div><button onClick={onBackToMap}><CircuitBoard size={15} /> Volver al mapa</button></article>
    </>
  );
}

function AlarmsView({ acknowledged, onAcknowledge }: { acknowledged: string[]; onAcknowledge: (id: string) => void }) {
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const [workflowStatus, setWorkflowStatus] = useState<"all" | "open" | "acknowledged" | "closed">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(initialAlarms[0].id);
  const [closedIds, setClosedIds] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<Record<string, string>>({ [initialAlarms[0].id]: "Paula Rojas" });
  const [notes, setNotes] = useState<Record<string, string[]>>({});
  const [noteInput, setNoteInput] = useState("");
  const getWorkflowStatus = (alarm: (typeof initialAlarms)[number]) => closedIds.includes(alarm.id) ? "closed" : alarm.acknowledged || acknowledged.includes(alarm.id) ? "acknowledged" : "open";
  const filtered = useMemo(() => initialAlarms.filter((alarm) => (severity === "all" || alarm.severity === severity) && (workflowStatus === "all" || getWorkflowStatus(alarm) === workflowStatus) && `${alarm.title} ${alarm.detail}`.toLowerCase().includes(query.toLowerCase())), [severity, workflowStatus, query, acknowledged, closedIds]);
  const selected = initialAlarms.find((alarm) => alarm.id === selectedId) ?? initialAlarms[0];
  const selectedStatus = getWorkflowStatus(selected);
  const selectedNotes = notes[selected.id] ?? [];
  const addNote = (event: React.FormEvent) => { event.preventDefault(); if (!noteInput.trim()) return; setNotes((current) => ({ ...current, [selected.id]: [...(current[selected.id] ?? []), noteInput.trim()] })); setNoteInput(""); };
  const closeEvent = () => { if (selectedStatus === "open") onAcknowledge(selected.id); setClosedIds((current) => current.includes(selected.id) ? current : [...current, selected.id]); };
  const reopenEvent = () => setClosedIds((current) => current.filter((id) => id !== selected.id));
  const openCritical = initialAlarms.filter((alarm) => alarm.severity === "critical" && !closedIds.includes(alarm.id)).length;
  const openWarnings = initialAlarms.filter((alarm) => alarm.severity === "warning" && !closedIds.includes(alarm.id)).length;
  return (
    <>
      <section className="alarm-summary">
        <div className="summary-tile critical"><span>Críticas abiertas</span><strong>{openCritical}</strong><AlertTriangle size={24} /></div>
        <div className="summary-tile warning"><span>Advertencias abiertas</span><strong>{openWarnings}</strong><BellRing size={24} /></div>
        <div className="summary-tile normal"><span>MTTA promedio</span><strong>8.5<small> min</small></strong><Clock3 size={24} /></div>
      </section>
      <article className="panel alarm-table-panel">
        <div className="alarm-toolbar">
          <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar mensaje, sensor o zona…" /></label>
          <div className="alarm-filters"><label className="status-filter"><span>Estado</span><select value={workflowStatus} onChange={(event) => setWorkflowStatus(event.target.value as typeof workflowStatus)}><option value="all">Todos</option><option value="open">Abiertas</option><option value="acknowledged">Reconocidas</option><option value="closed">Cerradas</option></select><ChevronDown size={13} /></label><div className="segmented">{(["all", "critical", "warning", "info"] as const).map((item) => <button key={item} className={severity === item ? "active" : ""} onClick={() => setSeverity(item)}>{item === "all" ? "Todas" : item === "critical" ? "Críticas" : item === "warning" ? "Advertencias" : "Info"}</button>)}</div></div>
        </div>
        <div className="alarm-table-wrap"><div className="alarm-table">
          <div className="alarm-table-head"><span>Severidad</span><span>Evento / activo</span><span>Tiempo activo</span><span>Valor</span><span>Estado</span><span>Acción</span></div>
          {filtered.map((alarm) => {
            const status = getWorkflowStatus(alarm);
            return <div className={`alarm-table-row ${selected.id === alarm.id ? "selected" : ""}`} key={alarm.id}>
              <span><StatusPill state={alarm.severity}>{alarm.severity === "critical" ? "Crítica" : alarm.severity === "warning" ? "Advertencia" : "Informativa"}</StatusPill></span>
              <span className="event-cell"><strong>{alarm.title}</strong><small>{alarm.detail} · {alarm.id}</small></span>
              <span>{alarm.since}</span><span><strong>{alarm.value}</strong></span>
              <span>{status === "closed" ? <span className="closed-state"><CheckCircle2 size={15} /> Cerrada</span> : status === "acknowledged" ? <span className="ack-state"><CheckCircle2 size={15} /> Reconocida</span> : <span className="unack-state"><Clock3 size={15} /> Sin reconocer</span>}</span>
              <span><button className={selected.id === alarm.id ? "ack-button" : "ghost-button"} onClick={() => setSelectedId(alarm.id)}>Gestionar</button></span>
            </div>;
          })}
        </div></div>
        <section className={`event-detail-panel event-${selected.severity}`}>
          <div className="event-detail-header"><span className="event-detail-icon"><AlertTriangle size={20} /></span><div><span className="eyebrow">Evento seleccionado · {selected.id}</span><h2>{selected.title}</h2><p>{selected.detail}</p></div><span className={`workflow-badge workflow-${selectedStatus}`}>{selectedStatus === "closed" ? "Cerrada" : selectedStatus === "acknowledged" ? "Reconocida" : "Abierta"}</span></div>
          <div className="event-workspace">
            <div className="event-management">
              <dl className="event-facts"><div><dt>Valor detectado</dt><dd>{selected.value}</dd></div><div><dt>Inicio</dt><dd>{selected.since}</dd></div><div><dt>Responsable</dt><dd><select value={assignees[selected.id] ?? "Sin asignar"} onChange={(event) => setAssignees((current) => ({ ...current, [selected.id]: event.target.value }))}><option>Sin asignar</option><option>Emerson Allende</option><option>Paula Rojas</option><option>Felipe Soto</option></select></dd></div></dl>
              <div className="event-actions">{selectedStatus === "open" && <button className="primary-button" onClick={() => onAcknowledge(selected.id)}><CheckCircle2 size={15} /> Reconocer evento</button>}{selectedStatus === "closed" ? <button className="secondary-button" onClick={reopenEvent}>Reabrir evento</button> : <button className="secondary-button" onClick={closeEvent}><ShieldCheck size={15} /> Cerrar evento</button>}</div>
            </div>
            <div className="event-timeline"><h3>Línea de tiempo</h3><div><span className="timeline-dot critical" /><p><strong>Evento detectado</strong><small>{selected.since} · Motor de reglas CAM5</small></p></div>{selectedStatus !== "open" && <div><span className="timeline-dot normal" /><p><strong>Evento reconocido</strong><small>Emerson Allende · Portal web</small></p></div>}{selectedNotes.map((note, index) => <div key={`${selected.id}-${index}`}><span className="timeline-dot info" /><p><strong>Nota operativa</strong><small>{note}</small></p></div>)}{selectedStatus === "closed" && <div><span className="timeline-dot normal" /><p><strong>Evento cerrado</strong><small>Condición revisada por el operador</small></p></div>}</div>
          </div>
          <form className="event-note-form" onSubmit={addNote}><input value={noteInput} onChange={(event) => setNoteInput(event.target.value)} placeholder="Agregar una nota de seguimiento…" /><button type="submit">Agregar nota</button></form>
        </section>
      </article>
    </>
  );
}

function HistoryView() {
  const [tab, setTab] = useState<HistoryTab>("measurements");
  const [range, setRange] = useState("24 h");
  const [channel, setChannel] = useState("all");
  const visibleSensors = channel === "all" ? sensors : sensors.filter((sensor) => sensor.id === channel);

  return (
    <>
      <section className="module-summary-grid">
        <article><span className="module-summary-icon blue"><Database size={19} /></span><div><small>Registros del periodo</small><strong>345,600</strong><span>8 canales · {range}</span></div></article>
        <article><span className="module-summary-icon green"><ShieldCheck size={19} /></span><div><small>Integridad de datos</small><strong>99.98%</strong><span>69 muestras estimadas</span></div></article>
        <article><span className="module-summary-icon amber"><BellRing size={19} /></span><div><small>Eventos registrados</small><strong>6</strong><span>1 crítico · 3 advertencias</span></div></article>
      </section>

      <article className="panel module-panel">
        <div className="module-toolbar">
          <div className="module-tabs" role="tablist" aria-label="Tipo de histórico">
            <button className={tab === "measurements" ? "active" : ""} onClick={() => setTab("measurements")}><Timeline size={16} /> Mediciones</button>
            <button className={tab === "alarms" ? "active" : ""} onClick={() => setTab("alarms")}><BellRing size={16} /> Alarmas</button>
            <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}><ShieldCheck size={16} /> Auditoría</button>
          </div>
          <div className="history-filters">
            {tab === "measurements" && <label><span>Canal</span><select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">Todos los canales</option>{sensors.map((sensor) => <option key={sensor.id} value={sensor.id}>{sensor.id} · {sensor.label}</option>)}</select><ChevronDown size={13} /></label>}
            <label><span>Periodo</span><select value={range} onChange={(event) => setRange(event.target.value)}><option>24 h</option><option>7 días</option><option>30 días</option><option>90 días</option></select><ChevronDown size={13} /></label>
          </div>
        </div>

        {tab === "measurements" && <div className="module-table-wrap"><div className="history-table measurement-history"><div className="module-table-head"><span>Canal</span><span>Última lectura</span><span>Promedio</span><span>Mínimo</span><span>Máximo</span><span>Calidad</span></div>{visibleSensors.map((sensor) => {
          const value = Number(sensor.value);
          const spread = sensor.type === "Descarga parcial" ? 8 : sensor.type === "Humedad" ? 5 : 4;
          return <div className="module-table-row" key={sensor.id}><span className="history-channel"><b className={`sensor-code sensor-${sensor.state}`}>{sensor.id}</b><span><strong>{sensor.label}</strong><small>{sensor.zone}</small></span></span><span className="mono-cell">{sensor.value} {sensor.unit}</span><span className="mono-cell">{(value - spread * .35).toFixed(1)} {sensor.unit}</span><span className="mono-cell">{(value - spread).toFixed(1)} {sensor.unit}</span><span className="mono-cell">{(value + (sensor.state === "normal" ? 1.2 : 2.4)).toFixed(1)} {sensor.unit}</span><span className="quality-ok"><CheckCircle2 size={14} /> Válida</span></div>;
        })}</div></div>}

        {tab === "alarms" && <div className="module-table-wrap"><div className="history-table alarm-history"><div className="module-table-head"><span>Fecha</span><span>Severidad</span><span>Evento</span><span>Valor</span><span>Estado</span></div>{closedAlarms.map((alarm, index) => <div className="module-table-row" key={alarm.id}><span>{index < 3 ? alarm.since : alarm.since}</span><span><StatusPill state={alarm.severity}>{alarm.severity === "critical" ? "Crítica" : alarm.severity === "warning" ? "Advertencia" : "Info"}</StatusPill></span><span className="event-cell"><strong>{alarm.title}</strong><small>{alarm.detail} · {alarm.id}</small></span><span className="mono-cell">{alarm.value}</span><span className={alarm.acknowledged ? "quality-ok" : "unack-state"}>{alarm.acknowledged ? <><CheckCircle2 size={14} /> Cerrada</> : <><Clock3 size={14} /> Abierta</>}</span></div>)}</div></div>}

        {tab === "audit" && <div className="module-table-wrap"><div className="history-table audit-history"><div className="module-table-head"><span>Fecha</span><span>Usuario</span><span>Acción</span><span>Detalle</span><span>Origen</span></div>{auditEntries.map((entry) => <div className="module-table-row" key={`${entry.time}-${entry.action}`}><span>{entry.time}</span><span><strong>{entry.user}</strong></span><span>{entry.action}</span><span className="mono-cell">{entry.target}</span><span>{entry.origin}</span></div>)}</div></div>}

        <div className="module-footer"><span><Database size={14} /> Retención configurada: 24 meses</span><small>Datos demostrativos · la persistencia se conectará al historiador.</small></div>
      </article>
    </>
  );
}

function ReportsView() {
  const templates = [
    { id: "condition", name: "Condición del activo", detail: "Salud general, hallazgos y recomendación técnica", icon: "condition", accent: "blue" },
    { id: "events", name: "Eventos y alarmas", detail: "Tiempos de atención, causas y trazabilidad operativa", icon: "events", accent: "amber" },
    { id: "executive", name: "Resumen ejecutivo", detail: "Indicadores consolidados para jefatura y confiabilidad", icon: "executive", accent: "green" },
  ];
  const [templateId, setTemplateId] = useState("condition");
  const [period, setPeriod] = useState("30 días");
  const [format, setFormat] = useState("PDF");
  const [automatic, setAutomatic] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [reports, setReports] = useState([
    { id: "RPT-260811-012", name: "Condición mensual MCC-01", period: "12 jul – 11 ago", created: "Hoy 11:50", format: "PDF", owner: "Emerson Allende" },
    { id: "RPT-260804-011", name: "Eventos críticos · Semana 32", period: "29 jul – 4 ago", created: "4 ago 18:10", format: "PDF", owner: "Sistema" },
    { id: "RPT-260801-010", name: "Resumen ejecutivo · Julio", period: "1 – 31 jul", created: "1 ago 08:00", format: "XLSX", owner: "Sistema" },
  ]);
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];
  const generateReport = () => {
    setGenerating(true);
    window.setTimeout(() => {
      setReports((current) => [{ id: `RPT-${Date.now().toString().slice(-9)}`, name: `${selectedTemplate.name} · MCC-01`, period, created: "Ahora", format, owner: "Emerson Allende" }, ...current]);
      setGenerating(false);
    }, 850);
  };
  const downloadReportData = (name: string) => {
    const rows = ["reporte,activo,canal,valor,unidad,estado", ...sensors.map((sensor) => [name, "MCC-01", sensor.id, sensor.value, sensor.unit, sensor.state].join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "cam5-datos-reporte.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      <section className="module-summary-grid report-summary-grid">
        <article><span className="module-summary-icon blue"><FileReport size={19} /></span><div><small>Informes disponibles</small><strong>{reports.length}</strong><span>Últimos 90 días</span></div></article>
        <article><span className="module-summary-icon green"><CalendarEvent size={19} /></span><div><small>Programaciones activas</small><strong>{automatic ? 3 : 2}</strong><span>Próximo: lunes 08:00</span></div></article>
        <article><span className="module-summary-icon amber"><Database size={19} /></span><div><small>Cobertura de datos</small><strong>99.98%</strong><span>8 canales incluidos</span></div></article>
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
            <button className="generate-report-button" onClick={generateReport} disabled={generating}>{generating ? <><Timeline size={17} /> Generando informe…</> : <><FileTypePdf size={17} /> Generar informe</>}</button>
            <small className="report-disclaimer">Vista funcional con datos demostrativos. El documento definitivo se conectará al servicio de reportes.</small>
          </aside>
        </div>

        <div className="report-library-head"><div><span className="eyebrow">Biblioteca</span><h2>Informes recientes</h2></div><span>{reports.length} documentos</span></div>
        <div className="module-table-wrap"><div className="report-table"><div className="module-table-head"><span>Informe</span><span>Periodo</span><span>Generado</span><span>Formato</span><span>Responsable</span><span>Datos</span></div>{reports.map((report) => <div className="module-table-row" key={report.id}><span className="report-name-cell"><b><FileReport size={16} /></b><span><strong>{report.name}</strong><small>{report.id}</small></span></span><span>{report.period}</span><span>{report.created}</span><span><i className="report-format">{report.format}</i></span><span>{report.owner}</span><span><button className="ghost-button" onClick={() => downloadReportData(report.name)}><Download size={14} /> Descargar datos</button></span></div>)}</div></div>
      </article>
    </>
  );
}

function MaintenanceView() {
  type WorkStatus = "Pendiente" | "En curso" | "Completada";
  const [tab, setTab] = useState<"plan" | "orders">("plan");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", priority: "Alta", assignee: "Paula Rojas" });
  const [orders, setOrders] = useState<Array<{ id: string; title: string; source: string; due: string; priority: "Crítica" | "Alta" | "Normal"; assignee: string; status: WorkStatus }>>([
    { id: "OT-260811-018", title: "Diagnóstico de descarga parcial", source: "PD1 · Evento AL-260811-031", due: "Hoy · 16:00", priority: "Crítica", assignee: "Emerson Allende", status: "En curso" },
    { id: "OT-260811-017", title: "Inspección termográfica dirigida", source: "T01 · Diferencial +15.6 °C", due: "21 ago 2026", priority: "Alta", assignee: "Paula Rojas", status: "Pendiente" },
    { id: "OT-260810-014", title: "Control de humedad en cabina", source: "H01 · 78 %RH", due: "22 ago 2026", priority: "Alta", assignee: "Felipe Soto", status: "Pendiente" },
    { id: "OT-260731-009", title: "Verificación mensual de gateway", source: "Plan preventivo PM-04", due: "31 jul 2026", priority: "Normal", assignee: "Felipe Soto", status: "Completada" },
  ]);
  const plans = [
    { code: "PM-01", name: "Inspección termográfica", frequency: "Mensual", next: "21 ago 2026", progress: 82, state: "Próxima" },
    { code: "PM-02", name: "Diagnóstico UHF de descarga parcial", frequency: "Trimestral", next: "Hoy", progress: 100, state: "Vencida" },
    { code: "PM-03", name: "Limpieza y control ambiental", frequency: "Trimestral", next: "22 ago 2026", progress: 78, state: "Próxima" },
    { code: "PM-04", name: "Verificación de gateway y registros", frequency: "Mensual", next: "31 ago 2026", progress: 36, state: "En plazo" },
  ];
  const openOrders = orders.filter((order) => order.status !== "Completada").length;
  const createOrder = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    setOrders((current) => [{ id: `OT-${Date.now().toString().slice(-9)}`, title: form.title.trim(), source: "Creación manual · Portal web", due: "Sin programar", priority: form.priority as "Alta" | "Normal", assignee: form.assignee, status: "Pendiente" }, ...current]);
    setForm({ title: "", priority: "Alta", assignee: "Paula Rojas" }); setShowCreate(false); setTab("orders");
  };
  const updateOrder = (id: string, status: WorkStatus) => setOrders((current) => current.map((order) => order.id === id ? { ...order, status } : order));

  return (
    <>
      <section className="module-summary-grid maintenance-summary-grid">
        <article><span className="module-summary-icon green"><ClipboardCheck size={19} /></span><div><small>Cumplimiento preventivo</small><strong>87%</strong><span>Meta mensual: 90%</span></div></article>
        <article><span className="module-summary-icon amber"><CalendarEvent size={19} /></span><div><small>Tareas próximas</small><strong>3</strong><span>1 requiere atención hoy</span></div></article>
        <article><span className="module-summary-icon blue"><Tool size={19} /></span><div><small>Órdenes abiertas</small><strong>{openOrders}</strong><span>1 crítica · 2 altas</span></div></article>
      </section>

      <article className="panel module-panel maintenance-module">
        <div className="module-toolbar"><div className="module-tabs" role="tablist" aria-label="Secciones de mantenimiento"><button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}><CalendarEvent size={16} /> Plan preventivo</button><button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><ClipboardCheck size={16} /> Órdenes de trabajo</button></div><button className="primary-button" onClick={() => setShowCreate((current) => !current)}><Plus size={16} /> {showCreate ? "Cancelar" : "Nueva orden"}</button></div>

        {showCreate && <form className="work-order-form" onSubmit={createOrder}><label><span>Trabajo requerido</span><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ej.: Revisar conexión del sensor T02" /></label><label><span>Prioridad</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option>Alta</option><option>Normal</option></select></label><label><span>Responsable</span><select value={form.assignee} onChange={(event) => setForm({ ...form, assignee: event.target.value })}><option>Paula Rojas</option><option>Emerson Allende</option><option>Felipe Soto</option></select></label><button type="submit"><ClipboardCheck size={15} /> Crear orden</button></form>}

        {tab === "plan" && <div className="maintenance-plan-content"><div className="settings-section-head"><span className="settings-icon"><CalendarEvent size={20} /></span><div><h2>Plan basado en condición</h2><p>La frecuencia se complementa con los hallazgos de telemetría y eventos activos.</p></div></div><div className="maintenance-plan-grid">{plans.map((plan) => <article className={`maintenance-plan-card plan-${plan.state.toLowerCase().replace(" ", "-")}`} key={plan.code}><div className="maintenance-plan-head"><span>{plan.code}</span><i>{plan.state}</i></div><h3>{plan.name}</h3><dl><div><dt>Frecuencia</dt><dd>{plan.frequency}</dd></div><div><dt>Próxima ejecución</dt><dd>{plan.next}</dd></div></dl><div className="maintenance-progress"><span><i style={{ width: `${plan.progress}%` }} /></span><small>{plan.progress}% del intervalo consumido</small></div><button onClick={() => { setForm({ title: plan.name, priority: plan.state === "Vencida" ? "Alta" : "Normal", assignee: "Paula Rojas" }); setShowCreate(true); }}><Plus size={14} /> Crear orden desde el plan</button></article>)}</div><div className="maintenance-recommendation"><AlertTriangle size={19} /><div><strong>Recomendación prioritaria</strong><p>Adelantar el diagnóstico UHF de PD1 y coordinar una ventana de inspección antes de cualquier intervención invasiva.</p></div><button onClick={() => setTab("orders")}>Revisar órdenes <ChevronRight size={15} /></button></div></div>}

        {tab === "orders" && <div className="maintenance-orders"><div className="report-library-head"><div><span className="eyebrow">Ejecución</span><h2>Órdenes de trabajo</h2></div><span>{openOrders} abiertas</span></div><div className="module-table-wrap"><div className="work-order-table"><div className="module-table-head"><span>Orden / trabajo</span><span>Origen</span><span>Vencimiento</span><span>Prioridad</span><span>Responsable</span><span>Estado</span></div>{orders.map((order) => <div className="module-table-row" key={order.id}><span className="event-cell"><strong>{order.title}</strong><small>{order.id}</small></span><span>{order.source}</span><span>{order.due}</span><span><i className={`maintenance-priority priority-${order.priority.toLowerCase()}`}>{order.priority}</i></span><span>{order.assignee}</span><span><select className={`work-status status-${order.status.toLowerCase().replace(" ", "-")}`} value={order.status} onChange={(event) => updateOrder(order.id, event.target.value as WorkStatus)}><option>Pendiente</option><option>En curso</option><option>Completada</option></select></span></div>)}</div></div></div>}
        <div className="module-footer"><span><ShieldCheck size={14} /> Toda modificación queda asociada al usuario y al activo.</span><small>Flujo demostrativo · pendiente de integración con CMMS.</small></div>
      </article>
    </>
  );
}

function IntegrationsView() {
  const [tab, setTab] = useState<"connections" | "flow" | "api">("connections");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showApiForm, setShowApiForm] = useState(false);
  const [apiForm, setApiForm] = useState({ name: "", scope: "Solo lectura" });
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [connections, setConnections] = useState([
    { id: "gateway", name: "Gateway CAM5-GW-01", role: "Fuente principal", protocol: "Modbus TCP", endpoint: "192.168.10.42:502", enabled: true, status: "Operativa", freshness: "Hace 2 s" },
    { id: "historian", name: "Historiador OT", role: "Destino de mediciones", protocol: "OPC UA", endpoint: "opc.tcp://10.20.4.15:4840", enabled: true, status: "Operativa", freshness: "Hace 8 s" },
    { id: "cmms", name: "CMMS de mantenimiento", role: "Destino de órdenes", protocol: "REST / Webhook", endpoint: "https://cmms.local/api/cam5", enabled: false, status: "Pendiente", freshness: "Sin sincronizar" },
  ]);
  const [apiKeys, setApiKeys] = useState([
    { id: 1, name: "Historiador OT", token: "cam5_live_••••••••7K2P", scope: "Telemetría · lectura", created: "4 ago 2026", lastUse: "Hace 8 s", active: true },
    { id: 2, name: "CMMS mantenimiento", token: "cam5_live_••••••••9M4R", scope: "Eventos · escritura", created: "1 ago 2026", lastUse: "Nunca", active: false },
  ]);
  const activeConnections = connections.filter((connection) => connection.enabled).length;
  const testConnection = (id: string) => {
    setTestingId(id);
    setConnections((current) => current.map((connection) => connection.id === id ? { ...connection, status: "Probando…" } : connection));
    window.setTimeout(() => {
      setConnections((current) => current.map((connection) => connection.id === id ? { ...connection, status: "Operativa", freshness: "Ahora" } : connection));
      setTestingId(null);
    }, 900);
  };
  const toggleConnection = (id: string) => setConnections((current) => current.map((connection) => connection.id === id ? { ...connection, enabled: !connection.enabled, status: connection.enabled ? "Desactivada" : "Operativa", freshness: connection.enabled ? "Sin sincronizar" : "Ahora" } : connection));
  const createApiKey = (event: React.FormEvent) => {
    event.preventDefault();
    if (!apiForm.name.trim()) return;
    const rawKey = `cam5_live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    setApiKeys((current) => [{ id: Date.now(), name: apiForm.name.trim(), token: `${rawKey.slice(0, 10)}••••••••${rawKey.slice(-4).toUpperCase()}`, scope: apiForm.scope, created: "Ahora", lastUse: "Nunca", active: true }, ...current]);
    setNewApiKey(rawKey); setApiForm({ name: "", scope: "Solo lectura" }); setShowApiForm(false);
  };
  const revokeApiKey = (id: number) => setApiKeys((current) => current.map((key) => key.id === id ? { ...key, active: !key.active } : key));
  const copyApiKey = async () => { if (!newApiKey) return; await navigator.clipboard?.writeText(newApiKey); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  const syncLog = [
    { time: "11:52:08", system: "Gateway CAM5-GW-01", action: "Lectura Modbus completada", detail: "8 canales · 42 ms", state: "Correcta" },
    { time: "11:52:02", system: "Historiador OT", action: "Lote de mediciones entregado", detail: "24 muestras", state: "Correcta" },
    { time: "11:48:04", system: "Motor de eventos", action: "Evento crítico publicado", detail: "AL-260811-031", state: "Correcta" },
    { time: "10:15:31", system: "CMMS mantenimiento", action: "Orden pendiente de sincronización", detail: "OT-260811-018", state: "En espera" },
  ];

  return (
    <>
      <section className="module-summary-grid integration-summary-grid">
        <article><span className="module-summary-icon green"><PlugConnected size={19} /></span><div><small>Conexiones activas</small><strong>{activeConnections}</strong><span>de {connections.length} configuradas</span></div></article>
        <article><span className="module-summary-icon blue"><Refresh size={19} /></span><div><small>Sincronización</small><strong>99.98%</strong><span>Últimas 24 horas</span></div></article>
        <article><span className="module-summary-icon amber"><Webhook size={19} /></span><div><small>Cola de salida</small><strong>1</strong><span>Orden CMMS pendiente</span></div></article>
      </section>

      <article className="panel module-panel integration-module">
        <div className="module-toolbar"><div className="module-tabs" role="tablist" aria-label="Secciones de integraciones"><button className={tab === "connections" ? "active" : ""} onClick={() => setTab("connections")}><PlugConnected size={16} /> Conexiones</button><button className={tab === "flow" ? "active" : ""} onClick={() => setTab("flow")}><Timeline size={16} /> Flujo de datos</button><button className={tab === "api" ? "active" : ""} onClick={() => setTab("api")}><Key size={16} /> Acceso API</button></div><span className="autosave-state"><ShieldCheck size={14} /> Configuración local protegida</span></div>

        {tab === "connections" && <div className="integration-content"><div className="settings-section-head"><span className="settings-icon"><PlugConnected size={20} /></span><div><h2>Conectores de plataforma</h2><p>Administra el ingreso de telemetría y la salida hacia sistemas corporativos.</p></div></div><div className="integration-card-grid">{connections.map((connection) => <article className={`integration-card ${connection.enabled ? "enabled" : "disabled"}`} key={connection.id}><div className="integration-card-head"><span className="integration-card-icon">{connection.id === "gateway" ? <Radio size={21} /> : connection.id === "historian" ? <Database size={21} /> : <Tool size={21} />}</span><button className={`switch-control ${connection.enabled ? "on" : ""}`} onClick={() => toggleConnection(connection.id)} aria-label={`${connection.enabled ? "Desactivar" : "Activar"} ${connection.name}`}><i /></button></div><span className="eyebrow">{connection.role}</span><h3>{connection.name}</h3><dl><div><dt>Protocolo</dt><dd>{connection.protocol}</dd></div><div><dt>Destino</dt><dd title={connection.endpoint}>{connection.endpoint}</dd></div><div><dt>Última actividad</dt><dd>{connection.freshness}</dd></div></dl><div className="integration-card-footer"><span className={connection.enabled && connection.status === "Operativa" ? "quality-ok" : connection.status === "Probando…" ? "integration-testing" : "muted-state"}>{connection.status === "Operativa" && <CheckCircle2 size={14} />}{connection.status}</span><button onClick={() => testConnection(connection.id)} disabled={!connection.enabled || testingId === connection.id}>{testingId === connection.id ? "Probando…" : "Probar conexión"}</button></div></article>)}</div><div className="configuration-note"><ShieldCheck size={17} /><p><strong>Separación OT/IT.</strong> Los destinos externos se presentan como configuración de interfaz. La conexión real deberá usar certificados, secretos protegidos y reglas de red autorizadas.</p></div></div>}

        {tab === "flow" && <div className="integration-content flow-content"><div className="settings-section-head"><span className="settings-icon"><Timeline size={20} /></span><div><h2>Ruta operacional de los datos</h2><p>Desde la adquisición en terreno hasta los consumidores internos y externos.</p></div></div><div className="data-flow"><article><span><Activity size={21} /></span><small>Origen</small><strong>8 canales CAM5</strong><p>Temperatura, UHF y humedad</p></article><i><ChevronRight size={19} /></i><article><span><Radio size={21} /></span><small>Adquisición</small><strong>CAM5-GW-01</strong><p>Modbus TCP · cada 2 s</p></article><i><ChevronRight size={19} /></i><article className="flow-core"><span><Zap size={21} /></span><small>Procesamiento</small><strong>CAM5 CORE</strong><p>Reglas, eventos e histórico</p></article><i><ChevronRight size={19} /></i><article><span><Database size={21} /></span><small>Consumo</small><strong>OT + CMMS</strong><p>Historiador, órdenes y API</p></article></div><div className="flow-grid"><section><div className="report-library-head"><div><span className="eyebrow">Mapeo</span><h2>Señales publicadas</h2></div><span>8 activas</span></div><div className="module-table-wrap"><div className="integration-mapping-table"><div className="module-table-head"><span>Canal</span><span>Registro</span><span>Variable publicada</span><span>Destino</span><span>Calidad</span></div>{sensors.map((sensor) => <div className="module-table-row" key={sensor.id}><span><b className={`sensor-code sensor-${sensor.state}`}>{sensor.id}</b></span><span className="mono-cell">{sensor.register}</span><span className="mono-cell">cam5.mcc01.{sensor.id.toLowerCase()}</span><span>{sensor.id === "PD1" ? "Historiador + CMMS" : "Historiador OT"}</span><span className="quality-ok"><CheckCircle2 size={14} /> Válida</span></div>)}</div></div></section><aside className="sync-activity"><div className="report-library-head"><div><span className="eyebrow">Actividad</span><h2>Últimas sincronizaciones</h2></div></div><div>{syncLog.map((entry) => <article key={`${entry.time}-${entry.system}`}><span className={entry.state === "Correcta" ? "normal" : "warning"}><Refresh size={15} /></span><div><strong>{entry.action}</strong><small>{entry.system} · {entry.detail}</small></div><time>{entry.time}</time></article>)}</div></aside></div></div>}

        {tab === "api" && <div className="integration-content api-content"><div className="api-section-head"><div className="settings-section-head"><span className="settings-icon"><Key size={20} /></span><div><h2>Credenciales de integración</h2><p>Claves para servicios que consumen o publican información en CAM5.</p></div></div><button className="primary-button" onClick={() => setShowApiForm((current) => !current)}><Plus size={16} /> {showApiForm ? "Cancelar" : "Nueva clave"}</button></div>{showApiForm && <form className="api-key-form" onSubmit={createApiKey}><label><span>Nombre de la integración</span><input required value={apiForm.name} onChange={(event) => setApiForm({ ...apiForm, name: event.target.value })} placeholder="Ej.: Panel de confiabilidad" /></label><label><span>Alcance</span><select value={apiForm.scope} onChange={(event) => setApiForm({ ...apiForm, scope: event.target.value })}><option>Solo lectura</option><option>Telemetría · lectura</option><option>Eventos · escritura</option></select></label><button type="submit"><Key size={15} /> Crear clave</button></form>}{newApiKey && <div className="api-key-reveal"><ShieldCheck size={19} /><div><strong>Copia la nueva clave ahora</strong><code>{newApiKey}</code><small>Por seguridad, no volverá a mostrarse completa.</small></div><button onClick={copyApiKey}>{copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}{copied ? "Copiada" : "Copiar"}</button></div>}<div className="api-layout"><section className="api-key-list"><div className="report-library-head"><div><span className="eyebrow">Credenciales</span><h2>Claves registradas</h2></div><span>{apiKeys.filter((key) => key.active).length} activas</span></div>{apiKeys.map((key) => <article key={key.id}><span className={`api-key-icon ${key.active ? "active" : ""}`}><Key size={18} /></span><div><strong>{key.name}</strong><code>{key.token}</code><small>{key.scope} · Creada {key.created} · Uso: {key.lastUse}</small></div><button className="ghost-button" onClick={() => revokeApiKey(key.id)}>{key.active ? "Revocar" : "Reactivar"}</button></article>)}</section><aside className="api-endpoints"><span className="eyebrow">Endpoints disponibles</span><h3>API CAM5 v1</h3><p>Rutas propuestas para la futura integración con servicios autorizados.</p><dl><div><dt>GET</dt><dd>/api/v1/assets/mcc-01/readings</dd></div><div><dt>GET</dt><dd>/api/v1/assets/mcc-01/events</dd></div><div><dt>POST</dt><dd>/api/v1/work-orders</dd></div><div><dt>POST</dt><dd>/api/v1/webhooks/events</dd></div></dl><div className="configuration-note"><Webhook size={16} /><p>Los endpoints son parte del diseño del frontend; todavía no exponen información real.</p></div></aside></div></div>}
      </article>
    </>
  );
}

function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>("asset");
  const [saved, setSaved] = useState(false);
  const [connection, setConnection] = useState<"idle" | "testing" | "success">("idle");
  const [assetConfig, setAssetConfig] = useState({ name: "MCC-01", description: "Alimentador Norte", voltage: "13.8", location: "Subestación Norte", timezone: "America/Santiago" });
  const [gatewayConfig, setGatewayConfig] = useState({ name: "CAM5-GW-01", protocol: "Modbus TCP", ip: "192.168.10.42", port: "502", unit: "1", polling: "2" });
  const [channels, setChannels] = useState(sensors.map((sensor) => ({ ...sensor, enabled: true, warning: sensor.id === "PD1" ? "40" : sensor.id === "PD2" ? "40" : sensor.id === "H01" ? "75" : sensor.threshold.split(" ")[0], critical: sensor.id.startsWith("PD") ? "60" : sensor.id === "H01" ? "85" : String(Number(sensor.threshold.split(" ")[0]) + 10) })));
  const saveChanges = () => { setSaved(true); window.setTimeout(() => setSaved(false), 2400); };
  const testConnection = () => { setConnection("testing"); window.setTimeout(() => setConnection("success"), 900); };
  const updateChannel = (id: string, field: "enabled" | "warning" | "critical", value: boolean | string) => setChannels((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));

  return (
    <article className="panel module-panel settings-module">
      <div className="module-toolbar">
        <div className="module-tabs" role="tablist" aria-label="Secciones de configuración">
          <button className={tab === "asset" ? "active" : ""} onClick={() => setTab("asset")}><Building2 size={16} /> Activo</button>
          <button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}><Activity size={16} /> Canales y umbrales</button>
          <button className={tab === "gateway" ? "active" : ""} onClick={() => setTab("gateway")}><PlugConnected size={16} /> Gateway</button>
        </div>
        <button className={`save-config-button ${saved ? "saved" : ""}`} onClick={saveChanges}>{saved ? <CheckCircle2 size={16} /> : <Save size={16} />}{saved ? "Cambios guardados" : "Guardar cambios"}</button>
      </div>

      {tab === "asset" && <div className="settings-content"><div className="settings-section-head"><span className="settings-icon"><Building2 size={20} /></span><div><h2>Identificación del activo</h2><p>Datos utilizados en navegación, reportes y trazabilidad.</p></div></div><div className="form-grid"><label><span>Código del activo</span><input value={assetConfig.name} onChange={(event) => setAssetConfig({ ...assetConfig, name: event.target.value })} /></label><label><span>Descripción</span><input value={assetConfig.description} onChange={(event) => setAssetConfig({ ...assetConfig, description: event.target.value })} /></label><label><span>Tensión nominal</span><div className="input-unit"><input value={assetConfig.voltage} onChange={(event) => setAssetConfig({ ...assetConfig, voltage: event.target.value })} /><b>kV</b></div></label><label><span>Ubicación</span><input value={assetConfig.location} onChange={(event) => setAssetConfig({ ...assetConfig, location: event.target.value })} /></label><label className="form-span-2"><span>Zona horaria</span><select value={assetConfig.timezone} onChange={(event) => setAssetConfig({ ...assetConfig, timezone: event.target.value })}><option>America/Santiago</option><option>UTC</option></select></label></div><div className="configuration-note"><ShieldCheck size={17} /><p><strong>Control de cambios activo.</strong> Las modificaciones quedarán registradas en el histórico de auditoría cuando exista persistencia.</p></div></div>}

      {tab === "channels" && <div className="settings-content channels-settings"><div className="settings-section-head"><span className="settings-icon"><Activity size={20} /></span><div><h2>Canales y umbrales</h2><p>Habilita señales y define niveles operativos de alarma.</p></div></div><div className="channel-config-table"><div className="channel-config-head"><span>Canal</span><span>Registro</span><span>Advertencia</span><span>Crítico</span><span>Estado</span></div>{channels.map((channel) => <div className="channel-config-row" key={channel.id}><span className="history-channel"><b className={`sensor-code sensor-${channel.state}`}>{channel.id}</b><span><strong>{channel.label}</strong><small>{channel.type}</small></span></span><span className="mono-cell">{channel.register}</span><label className="compact-input"><input value={channel.warning} onChange={(event) => updateChannel(channel.id, "warning", event.target.value)} /><b>{channel.unit}</b></label><label className="compact-input"><input value={channel.critical} onChange={(event) => updateChannel(channel.id, "critical", event.target.value)} /><b>{channel.unit}</b></label><button className={`channel-toggle ${channel.enabled ? "on" : ""}`} onClick={() => updateChannel(channel.id, "enabled", !channel.enabled)}><i />{channel.enabled ? "Activo" : "Inactivo"}</button></div>)}</div></div>}

      {tab === "gateway" && <div className="settings-content"><div className="settings-section-head"><span className="settings-icon"><PlugConnected size={20} /></span><div><h2>Comunicaciones del gateway</h2><p>Parámetros asumidos para la conexión con CAM5.</p></div></div><div className="gateway-layout"><div className="form-grid"><label><span>Nombre</span><input value={gatewayConfig.name} onChange={(event) => setGatewayConfig({ ...gatewayConfig, name: event.target.value })} /></label><label><span>Protocolo</span><select value={gatewayConfig.protocol} onChange={(event) => setGatewayConfig({ ...gatewayConfig, protocol: event.target.value })}><option>Modbus TCP</option><option>Modbus RTU</option></select></label><label><span>Dirección IP</span><input value={gatewayConfig.ip} onChange={(event) => setGatewayConfig({ ...gatewayConfig, ip: event.target.value })} /></label><label><span>Puerto</span><input value={gatewayConfig.port} onChange={(event) => setGatewayConfig({ ...gatewayConfig, port: event.target.value })} /></label><label><span>Unit ID</span><input value={gatewayConfig.unit} onChange={(event) => setGatewayConfig({ ...gatewayConfig, unit: event.target.value })} /></label><label><span>Intervalo de lectura</span><div className="input-unit"><input value={gatewayConfig.polling} onChange={(event) => setGatewayConfig({ ...gatewayConfig, polling: event.target.value })} /><b>s</b></div></label></div><aside className="connection-test-card"><span className={`connection-test-icon ${connection}`}><Radio size={24} /></span><h3>Prueba de conectividad</h3><p>Valida acceso, puerto y respuesta Modbus sin guardar los cambios.</p><dl><div><dt>Destino</dt><dd>{gatewayConfig.ip}:{gatewayConfig.port}</dd></div><div><dt>Timeout</dt><dd>3 segundos</dd></div></dl><button onClick={testConnection} disabled={connection === "testing"}>{connection === "testing" ? "Probando…" : connection === "success" ? <><CheckCircle2 size={15} /> Conexión correcta</> : <><PlugConnected size={15} /> Probar conexión</>}</button></aside></div></div>}
    </article>
  );
}

function UsersView() {
  const [users, setUsers] = useState<Array<{ id: number; name: string; email: string; role: UserRole; status: "Activo" | "Suspendido" | "Invitado"; lastAccess: string }>>([
    { id: 1, name: "Emerson Allende", email: "emerson@cam5.local", role: "Administrador", status: "Activo", lastAccess: "Ahora" },
    { id: 2, name: "Paula Rojas", email: "paula.rojas@cam5.local", role: "Ingeniero", status: "Activo", lastAccess: "Hace 18 min" },
    { id: 3, name: "Felipe Soto", email: "felipe.soto@cam5.local", role: "Operador", status: "Activo", lastAccess: "Hace 2 h" },
    { id: 4, name: "Camila Díaz", email: "camila.diaz@cam5.local", role: "Solo lectura", status: "Invitado", lastAccess: "Pendiente" },
  ]);
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("Operador");
  const inviteUser = (event: React.FormEvent) => { event.preventDefault(); if (!email.trim()) return; const base = email.split("@")[0].replace(/[._-]+/g, " "); const name = base.replace(/\b\w/g, (letter) => letter.toUpperCase()); setUsers((current) => [...current, { id: Date.now(), name, email, role, status: "Invitado", lastAccess: "Pendiente" }]); setEmail(""); setShowInvite(false); };
  const updateRole = (id: number, nextRole: UserRole) => setUsers((current) => current.map((user) => user.id === id ? { ...user, role: nextRole } : user));
  const toggleUser = (id: number) => setUsers((current) => current.map((user) => user.id === id ? { ...user, status: user.status === "Activo" ? "Suspendido" : "Activo" } : user));

  return (
    <>
      <section className="module-summary-grid user-summary-grid"><article><span className="module-summary-icon blue"><Users size={19} /></span><div><small>Usuarios registrados</small><strong>{users.length}</strong><span>{users.filter((user) => user.status === "Activo").length} activos</span></div></article><article><span className="module-summary-icon green"><ShieldCheck size={19} /></span><div><small>Administradores</small><strong>{users.filter((user) => user.role === "Administrador").length}</strong><span>Acceso total</span></div></article><article><span className="module-summary-icon amber"><Mail size={19} /></span><div><small>Invitaciones pendientes</small><strong>{users.filter((user) => user.status === "Invitado").length}</strong><span>Sin primer acceso</span></div></article></section>
      <article className="panel module-panel users-module">
        <div className="module-toolbar"><div><span className="eyebrow">Control de acceso</span><h2>Equipo con acceso al portal</h2></div><button className="primary-button" onClick={() => setShowInvite((current) => !current)}><UserPlus size={16} />{showInvite ? "Cancelar" : "Invitar usuario"}</button></div>
        {showInvite && <form className="invite-form" onSubmit={inviteUser}><label><span>Correo electrónico</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@empresa.cl" /></label><label><span>Rol inicial</span><select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>{["Administrador", "Ingeniero", "Operador", "Solo lectura"].map((item) => <option key={item}>{item}</option>)}</select></label><button type="submit"><Mail size={15} /> Enviar invitación</button></form>}
        <div className="module-table-wrap"><div className="users-table"><div className="module-table-head"><span>Usuario</span><span>Rol</span><span>Estado</span><span>Último acceso</span><span>Acción</span></div>{users.map((user) => <div className="module-table-row" key={user.id}><span className="user-identity"><b>{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</b><span><strong>{user.name}</strong><small>{user.email}</small></span></span><span><select value={user.role} onChange={(event) => updateRole(user.id, event.target.value as UserRole)}>{["Administrador", "Ingeniero", "Operador", "Solo lectura"].map((item) => <option key={item}>{item}</option>)}</select></span><span><i className={`user-status status-${user.status.toLowerCase()}`}>{user.status}</i></span><span>{user.lastAccess}</span><span><button className="ghost-button" disabled={user.id === 1} onClick={() => toggleUser(user.id)}>{user.status === "Activo" ? "Suspender" : "Activar"}</button></span></div>)}</div></div>
        <div className="role-matrix"><div><span className="eyebrow">Matriz de permisos</span><h3>Alcance de cada rol</h3></div><div className="role-matrix-grid"><span><strong>Administrador</strong><small>Configuración, usuarios y operación completa</small></span><span><strong>Ingeniero</strong><small>Diagnóstico, umbrales y reportes</small></span><span><strong>Operador</strong><small>Supervisión y reconocimiento de alarmas</small></span><span><strong>Solo lectura</strong><small>Consulta sin capacidad de modificación</small></span></div></div>
      </article>
    </>
  );
}

function NotificationsView() {
  const [tab, setTab] = useState<"channels" | "rules" | "delivery">("channels");
  const [testedChannel, setTestedChannel] = useState<string | null>(null);
  const [channels, setChannels] = useState([
    { id: "email", name: "Correo OT", detail: "Alertas a responsables y turnos", destination: "operaciones@cam5.local", enabled: true, status: "Verificado" },
    { id: "teams", name: "Microsoft Teams", detail: "Canal del equipo de mantenimiento", destination: "Equipo · Mantenimiento eléctrico", enabled: true, status: "Conectado" },
    { id: "webhook", name: "Webhook CMMS", detail: "Creación de avisos externos", destination: "https://cmms.local/cam5/events", enabled: false, status: "Sin configurar" },
  ]);
  const [rules, setRules] = useState([
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
  const testChannel = (id: string) => { setTestedChannel(id); window.setTimeout(() => setTestedChannel(null), 2200); };
  const toggleChannel = (id: string) => setChannels((current) => current.map((channel) => channel.id === id ? { ...channel, enabled: !channel.enabled } : channel));
  const updateRule = (id: number, field: "delay" | "recipients" | "enabled", value: string | boolean) => setRules((current) => current.map((rule) => rule.id === id ? { ...rule, [field]: value } : rule));

  return (
    <>
      <section className="module-summary-grid notification-summary"><article><span className="module-summary-icon green"><Mail size={19} /></span><div><small>Canales activos</small><strong>{channels.filter((channel) => channel.enabled).length}</strong><span>de {channels.length} configurados</span></div></article><article><span className="module-summary-icon blue"><BellRing size={19} /></span><div><small>Reglas habilitadas</small><strong>{rules.filter((rule) => rule.enabled).length}</strong><span>Escalamiento automático</span></div></article><article><span className="module-summary-icon amber"><CheckCircle2 size={19} /></span><div><small>Entrega últimas 24 h</small><strong>100%</strong><span>4 de 4 entregadas</span></div></article></section>
      <article className="panel module-panel notification-module">
        <div className="module-toolbar"><div className="module-tabs" role="tablist" aria-label="Secciones de notificaciones"><button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}><Mail size={16} /> Canales</button><button className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}><BellRing size={16} /> Escalamiento</button><button className={tab === "delivery" ? "active" : ""} onClick={() => setTab("delivery")}><Timeline size={16} /> Entregas</button></div><span className="autosave-state"><CheckCircle2 size={14} /> Cambios locales guardados</span></div>

        {tab === "channels" && <div className="notification-content"><div className="settings-section-head"><span className="settings-icon"><Mail size={20} /></span><div><h2>Canales de notificación</h2><p>Define cómo se informa un evento a los equipos responsables.</p></div></div><div className="notification-channel-grid">{channels.map((channel) => <article className={`notification-channel-card ${channel.enabled ? "enabled" : ""}`} key={channel.id}><div className="notification-channel-head"><span className="notification-channel-icon">{channel.id === "email" ? <Mail size={20} /> : channel.id === "teams" ? <Users size={20} /> : <PlugConnected size={20} />}</span><button className={`switch-control ${channel.enabled ? "on" : ""}`} onClick={() => toggleChannel(channel.id)} aria-label={`${channel.enabled ? "Desactivar" : "Activar"} ${channel.name}`}><i /></button></div><h3>{channel.name}</h3><p>{channel.detail}</p><dl><div><dt>Destino</dt><dd>{channel.destination}</dd></div><div><dt>Estado</dt><dd className={channel.enabled ? "quality-ok" : "muted-state"}>{channel.status}</dd></div></dl><button className="test-notification-button" onClick={() => testChannel(channel.id)} disabled={!channel.enabled}>{testedChannel === channel.id ? <><CheckCircle2 size={15} /> Prueba enviada</> : <><BellRing size={15} /> Enviar prueba</>}</button></article>)}</div></div>}

        {tab === "rules" && <div className="notification-content notification-rules"><div className="settings-section-head"><span className="settings-icon"><BellRing size={20} /></span><div><h2>Reglas de escalamiento</h2><p>Relaciona severidad, espera y destinatarios responsables.</p></div></div><div className="notification-rule-table"><div className="notification-rule-head"><span>Condición</span><span>Alcance</span><span>Espera</span><span>Destinatarios</span><span>Estado</span></div>{rules.map((rule) => <div className="notification-rule-row" key={rule.id}><span><strong>{rule.event}</strong></span><span>{rule.scope}</span><span><select value={rule.delay} onChange={(event) => updateRule(rule.id, "delay", event.target.value)}><option>Inmediato</option><option>5 minutos</option><option>10 minutos</option><option>30 minutos</option></select></span><span><select value={rule.recipients} onChange={(event) => updateRule(rule.id, "recipients", event.target.value)}><option>Administrador</option><option>Administrador + Ingeniero</option><option>Ingeniero + Operador</option><option>Operador</option></select></span><span><button className={`channel-toggle ${rule.enabled ? "on" : ""}`} onClick={() => updateRule(rule.id, "enabled", !rule.enabled)}><i />{rule.enabled ? "Activa" : "Inactiva"}</button></span></div>)}</div><div className="configuration-note"><ShieldCheck size={17} /><p>Las reglas críticas se envían de inmediato. Las esperas solo se aplican cuando la condición permanece activa durante el periodo configurado.</p></div></div>}

        {tab === "delivery" && <div className="notification-content delivery-content"><div className="settings-section-head"><span className="settings-icon"><Timeline size={20} /></span><div><h2>Registro de entregas</h2><p>Trazabilidad de mensajes emitidos por el motor de notificaciones.</p></div></div><div className="module-table-wrap"><div className="delivery-table"><div className="module-table-head"><span>Fecha</span><span>Evento</span><span>Canal</span><span>Destino</span><span>Resultado</span></div>{deliveries.map((delivery) => <div className="module-table-row" key={`${delivery.time}-${delivery.channel}`}><span className="mono-cell">{delivery.time}</span><span>{delivery.event}</span><span>{delivery.channel}</span><span>{delivery.recipient}</span><span className="quality-ok"><CheckCircle2 size={14} /> {delivery.state}</span></div>)}</div></div></div>}
      </article>
    </>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [period, setPeriod] = useState("24 h");
  const [trendSensorId, setTrendSensorId] = useState("T01");
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [asset, setAsset] = useState("MCC-01 · Alimentador Norte");

  const navigate = (next: View) => { setView(next); setMenuOpen(false); };
  const openChannelTrend = (id: string) => { setTrendSensorId(id); navigate("trends"); };
  const acknowledge = (id: string) => setAcknowledged((current) => current.includes(id) ? current : [...current, id]);
  const exportCsv = () => {
    const rows = ["canal,tipo,ubicacion,valor,unidad,estado", ...sensors.map((sensor) => [sensor.id, sensor.type, sensor.zone, sensor.value, sensor.unit, sensor.state].join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "cam5-telemetria.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="app-shell">
      {menuOpen && <button className="mobile-scrim" aria-label="Cerrar navegación" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand-block">
          <span className="brand-mark"><Zap size={22} strokeWidth={2.3} /></span>
          <div className="brand-copy"><span className="brand-name"><strong>CAM5</strong><b>CORE</b></span><small>Critical asset intelligence</small></div>
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
          <div className="gateway-badge"><span className="gateway-icon"><Server size={17} /></span><span><strong>Gateway operativo</strong><small>CAM5-GW-01 · 42 ms</small></span><i /></div>
          <button className="user-card"><span className="user-avatar">EA</span><span className="user-copy"><strong>Emerson Allende</strong><small>Administrador OT</small></span><ChevronRight size={16} /></button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-left"><button className="menu-button" aria-label="Abrir navegación" onClick={() => setMenuOpen(true)}><Menu size={22} /></button><span className="mobile-brand"><Zap size={18} fill="currentColor" /></span><div className="site-selector"><Building2 size={17} /><div><span>Subestación Norte</span><select value={asset} onChange={(event) => setAsset(event.target.value)} aria-label="Seleccionar activo"><option>MCC-01 · Alimentador Norte</option><option>MCC-02 · Banco de condensadores</option><option>TR-01 · Transformador principal</option></select></div><ChevronDown size={15} /></div></div>
          <div className="topbar-right"><span className="demo-pill">Datos simulados</span><div className="live-state"><span /><div><strong>Telemetría activa</strong><small>Actualizado hace 2 s</small></div></div></div>
        </header>

        <div className="content-scroll">
          <div className="page-content">
            <section className="page-heading"><div><span className="eyebrow"><Activity size={13} /> Gestión de activos críticos</span><h1>{viewTitles[view].title}</h1><p>{viewTitles[view].description}</p></div><div className="heading-actions">{view !== "settings" && view !== "integrations" && view !== "users" && view !== "notifications" && view !== "reports" && view !== "maintenance" && <button className="secondary-button" onClick={exportCsv}><Download size={16} /><span>Exportar</span></button>}<button className="primary-button" onClick={() => navigate("alarms")}><BellRing size={16} />{3 - acknowledged.length} alertas abiertas</button></div></section>
            {view === "overview" && <Overview onNavigate={navigate} onAcknowledge={acknowledge} acknowledged={acknowledged} />}
            {view === "cabinet" && <CabinetView onOpenTrend={openChannelTrend} />}
            {view === "trends" && <TrendsView period={period} setPeriod={setPeriod} selectedId={trendSensorId} onSelectChannel={setTrendSensorId} onBackToMap={() => navigate("cabinet")} />}
            {view === "alarms" && <AlarmsView acknowledged={acknowledged} onAcknowledge={acknowledge} />}
            {view === "history" && <HistoryView />}
            {view === "reports" && <ReportsView />}
            {view === "maintenance" && <MaintenanceView />}
            {view === "settings" && <SettingsView />}
            {view === "integrations" && <IntegrationsView />}
            {view === "users" && <UsersView />}
            {view === "notifications" && <NotificationsView />}
          </div>
        </div>
      </main>
    </div>
  );
}

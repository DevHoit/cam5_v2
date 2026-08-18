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
  IconClock as Clock3,
  IconDotsVertical as DotsVertical,
  IconDownload as Download,
  IconDroplet as Droplets,
  IconGauge as Gauge,
  IconHistory as History,
  IconLayoutDashboard as LayoutDashboard,
  IconMenu2 as Menu,
  IconRadio as Radio,
  IconSearch as Search,
  IconServer as Server,
  IconShieldCheck as ShieldCheck,
  IconTemperature as Thermometer,
  IconTrendingUp as TrendingUp,
  IconWifi as Wifi,
  IconX as X,
} from "@tabler/icons-react";

type View = "overview" | "cabinet" | "trends" | "alarms";
type Severity = "critical" | "warning" | "info";
type SensorState = "normal" | "warning" | "critical";

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
      { id: "trends" as View, label: "Tendencias", description: "Históricos y correlación", icon: History },
      { id: "alarms" as View, label: "Centro de alertas", description: "Triage y seguimiento", icon: BellRing, badge: "3" },
    ],
  },
];

const viewTitles: Record<View, { title: string; description: string }> = {
  overview: { title: "Resumen de condición", description: "Estado predictivo de activos críticos en tiempo real." },
  cabinet: { title: "Mapa de condición", description: "Ubicación, lectura y estado de cada canal instrumentado." },
  trends: { title: "Tendencias", description: "Evolución térmica, descarga parcial y humedad ambiental." },
  alarms: { title: "Centro de alertas", description: "Triage operativo, reconocimiento y trazabilidad de eventos." },
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

function CabinetView() {
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
          <button type="button">Abrir tendencia del canal <TrendingUp size={16} /></button>
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

function TrendsView({ period, setPeriod, onExport }: { period: string; setPeriod: (period: string) => void; onExport: () => void }) {
  return (
    <>
      <section className="toolbar-row">
        <div className="segmented" aria-label="Rango temporal">{["24 h", "7 días", "30 días"].map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div>
        <button className="secondary-button" onClick={onExport}><Download size={16} /> Exportar CSV</button>
      </section>
      <section className="metrics-grid compact-metrics">
        <MetricCard label="Máxima T01" value="68.4" unit="°C" note="A las 11:42" tone="amber" icon={Thermometer} />
        <MetricCard label="Promedio térmico" value="51.8" unit="°C" note="+3.2 °C vs. periodo anterior" tone="blue" icon={Gauge} />
        <MetricCard label="Máximo PD1" value="74" unit="idx" note="SNR 18.2 dB" tone="red" icon={Activity} />
        <MetricCard label="Variación humedad" value="+8" unit="%" note="Rango 66–78 %RH" tone="green" icon={Droplets} />
      </section>
      <article className="panel chart-panel">
        <div className="panel-header"><div><span className="eyebrow">Resolución 1 hora · {period}</span><h2>Temperatura vs. descarga parcial</h2><p>La correlación aumenta durante los periodos de mayor carga.</p></div><StatusPill state="warning">Correlación 0.78</StatusPill></div>
        <div className="chart-scale"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div>
        <div className="large-chart">
          {chartData.map(([temp, pd], index) => <span key={index} title={`${index}:00 · T ${temp} · PD ${pd}`}><i style={{ height: `${temp}%` }} /><b style={{ height: `${pd}%` }} /></span>)}
        </div>
        <div className="chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
        <div className="chart-legend centered"><span><i className="legend-temp" />Temperatura T01 (°C)</span><span><i className="legend-pd" />Índice PD1</span></div>
      </article>
      <article className="panel insight-panel"><span className="insight-icon"><TrendingUp size={20} /></span><div><strong>Hallazgo operativo</strong><p>PD1 supera el patrón base desde las 16:00 y acelera junto con el diferencial térmico de L1. Se recomienda inspección prioritaria del compartimiento de cables.</p></div><button>Crear orden de inspección</button></article>
    </>
  );
}

function AlarmsView({ acknowledged, onAcknowledge }: { acknowledged: string[]; onAcknowledge: (id: string) => void }) {
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => initialAlarms.filter((alarm) => (severity === "all" || alarm.severity === severity) && `${alarm.title} ${alarm.detail}`.toLowerCase().includes(query.toLowerCase())), [severity, query]);
  return (
    <>
      <section className="alarm-summary">
        <div className="summary-tile critical"><span>Críticas</span><strong>1</strong><AlertTriangle size={24} /></div>
        <div className="summary-tile warning"><span>Advertencias</span><strong>2</strong><BellRing size={24} /></div>
        <div className="summary-tile normal"><span>MTTA promedio</span><strong>8.5<small> min</small></strong><Clock3 size={24} /></div>
      </section>
      <article className="panel alarm-table-panel">
        <div className="alarm-toolbar">
          <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar mensaje, sensor o zona…" /></label>
          <div className="segmented">{(["all", "critical", "warning", "info"] as const).map((item) => <button key={item} className={severity === item ? "active" : ""} onClick={() => setSeverity(item)}>{item === "all" ? "Todas" : item === "critical" ? "Críticas" : item === "warning" ? "Advertencias" : "Info"}</button>)}</div>
        </div>
        <div className="alarm-table">
          <div className="alarm-table-head"><span>Severidad</span><span>Evento / activo</span><span>Tiempo activo</span><span>Valor</span><span>Estado</span><span>Acción</span></div>
          {filtered.map((alarm) => {
            const isAck = alarm.acknowledged || acknowledged.includes(alarm.id);
            return <div className="alarm-table-row" key={alarm.id}>
              <span><StatusPill state={alarm.severity}>{alarm.severity === "critical" ? "Crítica" : alarm.severity === "warning" ? "Advertencia" : "Informativa"}</StatusPill></span>
              <span className="event-cell"><strong>{alarm.title}</strong><small>{alarm.detail} · {alarm.id}</small></span>
              <span>{alarm.since}</span><span><strong>{alarm.value}</strong></span>
              <span>{isAck ? <span className="ack-state"><CheckCircle2 size={15} /> Reconocida</span> : <span className="unack-state"><Clock3 size={15} /> Sin reconocer</span>}</span>
              <span>{isAck ? <button className="ghost-button">Ver detalle</button> : <button className="ack-button" onClick={() => onAcknowledge(alarm.id)}>Reconocer</button>}</span>
            </div>;
          })}
        </div>
      </article>
    </>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [period, setPeriod] = useState("24 h");
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [asset, setAsset] = useState("MCC-01 · Alimentador Norte");

  const navigate = (next: View) => { setView(next); setMenuOpen(false); };
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

        <div className="sidebar-context">
          <div className="context-heading"><span>Contexto activo</span><button aria-label="Cambiar contexto"><DotsVertical size={16} /></button></div>
          <div className="context-card">
            <span className="context-icon"><Building2 size={18} /></span>
            <div><strong>Subestación Norte</strong><small>MCC-01 · 13.8 kV</small></div>
            <span className="context-state" title="Atención requerida" />
          </div>
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
            <section className="page-heading"><div><span className="eyebrow"><Activity size={13} /> Gestión de activos críticos</span><h1>{viewTitles[view].title}</h1><p>{viewTitles[view].description}</p></div><div className="heading-actions"><button className="secondary-button" onClick={exportCsv}><Download size={16} /><span>Exportar</span></button><button className="primary-button" onClick={() => navigate("alarms")}><BellRing size={16} />{3 - acknowledged.length} alertas abiertas</button></div></section>
            {view === "overview" && <Overview onNavigate={navigate} onAcknowledge={acknowledge} acknowledged={acknowledged} />}
            {view === "cabinet" && <CabinetView />}
            {view === "trends" && <TrendsView period={period} setPeriod={setPeriod} onExport={exportCsv} />}
            {view === "alarms" && <AlarmsView acknowledged={acknowledged} onAcknowledge={acknowledge} />}
          </div>
        </div>
      </main>
    </div>
  );
}

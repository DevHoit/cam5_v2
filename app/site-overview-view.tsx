"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  IconAlertTriangle,
  IconBattery2,
  IconChevronRight,
  IconCircleCheck,
  IconPlugConnectedX,
  IconRefresh,
  IconRouterOff,
  IconWifi1,
} from "@tabler/icons-react";

type Severity = "normal" | "warning" | "critical";
type PointStatus = Severity | "offline";
type Group = "temperature" | "humidity" | "discharge";
type GroupCell = { value: number | null; unit: string | null; channelCode: string | null; channelName: string | null; severity: Severity };
type System = "condition" | "cold" | "energy" | "backup" | "other";
type Condition = { status: "in_range" | "out_of_range" | "no_range" | "no_data"; value: number | null; unit: string | null; decimals: number; quantityName: string | null; decisivePosition: string | null; sensors: number; reporting: number; rangeMin: number | null; rangeMax: number | null; aggregation: string; secondary: { name: string; value: number; unit: string; decimals: number } | null };
type SitePoint = { id: string; code: string; name: string; area: string | null; type: string; typeName: string; system: System; condition: Condition | null; deviceCode: string | null; status: PointStatus; lastReadAt: string | null; openAlarms: number; alarmSeverity: Severity | null; groups: Record<Group, GroupCell> };
type SystemSummary = { system: System; name: string; points: number; attention: number; offline: number };
type AttentionItem = { pointId: string; pointName: string; system: System; severity: Severity | "offline"; reason: "out_of_range" | "alarm" | "offline"; detail: string };
type HealthIssue = { kind: "sensor_stale" | "battery_low" | "weak_signal" | "gateway_offline"; severity: "warning" | "critical"; pointId: string | null; pointName: string | null; deviceName: string; position: string | null; detail: string };
type Highest = { value: number; unit: string | null; pointCode: string; channelCode: string | null } | null;
type Overview = { serverTime: string; points: SitePoint[]; summary: { total: number; online: number; withAlarms: number; highest: Record<Group, Highest> }; systems: SystemSummary[]; attention: AttentionItem[]; health: HealthIssue[] };
type SiteEvent = { id: string; title: string; severity: string; status: string; openedAt: string; assetName: string | null; channelName: string | null; assignedToName: string | null };
type Trend = { group: Group; hours: number; bucketSeconds: number; from: string; to: string; unit: string | null; warningThreshold: number | null; criticalThreshold: number | null; points: Array<{ id: string; code: string; name: string; series: Array<[string, number]> }> };

const GROUPS: Array<{ key: Group; label: string; short: string; name: string }> = [
  { key: "temperature", label: "Temperatura máxima", short: "Temp. máx.", name: "Temperatura" },
  { key: "humidity", label: "Humedad máxima", short: "Humedad máx.", name: "Humedad" },
  { key: "discharge", label: "Descarga UHF máxima", short: "UHF máx.", name: "UHF" },
];
const PERIODS = [{ hours: 24, label: "24 h" }, { hours: 168, label: "7 días" }, { hours: 720, label: "30 días" }];
const STATUS: Record<PointStatus, { label: string; icon: typeof IconCircleCheck }> = {
  critical: { label: "Crítico", icon: IconAlertTriangle },
  warning: { label: "Advertencia", icon: IconAlertTriangle },
  offline: { label: "Sin comunicación", icon: IconPlugConnectedX },
  normal: { label: "Normal", icon: IconCircleCheck },
};
// Color y trazo siguen al punto (orden por código), nunca a su posición en el ranking.
const SERIES = [
  { color: "#2a78d6", dash: "" },
  { color: "#7c3aed", dash: "7 4" },
  { color: "#1baf7a", dash: "2 3" },
  { color: "#c98500", dash: "10 3 2 3" },
  { color: "#d55181", dash: "" },
  { color: "#6250d6", dash: "7 4" },
  { color: "#008300", dash: "2 3" },
  { color: "#e34948", dash: "10 3 2 3" },
];
const REFRESH_MS = 30_000;

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "include", cache: "no-store" });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "No fue posible cargar la vista del sitio.");
  return payload;
}

const number = (value: number, digits = 1) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
const formatValue = (value: number | null, unit: string | null) => value === null ? "—" : `${number(value)}${unit ? ` ${unit === "%RH" ? "%" : unit}` : ""}`;

function since(iso: string | null, now: number): string {
  if (!iso) return "sin lecturas";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return `hace ${seconds} s`;
  if (seconds < 5400) return `hace ${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `hace ${Math.round(seconds / 3600)} h`;
  return `hace ${Math.round(seconds / 86400)} días`;
}

export function SiteOverviewView({ siteName, onOpenPoint, onDiagnose, onOpenAlarms }: { siteName: string; onOpenPoint: (pointId: string) => void; onDiagnose?: () => void; onOpenAlarms?: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [group, setGroup] = useState<Group>("temperature");
  const [hours, setHours] = useState(24);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [trendError, setTrendError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () => getJson<Overview>("/api/v1/site-overview")
      .then((result) => { if (active) { setData(result); setError(""); } })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la vista del sitio."); });
    void load();
    const timer = window.setInterval(() => { void load(); setTick((value) => value + 1); }, REFRESH_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    getJson<Trend>(`/api/v1/site-overview/trend?group=${group}&hours=${hours}`)
      .then((result) => { if (active) { setTrend(result); setTrendError(""); } })
      .catch((loadError: unknown) => { if (active) setTrendError(loadError instanceof Error ? loadError.message : "No fue posible cargar la comparación."); });
    return () => { active = false; };
  }, [group, hours, tick]);
  const [sparks, setSparks] = useState<Record<Group, Map<string, number[]>> | null>(null);
  const [thresholds, setThresholds] = useState<Record<Group, number | null>>({ temperature: null, humidity: null, discharge: null });
  const [events, setEvents] = useState<SiteEvent[] | null>(null);

  // Mini-gráficas de 24 h por punto y variable, y los últimos eventos del sitio; se refrescan con la vista.
  useEffect(() => {
    let active = true;
    Promise.all(GROUPS.map((item) => getJson<Trend>(`/api/v1/site-overview/trend?group=${item.key}&hours=24`)))
      .then((results) => {
        if (!active) return;
        const next = {} as Record<Group, Map<string, number[]>>;
        const limits = {} as Record<Group, number | null>;
        results.forEach((result, index) => {
          const key = GROUPS[index].key;
          next[key] = new Map(result.points.map((point) => [point.id, point.series.map(([, value]) => value)]));
          limits[key] = result.warningThreshold;
        });
        setSparks(next);
        setThresholds(limits);
      })
      .catch(() => undefined);
    getJson<{ items: SiteEvent[] }>("/api/v1/alarms?page=1&pageSize=6&status=all")
      .then((result) => { if (active) setEvents(result.items); })
      .catch(() => { if (active) setEvents([]); });
    return () => { active = false; };
  }, [tick]);


  if (!data) {
    return error
      ? <article className="panel site-overview-message"><IconAlertTriangle size={20} /><div><strong>No se pudo cargar la vista del sitio</strong><p>{error}</p></div></article>
      : <article className="panel site-overview-message"><IconRefresh className="spin" size={20} /> Cargando los puntos del sitio…</article>;
  }
  const now = new Date(data.serverTime).getTime();
  const { summary } = data;
  const nameByCode = new Map(data.points.map((point) => [point.code, point.name]));
  const offline = summary.total - summary.online;
  const lastRead = data.points.reduce<string | null>((latest, point) => point.lastReadAt && (!latest || point.lastReadAt > latest) ? point.lastReadAt : latest, null);
  const highest = (label: string, item: Highest) => item ? <span>{label} <b>{formatValue(item.value, item.unit)}</b> · {nameByCode.get(item.pointCode) ?? item.pointCode}</span> : null;
  const systemName = (system: System) => data.systems.find((item) => item.system === system)?.name ?? system;
  const hasCondition = data.systems.some((system) => system.system === "condition");

  return <>
    {summary.total > 0 && offline === summary.total && <section className="site-incident critical" role="alert">
      <IconPlugConnectedX size={18} aria-hidden="true" />
      <div><strong>{summary.total === 1 ? "El punto de medición no entrega datos" : `Ninguno de los ${summary.total} puntos entrega datos`}</strong><p>{lastRead ? `Última lectura ${since(lastRead, now)}.` : "Aún no llegan lecturas."} Revisa la comunicación entre el gateway y los equipos de medición.</p></div>
      {onDiagnose && <button type="button" onClick={onDiagnose}>Diagnosticar</button>}
    </section>}

    <AttentionPanel siteName={siteName} items={data.attention} systems={data.systems} systemName={systemName} onOpenPoint={onOpenPoint} />

    {error && <p className="site-points-stale"><IconAlertTriangle size={14} /> {error} Se muestran los últimos datos recibidos.</p>}
    {data.points.length === 0 && <article className="panel site-overview-message"><div><strong>Sin puntos de medición</strong><p>El sitio no tiene puntos activos a los que tengas acceso.</p></div></article>}

    {data.systems.map((system) => {
      const own = data.points.filter((point) => point.system === system.system);
      const ok = system.points - system.attention - system.offline;
      return <section key={system.system} className={`site-system system-${system.system}`} aria-label={system.name}>
        <header>
          <h2>{system.name}</h2>
          <span>{ok} de {system.points} en orden{system.attention ? ` · ${system.attention} con observaciones` : ""}{system.offline ? ` · ${system.offline} sin datos` : ""}</span>
          {system.system === "condition" && <span className="site-system-highest">{highest("Temp. máx.", summary.highest.temperature)}{highest("UHF máx.", summary.highest.discharge)}</span>}
        </header>
        {system.system === "condition"
          ? <div className="site-cards">{own.map((point) => <PointCard key={point.id} point={point} now={now} sparks={sparks} thresholds={thresholds} onOpen={() => onOpenPoint(point.id)} onDiagnose={onDiagnose} />)}</div>
          : <div className="sys-cards">{own.map((point) => <SystemPointCard key={point.id} point={point} now={now} onOpen={() => onOpenPoint(point.id)} />)}</div>}
      </section>;
    })}

    <HealthPanel issues={data.health} onOpenPoint={onOpenPoint} onDiagnose={onDiagnose} />

    <div className={`site-bottom ${hasCondition ? "" : "events-only"}`}>
      {hasCondition && <article className="panel site-compare" aria-label="Comparación entre puntos">
        <header>
          <h2>{GROUPS.find((item) => item.key === group)?.label} por punto</h2>
          <div className="site-compare-controls">
            <div role="radiogroup" aria-label="Variable">{GROUPS.map((item) => <button key={item.key} type="button" role="radio" aria-checked={group === item.key} className={group === item.key ? "active" : ""} onClick={() => setGroup(item.key)}>{item.name}</button>)}</div>
            <div role="radiogroup" aria-label="Periodo">{PERIODS.map((item) => <button key={item.hours} type="button" role="radio" aria-checked={hours === item.hours} className={hours === item.hours ? "active" : ""} onClick={() => setHours(item.hours)}>{item.label}</button>)}</div>
          </div>
        </header>
        {trendError && !trend ? <p className="site-points-empty">{trendError}</p> : trend ? <CompareChart trend={trend} /> : <p className="site-points-empty"><IconRefresh className="spin" size={15} /> Cargando la comparación…</p>}
      </article>}
      <article className="panel site-events" aria-label="Eventos recientes">
        <header><h2>Eventos recientes</h2>{onOpenAlarms && <button type="button" className="site-link" onClick={onOpenAlarms}>Ver alertas</button>}</header>
        {events === null ? <p className="site-points-empty"><IconRefresh className="spin" size={15} /> Cargando…</p> : events.length === 0 ? <p className="site-points-empty">Sin eventos en el sitio.</p> : <ul>{events.map((event) => <li key={event.id}>
          <i className={`dot ${event.status === "resolved" || event.status === "closed" ? "normal" : event.severity === "critical" ? "critical" : event.severity === "warning" ? "warning" : "offline"}`} />
          <span><strong>{event.title}</strong><small>{[event.assetName, event.channelName, event.assignedToName ?? (event.status === "open" ? "sin asignar" : null)].filter(Boolean).join(" · ")}</small></span>
          <time dateTime={event.openedAt}>{clock(event.openedAt, now)}</time>
        </li>)}</ul>}
      </article>
    </div>
  </>;
}

function clock(iso: string, now: number) {
  const date = new Date(iso);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return new Intl.DateTimeFormat("es-CL", sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" }).format(date);
}

function Sparkline({ values, threshold, tone }: { values: number[]; threshold: number | null; tone: string }) {
  if (values.length < 2) return <svg className="site-spark" viewBox="0 0 120 30" aria-hidden="true"><line x1="0" x2="120" y1="29" y2="29" className="spark-empty" /></svg>;
  let low = Math.min(...values), high = Math.max(...values);
  const near = threshold !== null && threshold <= high + (high - low || 1) * 1.5 && threshold >= low - (high - low || 1) * 1.5;
  if (near && threshold !== null) { low = Math.min(low, threshold); high = Math.max(high, threshold); }
  if (high - low < 0.5) { low -= 0.5; high += 0.5; }
  const y = (value: number) => 28 - (value - low) / (high - low) * 26;
  const points = values.map((value, index) => `${(index / (values.length - 1) * 120).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return <svg className="site-spark" viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true">
    {near && threshold !== null && <line x1="0" x2="120" y1={y(threshold)} y2={y(threshold)} className="spark-threshold" />}
    <polyline points={points} className={`spark-line ${tone}`} />
  </svg>;
}

function PointCard({ point, now, sparks, thresholds, onOpen, onDiagnose }: { point: SitePoint; now: number; sparks: Record<Group, Map<string, number[]>> | null; thresholds: Record<Group, number | null>; onOpen: () => void; onDiagnose?: () => void }) {
  const offline = point.status === "offline";
  const badge = offline ? point.lastReadAt ? `Sin datos · ${since(point.lastReadAt, now).replace(/^hace /, "")}` : "Nunca reportó" : STATUS[point.status].label;
  return <article className={`site-card status-${point.status}`}>
    <button type="button" className="site-card-open" onClick={onOpen} aria-label={`Abrir ${point.name}: ${badge}`} />
    <header>
      <i className={`dot ${offline ? "offline" : point.status}`} />
      <span><strong>{point.name}</strong>{point.deviceCode && <small>{point.deviceCode}</small>}</span>
      <em className={`site-badge ${point.status}`}>{badge}</em>
    </header>
    {offline && <p className="site-card-offline"><span>{point.lastReadAt ? `Sin lecturas desde ${clock(point.lastReadAt, now)}.` : "El equipo aún no envía lecturas."} Revisa la comunicación con el equipo.</span>{onDiagnose && <button type="button" onClick={onDiagnose}>Diagnosticar</button>}</p>}
    <div className="site-card-metrics">
      {GROUPS.map((item) => {
        const cell = point.groups[item.key];
        const tone = offline || cell.value === null ? "muted" : cell.severity;
        return <div key={item.key} className="site-metric">
          <span className="site-metric-label">{item.name}</span>
          <span className={`site-metric-value ${tone}`}>{offline || cell.value === null ? "—" : number(cell.value, item.key === "temperature" ? 1 : 0)}<small>{offline || cell.value === null ? "" : cell.unit === "%RH" ? "%" : cell.unit ?? ""}</small></span>
          <Sparkline values={sparks?.[item.key].get(point.id) ?? []} threshold={thresholds[item.key]} tone={tone} />
          <span className="site-metric-note">{!offline && cell.channelCode ? [cell.channelCode, cell.channelName].filter(Boolean).join(" ") : "Sin lectura vigente"}</span>
        </div>;
      })}
    </div>
    <footer>
      <span>{offline ? point.lastReadAt ? `Última lectura ${clock(point.lastReadAt, now)}` : "Sin lecturas" : `Última lectura ${since(point.lastReadAt, now)}`}</span>
      <span className={point.openAlarms ? `alarms ${point.alarmSeverity ?? "warning"}` : "alarms none"}>{point.openAlarms ? `${point.openAlarms} ${point.openAlarms === 1 ? "alarma abierta" : "alarmas abiertas"}` : "Sin alarmas"}</span>
    </footer>
  </article>;
}

function niceStep(raw: number) {
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

/** Marcas de tiempo en horas o días redondos (00:00, 04:00… o un día por marca). */
function timeTicks(from: number, to: number, hours: number) {
  const stepMs = (hours <= 24 ? 4 : hours <= 168 ? 24 : 120) * 3_600_000;
  const first = new Date(from);
  if (hours <= 24) first.setMinutes(0, 0, 0); else first.setHours(0, 0, 0, 0);
  let tick = first.getTime();
  while (tick < from) tick += hours <= 24 ? 3_600_000 : 86_400_000;
  if (hours <= 24) while (new Date(tick).getHours() % 4 !== 0) tick += 3_600_000;
  const ticks: number[] = [];
  for (; tick <= to; tick += stepMs) ticks.push(tick);
  return ticks;
}

function CompareChart({ trend }: { trend: Trend }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 760, height = 260, left = 52, right = 14, top = 12, bottom = 28;
  const from = new Date(trend.from).getTime(), to = new Date(trend.to).getTime();
  const unit = trend.unit === "%RH" ? "%" : trend.unit ?? "";
  const lines = trend.points.map((point, index) => ({ ...point, style: SERIES[index % SERIES.length], values: point.series.map(([iso, value]) => [new Date(iso).getTime(), value] as [number, number]) }));
  const all = lines.flatMap((line) => line.values.map(([, value]) => value));
  // La escala sigue a los datos. El umbral se dibuja solo si queda cerca; si no, se indica en la leyenda
  // (antes estiraba la escala y aplastaba las líneas contra el borde).
  const threshold = trend.warningThreshold;
  let low = all.length ? Math.min(...all) : 0, high = all.length ? Math.max(...all) : 1;
  if (high - low < 1) { low -= 1; high += 1; }
  const reference = threshold !== null && threshold >= low - (high - low) * 0.6 && threshold <= high + (high - low) * 0.6 ? threshold : null;
  if (reference !== null) { low = Math.min(low, reference); high = Math.max(high, reference); }
  const step = niceStep((high - low) / 4);
  const min = Math.floor(low / step) * step, max = Math.ceil(high / step) * step;
  const x = (time: number) => left + (time - from) / Math.max(1, to - from) * (width - left - right);
  const y = (value: number) => top + (max - value) / Math.max(1e-9, max - min) * (height - top - bottom);
  const gap = trend.bucketSeconds * 1000 * 2.5;
  const path = (values: Array<[number, number]>) => values.map(([time, value], index) => `${index === 0 || time - values[index - 1][0] > gap ? "M" : "L"}${x(time).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const ticksY = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => min + step * index);
  const ticksX = timeTicks(from, to, trend.hours);
  const timeLabel = (time: number) => new Intl.DateTimeFormat("es-CL", trend.hours <= 24 ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" }).format(time);
  const hasData = all.length > 0;

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = (event.clientX - box.left) / box.width * width;
    if (px < left || px > width - right) { setHover(null); return; }
    setHover(from + (px - left) / (width - left - right) * (to - from));
  };
  const nearest = (values: Array<[number, number]>, time: number) => {
    let best: [number, number] | null = null;
    for (const entry of values) if (!best || Math.abs(entry[0] - time) < Math.abs(best[0] - time)) best = entry;
    return best && Math.abs(best[0] - time) <= trend.bucketSeconds * 1000 ? best : null;
  };

  return <div className="site-compare-chart">
    {hasData && <ul className="site-compare-legend">
      {lines.filter((line) => line.values.length).map((line) => <li key={line.id}><svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" stroke={line.style.color} strokeWidth="2.5" strokeDasharray={line.style.dash} strokeLinecap="round" /></svg>{line.name}</li>)}
      {threshold !== null && <li className="threshold"><svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" stroke="#b45309" strokeWidth="1.2" strokeDasharray="4 3" /></svg>Advertencia {number(threshold)} {unit}{reference === null ? " (fuera de escala)" : ""}</li>}
      {lines.some((line) => !line.values.length) && <li className="muted">Sin datos en el periodo: {lines.filter((line) => !line.values.length).map((line) => line.name).join(", ")}</li>}
    </ul>}
    {!hasData ? <p className="site-points-empty">Sin datos en este periodo. Los resúmenes se generan cada 5 minutos a partir de las lecturas.</p> :
      <div className="site-compare-canvas">
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Comparación de ${GROUPS.find((item) => item.key === trend.group)?.label ?? ""} entre ${lines.length} puntos`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticksY.map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="grid" /><text x={left - 8} y={y(tick) + 4} textAnchor="end" className="axis">{number(tick, 0)}</text></g>)}
          {ticksX.map((tick) => <text key={tick} x={x(tick)} y={height - 8} textAnchor="middle" className="axis">{timeLabel(tick)}</text>)}
          {reference !== null && <line x1={left} x2={width - right} y1={y(reference)} y2={y(reference)} stroke="#b45309" strokeWidth="1.2" strokeDasharray="5 4" />}
          {lines.map((line) => <path key={line.id} d={path(line.values)} fill="none" stroke={line.style.color} strokeWidth="2" strokeDasharray={line.style.dash} strokeLinejoin="round" strokeLinecap="round" />)}
          {lines.map((line) => line.values.map(([time, value], index) => {
            // Un valor aislado (sin vecinos en el periodo) no forma línea: se marca con un punto.
            const alone = (index === 0 || time - line.values[index - 1][0] > gap) && (index === line.values.length - 1 || line.values[index + 1][0] - time > gap);
            return alone ? <circle key={`${line.id}-${time}`} cx={x(time)} cy={y(value)} r="3" fill={line.style.color} /> : null;
          }))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={height - bottom} className="crosshair" />}
          {hover !== null && lines.map((line) => { const point = nearest(line.values, hover); return point ? <circle key={line.id} cx={x(point[0])} cy={y(point[1])} r="4" fill={line.style.color} stroke="white" strokeWidth="2" /> : null; })}
        </svg>
        {hover !== null && <div className="site-compare-tooltip" style={{ left: `${Math.min(78, Math.max(4, (x(hover) / width) * 100))}%` }}>
          <strong>{new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(hover)}</strong>
          {lines.map((line) => { const point = nearest(line.values, hover); return <span key={line.id}><i style={{ background: line.style.color }} />{line.name}<b>{point ? `${number(point[1])} ${unit}` : "—"}</b></span>; })}
        </div>}
      </div>}
  </div>;
}

const ATTENTION_REASON: Record<AttentionItem["reason"], string> = { out_of_range: "Fuera de rango", alarm: "Con alarma", offline: "Sin datos" };

/** Solo las excepciones del sitio; si no hay ninguna, una línea que confirma que todo está en orden. */
function AttentionPanel({ siteName, items, systems, systemName, onOpenPoint }: { siteName: string; items: AttentionItem[]; systems: SystemSummary[]; systemName: (system: System) => string; onOpenPoint: (pointId: string) => void }) {
  const total = systems.reduce((sum, system) => sum + system.points, 0);
  if (!items.length) {
    return <section className="site-attention ok" aria-label={`Estado de ${siteName}`}><IconCircleCheck size={18} aria-hidden="true" /><span><strong>Todo en orden</strong> · {total} {total === 1 ? "punto" : "puntos"} en {systems.map((system) => system.name.toLowerCase()).join(", ")}</span></section>;
  }
  return <section className="site-attention" aria-label={`Requiere atención en ${siteName}`}>
    <header><IconAlertTriangle size={17} aria-hidden="true" /><h2>Requiere atención</h2><span>{items.length}</span></header>
    <ul>{items.map((item) => <li key={`${item.pointId}:${item.reason}`}>
      <button type="button" onClick={() => onOpenPoint(item.pointId)}>
        <i className={`dot ${item.severity}`} />
        <span className="site-attention-what"><strong>{item.pointName}</strong><small>{systemName(item.system)} · {ATTENTION_REASON[item.reason]}</small></span>
        <span className={`site-attention-detail ${item.severity}`}>{item.detail}</span>
        <IconChevronRight size={16} aria-hidden="true" />
      </button>
    </li>)}</ul>
  </section>;
}

const CONDITION_BADGE: Record<Condition["status"], { label: string; tone: string }> = {
  in_range: { label: "En rango", tone: "normal" },
  out_of_range: { label: "Fuera de rango", tone: "warning" },
  no_range: { label: "Normal", tone: "normal" },
  no_data: { label: "Sin lectura", tone: "offline" },
};
const AGGREGATION_NOTE: Record<string, string> = { max: "peor de", min: "mínimo de", avg: "promedio de", sum: "suma de", last: "último de" };

function rangeText(condition: Condition) {
  const unit = condition.unit ?? "";
  const fmt = (value: number) => number(value, condition.decimals);
  if (condition.rangeMin !== null && condition.rangeMax !== null) return `rango ${fmt(condition.rangeMin)} a ${fmt(condition.rangeMax)} ${unit}`;
  if (condition.rangeMax !== null) return `máx. ${fmt(condition.rangeMax)} ${unit}`;
  if (condition.rangeMin !== null) return `mín. ${fmt(condition.rangeMin)} ${unit}`;
  return null;
}

/** Tarjeta compacta de un punto de frío, energía o respaldo: un valor principal y lo que lo explica. */
function SystemPointCard({ point, now, onOpen }: { point: SitePoint; now: number; onOpen: () => void }) {
  const condition = point.condition;
  const offline = point.status === "offline";
  const badge = offline ? { label: point.lastReadAt ? "Sin datos" : "Nunca reportó", tone: "offline" } : point.status === "critical" ? { label: "Alarma crítica", tone: "critical" } : condition ? CONDITION_BADGE[condition.status] : { label: "Normal", tone: "normal" };
  const valueTone = offline || !condition || condition.value === null ? "muted" : point.status === "critical" ? "critical" : condition.status === "out_of_range" ? "warning" : "";
  const sensorsNote = condition && condition.sensors > 0 ? `${condition.sensors > 1 ? `${AGGREGATION_NOTE[condition.aggregation] ?? "de"} ${condition.sensors} sensores` : "1 sensor"}${condition.decisivePosition && condition.sensors > 1 ? ` · ${condition.decisivePosition}` : ""}` : "Sin sensores asignados";
  return <article className={`sys-card status-${point.status}`}>
    <button type="button" className="site-card-open" onClick={onOpen} aria-label={`Abrir ${point.name}: ${badge.label}`} />
    <header>
      <span><strong>{point.name}</strong><small>{[point.typeName, point.area].filter(Boolean).join(" · ")}</small></span>
      <em className={`site-badge ${badge.tone}`}>{badge.label}</em>
    </header>
    <div className={`sys-card-value ${valueTone}`}>{condition && condition.value !== null && !offline ? number(condition.value, condition.decimals) : "—"}<small>{condition?.unit ?? ""}</small></div>
    <p className="sys-card-note"><span>{sensorsNote}</span>{condition && rangeText(condition) && <span>{rangeText(condition)}</span>}</p>
    <footer>
      <span>{condition?.secondary ? `${condition.secondary.name} ${number(condition.secondary.value, condition.secondary.decimals)} ${condition.secondary.unit === "%RH" ? "%" : condition.secondary.unit}` : `Última lectura ${since(point.lastReadAt, now)}`}</span>
      {condition && condition.sensors > 0 && condition.reporting < condition.sensors
        ? <span className="alarms warning">{condition.reporting}/{condition.sensors} sensores reportan</span>
        : <span className={point.openAlarms ? `alarms ${point.alarmSeverity ?? "warning"}` : "alarms none"}>{point.openAlarms ? `${point.openAlarms} ${point.openAlarms === 1 ? "alarma" : "alarmas"}` : "Sin alarmas"}</span>}
    </footer>
  </article>;
}

const HEALTH_ICON = { sensor_stale: IconPlugConnectedX, battery_low: IconBattery2, weak_signal: IconWifi1, gateway_offline: IconRouterOff } as const;

/** Mantenimiento de la instrumentación: sensores sin reportar, baterías bajas, señal débil y gateways caídos. */
function HealthPanel({ issues, onOpenPoint, onDiagnose }: { issues: HealthIssue[]; onOpenPoint: (pointId: string) => void; onDiagnose?: () => void }) {
  if (!issues.length) return <p className="site-health-ok"><IconCircleCheck size={15} aria-hidden="true" /> Sensores y gateways sin observaciones.</p>;
  return <section className="panel site-health" aria-label="Salud de sensores">
    <header><h2>Salud de sensores</h2><span>{issues.length} {issues.length === 1 ? "observación" : "observaciones"}</span></header>
    <ul>{issues.map((issue, index) => {
      const Icon = HEALTH_ICON[issue.kind];
      return <li key={`${issue.kind}:${issue.deviceName}:${index}`}>
        <Icon size={16} className={issue.severity} aria-hidden="true" />
        <span><strong>{issue.detail}</strong><small>{[issue.pointName, issue.position, issue.deviceName].filter(Boolean).join(" · ")}</small></span>
        {issue.pointId ? <button type="button" className="site-link" onClick={() => onOpenPoint(issue.pointId!)}>Ver punto</button> : onDiagnose ? <button type="button" className="site-link" onClick={onDiagnose}>Diagnosticar</button> : <span />}
      </li>;
    })}</ul>
  </section>;
}

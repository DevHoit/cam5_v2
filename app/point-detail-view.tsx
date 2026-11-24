"use client";

import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { IconAlertTriangle, IconBattery2, IconCircleCheck, IconRefresh, IconSettings, IconWifi1 } from "@tabler/icons-react";
import { pollWhileVisible } from "./poll-while-visible";

type Config = { rangeMin: number | null; rangeMax: number | null; toleranceMinutes: number; aggregation: string };
type Excursion = { start: string; end: string | null; minutes: number; peak: number; position: string | null };
type SensorChannel = { code: string; name: string; metric: string; role: string; unit: string; decimals: number; value: number | null };
type Sensor = { deviceId: string; code: string; name: string; position: string | null; externalId: string | null; protocol: string; model: string; lastReadAt: string | null; stale: boolean; primary: { value: number | null; unit: string; decimals: number } | null; channels: SensorChannel[] };
type PointAlarm = { id: string; title: string; detail: string | null; severity: string; status: string; kind: string; openedAt: string; resolvedAt: string | null; acknowledgedAt: string | null };
type Detail = {
  serverTime: string;
  point: { id: string; code: string; name: string; area: string | null; typeName: string; system: string; systemName: string; unit: string | null; decimals: number; quantityName: string | null };
  config: Config;
  condition: { status: string; value: number | null; deviation: number | null; position: string | null; sensors: number; reporting: number; outSince: string | null };
  period: { hours: number; bucketSeconds: number; from: string };
  history: { values: Array<number | null>; min: number | null; max: number | null; inRangePct: number | null; excursions: number; outMinutes: number; outSince: string | null; trend: number | null };
  series: Array<{ deviceId: string; position: string; values: Array<number | null> }>;
  excursions: Excursion[];
  sensors: Sensor[];
  alarms: PointAlarm[];
  openAlarms: number;
  electrical: null | { today: { kwh: number | null; peakKw: number | null; peakAt: string | null }; powerFactor: number | null; unbalancePct: number | null };
};

const COLORS = ["#2a78d6", "#7c3aed", "#1baf7a", "#c98500", "#d55181", "#6250d6", "#008300", "#e34948"];
const number = (value: number, digits = 1) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
const fmt = (value: number | null | undefined, digits = 1, unit = "") => value === null || value === undefined ? "—" : `${number(value, digits)}${unit ? ` ${unit}` : ""}`;

function duration(minutes: number) {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = Math.floor(minutes / 60), rest = Math.round(minutes % 60);
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
function clock(iso: string, now: number, withDay = false) {
  const date = new Date(iso);
  const today = new Date(now).toDateString() === date.toDateString();
  const yesterday = new Date(now - 86_400_000).toDateString() === date.toDateString();
  const time = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit" }).format(date);
  if (today && !withDay) return time;
  if (today) return `hoy ${time}`;
  if (yesterday) return `ayer ${time}`;
  return `${new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" }).format(date)} ${time}`;
}
function since(iso: string | null, now: number) {
  if (!iso) return "sin lecturas";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return `hace ${seconds} s`;
  if (seconds < 5400) return `hace ${Math.round(seconds / 60)} min`;
  return `hace ${Math.round(seconds / 3600)} h`;
}
const channelValue = (sensor: Sensor, metric: string) => sensor.channels.find((channel) => channel.metric === metric);

/** Curva del periodo con una línea por sensor, la banda del rango objetivo y lectura de valores al pasar el cursor. */
function DetailChart({ detail, now }: { detail: Detail; now: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const { config, series, period } = detail;
  const size = detail.history.values.length;
  const all = series.flatMap((line) => line.values).filter((value): value is number => value !== null);
  if (all.length < 2) return <div className="detail-chart-empty">Aún no hay suficiente historia para el periodo.</div>;
  const limits = [config.rangeMin, config.rangeMax].filter((value): value is number => value !== null);
  let low = Math.min(...all, ...limits), high = Math.max(...all, ...limits);
  const pad = (high - low || 1) * 0.1;
  low -= pad; high += pad;
  const width = 1000, height = 240;
  const x = (index: number) => (index / Math.max(1, size - 1)) * width;
  const y = (value: number) => height - ((value - low) / (high - low)) * height;
  const outside = (value: number) => (config.rangeMax !== null && value > config.rangeMax) || (config.rangeMin !== null && value < config.rangeMin);
  const ticks = Array.from({ length: 5 }, (_, index) => low + ((high - low) * index) / 4);
  const from = new Date(period.from).getTime();
  const step = period.bucketSeconds * 1000;
  const labels = Array.from({ length: 7 }, (_, index) => Math.round((index / 6) * (size - 1)));
  const unit = detail.point.unit ?? "";
  const decimals = detail.point.decimals;
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(size - 1, Math.round(((event.clientX - box.left) / box.width) * (size - 1)))));
  };
  const path = (values: Array<number | null>, keep: (value: number) => boolean) => {
    let d = "", pen = false;
    values.forEach((value, index) => {
      if (value === null || !keep(value)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  return <div className="detail-chart">
    <div className="detail-chart-y">{ticks.slice().reverse().map((tick) => <span key={tick}>{number(tick, decimals)}</span>)}</div>
    <div className="detail-chart-plot" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Curva de ${detail.point.name} en el periodo`}>
        {ticks.map((tick) => <line key={tick} x1="0" x2={width} y1={y(tick)} y2={y(tick)} className="detail-grid" />)}
        {limits.length > 0 && <rect x="0" width={width} y={config.rangeMax !== null ? y(config.rangeMax) : 0} height={(config.rangeMin !== null ? y(config.rangeMin) : height) - (config.rangeMax !== null ? y(config.rangeMax) : 0)} className="range-band" />}
        {limits.map((limit) => <line key={limit} x1="0" x2={width} y1={y(limit)} y2={y(limit)} className="range-limit" />)}
        {series.map((line, index) => <path key={line.deviceId} d={path(line.values, () => true)} className="detail-line" style={{ stroke: COLORS[index % COLORS.length] }} />)}
        {limits.length > 0 && series.map((line) => <path key={`${line.deviceId}:out`} d={path(line.values, outside)} className="detail-line out" />)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={height} className="detail-cursor" />}
      </svg>
      {hover !== null && <div className={`detail-tooltip ${hover > size * 0.6 ? "left" : ""}`} style={{ left: `${(hover / Math.max(1, size - 1)) * 100}%` }}>
        <strong>{clock(new Date(from + hover * step).toISOString(), now, true)}</strong>
        {series.map((line, index) => { const value = line.values[hover]; return <span key={line.deviceId} className={value !== null && limits.length && outside(value) ? "out" : ""}><i style={{ background: COLORS[index % COLORS.length] }} />{line.position}<b>{fmt(value, decimals, unit)}</b></span>; })}
      </div>}
      <div className="detail-chart-x">{labels.map((index) => <span key={index}>{index === size - 1 ? "ahora" : clock(new Date(from + index * step).toISOString(), now, period.hours > 24)}</span>)}</div>
    </div>
  </div>;
}

/**
 * Detalle de un punto de frío, energía o respaldo para mantenimiento: cómo está ahora, cómo estuvo en
 * el periodo, cada excursión con su hora y duración, el estado de cada sensor y las alarmas del punto.
 */
export function PointDetailView({ assetId, onOpenAlarms, onOpenSettings }: { assetId: string; onOpenAlarms?: () => void; onOpenSettings?: () => void }) {
  const [hours, setHours] = useState<24 | 168>(24);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!assetId) return;
    let active = true;
    const load = () => fetch(`/api/v1/point-detail?assetId=${encodeURIComponent(assetId)}&hours=${hours}`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as (Detail & { error?: string }) | null;
        if (!response.ok || !payload) throw new Error(payload?.error ?? "No fue posible cargar el detalle del punto.");
        if (active) { setDetail(payload); setError(""); }
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible cargar el detalle del punto."); });
    void load();
    const stop = pollWhileVisible(() => void load(), 30_000);
    return () => { active = false; stop(); };
  }, [assetId, hours]);

  const now = detail ? new Date(detail.serverTime).getTime() : 0;
  const isCold = detail?.point.system === "cold";
  const latestBySensor = useMemo(() => new Map((detail?.series ?? []).map((line, index) => [line.deviceId, COLORS[index % COLORS.length]])), [detail]);

  if (!detail) {
    return error
      ? <article className="panel site-overview-message"><IconAlertTriangle size={20} /><div><strong>No se pudo cargar el detalle</strong><p>{error}</p></div></article>
      : <article className="panel site-overview-message"><IconRefresh className="spin" size={20} /> Cargando el detalle del punto…</article>;
  }
  const { point, config, condition, history } = detail;
  const unit = point.unit ?? "";
  const hasRange = config.rangeMin !== null || config.rangeMax !== null;
  const rangeLabel = config.rangeMin !== null && config.rangeMax !== null ? `${number(config.rangeMin, point.decimals)} a ${number(config.rangeMax, point.decimals)} ${unit}` : config.rangeMax !== null ? `máx. ${number(config.rangeMax, point.decimals)} ${unit}` : config.rangeMin !== null ? `mín. ${number(config.rangeMin, point.decimals)} ${unit}` : "Sin rango";
  const out = condition.status === "out_of_range";
  const outFor = condition.outSince ? (now - new Date(condition.outSince).getTime()) / 60000 : null;
  const periodLabel = detail.period.hours === 24 ? "24 h" : "7 días";

  return <div className="point-detail">
    {error && <p className="site-points-stale"><IconAlertTriangle size={14} /> {error} Se muestran los últimos datos recibidos.</p>}

    {detail.electrical ? <section className="detail-kpis">
      <article>
        <small>Potencia ahora</small>
        <strong>{fmt(condition.value, 1)}<em>kW</em></strong>
        <span>{history.trend === null || Math.abs(history.trend) < 1 ? "Estable en los últimos 15 min" : `${history.trend > 0 ? "Subiendo" : "Bajando"} ${number(Math.abs(history.trend), 1)} kW en 15 min`} · {condition.reporting}/{condition.sensors} {condition.sensors === 1 ? "equipo" : "equipos"}</span>
      </article>
      <article>
        <small>Demanda máxima hoy</small>
        <strong>{fmt(detail.electrical.today.peakKw, 1)}<em>kW</em></strong>
        <span>{detail.electrical.today.peakAt ? `a las ${clock(detail.electrical.today.peakAt, now)} · promedio de 5 min` : "Sin registro hoy"}</span>
      </article>
      <article>
        <small>Energía hoy</small>
        <strong>{fmt(detail.electrical.today.kwh, 0)}<em>kWh</em></strong>
        <span>Desde la medianoche</span>
      </article>
      <article className={(detail.electrical.powerFactor ?? 1) < 0.93 || (detail.electrical.unbalancePct ?? 0) > 10 ? "warning" : ""}>
        <small>Calidad de la energía</small>
        <strong className="small">FP {fmt(detail.electrical.powerFactor, 2)}</strong>
        <span>{(detail.electrical.powerFactor ?? 1) < 0.93 ? "Bajo 0,93: riesgo de recargo · " : ""}Desbalance {fmt(detail.electrical.unbalancePct, 1, "%")}</span>
      </article>
    </section> : <section className="detail-kpis">
      <article className={out ? "warning" : ""}>
        <small>{condition.sensors > 1 ? "Ahora · peor sensor" : "Ahora"}</small>
        <strong className={out ? "warning" : ""}>{fmt(condition.value, point.decimals)}<em>{unit}</em></strong>
        <span>{out ? `${condition.position ? `${condition.position} · ` : ""}fuera de rango${outFor !== null ? ` hace ${duration(outFor)}` : ""}` : hasRange ? `En rango · ${condition.reporting}/${condition.sensors} sensores reportan` : `${condition.reporting}/${condition.sensors} equipos reportan`}</span>
      </article>
      {hasRange && <article className={history.inRangePct !== null && history.inRangePct < 99 ? "warning" : ""}>
        <small>En rango · {periodLabel}</small>
        <strong>{history.inRangePct === null ? "—" : number(history.inRangePct, history.inRangePct % 1 ? 1 : 0)}<em>%</em></strong>
        <span>{history.excursions ? `${history.excursions} ${history.excursions === 1 ? "excursión" : "excursiones"} · ${duration(history.outMinutes)} fuera` : "Sin excursiones"}</span>
      </article>}
      <article>
        <small>Mín / máx · {periodLabel}</small>
        <strong>{fmt(history.min, point.decimals)} / {fmt(history.max, point.decimals)}<em>{unit}</em></strong>
        <span>{history.trend === null ? "Sin tendencia" : Math.abs(history.trend) < 0.2 ? "Estable en los últimos 15 min" : `${history.trend > 0 ? "Subiendo" : "Bajando"} ${number(Math.abs(history.trend), point.decimals)} ${unit} en 15 min`}</span>
      </article>
      <article>
        <small>Rango objetivo</small>
        <strong className="small">{rangeLabel}</strong>
        <span>{hasRange ? `Alarma tras ${config.toleranceMinutes} min fuera de rango` : point.typeName}{onOpenSettings && <button type="button" className="site-link" onClick={onOpenSettings}><IconSettings size={13} /> Ajustar</button>}</span>
      </article>
    </section>}

    <article className="panel detail-panel">
      <header>
        <h2>{point.quantityName ?? "Medición"} · {condition.sensors} {isCold ? (condition.sensors === 1 ? "sensor" : "sensores") : (condition.sensors === 1 ? "equipo" : "equipos")}</h2>
        <div className="site-compare-controls"><div role="radiogroup" aria-label="Periodo">
          {([24, 168] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={hours === value} className={hours === value ? "active" : ""} onClick={() => setHours(value)}>{value === 24 ? "24 h" : "7 días"}</button>)}
        </div></div>
      </header>
      <div className="detail-legend">
        {detail.series.map((line, index) => { const sensor = detail.sensors.find((item) => item.deviceId === line.deviceId); return <span key={line.deviceId}><i style={{ background: COLORS[index % COLORS.length] }} />{line.position}<b>{sensor?.primary ? fmt(sensor.primary.value, sensor.primary.decimals, sensor.primary.unit) : "—"}</b></span>; })}
        {hasRange && <span className="band"><i />Rango {rangeLabel}</span>}
      </div>
      <DetailChart detail={detail} now={now} />
    </article>

    <div className="detail-columns">
      {hasRange && <article className="panel detail-panel">
        <header><h2>Excursiones · {periodLabel}</h2><span className="detail-count">{detail.excursions.length}</span></header>
        {detail.excursions.length === 0 ? <p className="detail-empty"><IconCircleCheck size={16} /> Se mantuvo en rango todo el periodo.</p> : <table className="detail-table">
          <thead><tr><th>Inicio</th><th>Duración</th><th>Valor extremo</th><th>Sensor</th><th>Estado</th></tr></thead>
          <tbody>{detail.excursions.map((excursion) => <tr key={excursion.start} className={excursion.end ? "" : "ongoing"}>
            <td>{clock(excursion.start, now, true)}</td>
            <td>{duration(excursion.minutes)}</td>
            <td className="warning">{fmt(excursion.peak, point.decimals, unit)}</td>
            <td>{excursion.position ?? "—"}</td>
            <td>{excursion.end ? <span className="detail-pill ok">Recuperada {clock(excursion.end, now)}</span> : <span className="detail-pill warning">En curso</span>}</td>
          </tr>)}</tbody>
        </table>}
      </article>}

      <article className="panel detail-panel">
        <header><h2>{isCold ? "Sensores" : "Equipos"}</h2><span className="detail-count">{detail.sensors.length}</span></header>
        <table className="detail-table">
          <thead><tr>{isCold
            ? <><th>Posición</th><th>{point.quantityName ?? "Valor"}</th><th>Humedad</th><th>Batería</th><th>Señal</th><th>Última lectura</th></>
            : <><th>Equipo</th><th>Potencia</th><th>Corriente L1 / L2 / L3</th><th>FP</th><th>Voltaje</th><th>Energía</th><th>Última lectura</th></>}</tr></thead>
          <tbody>{detail.sensors.map((sensor) => {
            const value = sensor.primary?.value ?? null;
            const outside = value !== null && ((config.rangeMax !== null && value > config.rangeMax) || (config.rangeMin !== null && value < config.rangeMin));
            const battery = channelValue(sensor, "battery"), volts = channelValue(sensor, "battery_voltage"), signal = channelValue(sensor, "signal_strength");
            const lowBattery = (battery?.value !== null && battery?.value !== undefined && battery.value < 20) || (volts?.value !== null && volts?.value !== undefined && volts.value < 2.5);
            const weak = signal?.value !== null && signal?.value !== undefined && signal.value < -90;
            const voltages = sensor.channels.filter((channel) => channel.metric === "voltage" && channel.value !== null).map((channel) => channel.value!);
            return <tr key={sensor.deviceId} className={sensor.stale ? "stale" : ""}>
              <td><span className="detail-sensor"><i style={{ background: latestBySensor.get(sensor.deviceId) ?? "var(--muted-2)" }} /><span><strong>{sensor.position ?? sensor.name}</strong><small>{sensor.externalId ?? sensor.code}</small></span></span></td>
              {isCold ? <>
                <td className={outside ? "warning" : ""}>{fmt(value, sensor.primary?.decimals ?? 1, sensor.primary?.unit)}</td>
                <td>{fmt(channelValue(sensor, "humidity")?.value, 0, "%")}</td>
                <td className={lowBattery ? "warning" : ""}>{battery?.value !== null && battery?.value !== undefined ? `${number(battery.value, 0)} %` : fmt(volts?.value, 2, "V")}{lowBattery && <IconBattery2 size={13} />}</td>
                <td className={weak ? "warning" : ""}>{fmt(signal?.value, 0, "dBm")}{weak && <IconWifi1 size={13} />}</td>
              </> : <>
                <td>{fmt(value, 1, "kW")}</td>
                <td>{sensor.channels.filter((channel) => channel.metric === "current").map((channel) => channel.value === null ? "—" : number(channel.value, 0)).join(" / ") || "—"} A</td>
                <td className={(channelValue(sensor, "power_factor")?.value ?? 1) < 0.93 ? "warning" : ""}>{fmt(channelValue(sensor, "power_factor")?.value, 2)}</td>
                <td>{voltages.length ? `${number(voltages.reduce((total, item) => total + item, 0) / voltages.length, 0)} V` : "—"}</td>
                <td>{fmt(channelValue(sensor, "energy")?.value, 0, "kWh")}</td>
              </>}
              <td className={sensor.stale ? "warning" : ""}>{sensor.stale ? "Sin reportar · " : ""}{since(sensor.lastReadAt, now)}</td>
            </tr>;
          })}</tbody>
        </table>
      </article>
    </div>

    <article className="panel detail-panel">
      <header><h2>Alarmas · 7 días</h2>{onOpenAlarms && <button type="button" className="site-link" onClick={onOpenAlarms}>Ver todas las alarmas</button>}</header>
      {detail.alarms.length === 0 ? <p className="detail-empty"><IconCircleCheck size={16} /> Sin alarmas en los últimos 7 días.</p> : <ul className="detail-alarms">{detail.alarms.map((alarm) => <li key={alarm.id}>
        <i className={`dot ${alarm.status === "resolved" || alarm.status === "closed" ? "normal" : alarm.severity === "critical" ? "critical" : "warning"}`} />
        <span><strong>{alarm.title}</strong><small>{alarm.detail}</small></span>
        <span className="detail-alarm-state">{alarm.status === "resolved" || alarm.status === "closed" ? `Resuelta ${alarm.resolvedAt ? clock(alarm.resolvedAt, now, true) : ""}` : alarm.status === "acknowledged" ? "Reconocida" : "Abierta"}<small>{clock(alarm.openedAt, now, true)}</small></span>
      </li>)}</ul>}
    </article>
  </div>;
}

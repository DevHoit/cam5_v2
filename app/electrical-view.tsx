"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconBolt as Bolt,
  IconCpu as Cpu,
  IconPlus as Plus,
  IconRefresh as Refresh,
  IconSettings as Settings,
  IconX as X,
} from "@tabler/icons-react";

type Metric = {
  key: string;
  name: string;
  unit: string;
  value: number | null;
  quality: string;
  recordedAt: string | null;
};

type Meter = {
  id: string;
  code: string;
  name: string;
  state: string;
  unitId: number | null;
  gateway: { id: string; code: string; name: string; state: string } | null;
  acquisition: Record<string, unknown>;
  lastReadingAt: string | null;
  online: boolean;
  metrics: Metric[];
};

type ElectricalPoint = {
  id: string;
  code: string;
  name: string;
  area: string | null;
  state: string;
  nominalVoltageKv: number | null;
  meters: Meter[];
};

type OverviewResponse = {
  schemaVersion: "2.0";
  serverTime: string;
  points: ElectricalPoint[];
};

type ConfigurationResponse = {
  points: Array<{ id: string; code: string; name: string }>;
  gateways: Array<{ id: string; code: string; name: string; state: string }>;
  meters: Array<{ id: string; assetId: string; code: string; name: string; unitId: number | null; gatewayId: string | null }>;
};

function metric(meter: Meter, key: string) {
  return meter.metrics.find((item) => item.key === key) ?? null;
}

function value(item: Metric | null, digits = 1) {
  if (!item || item.value === null) return "—";
  return item.value.toFixed(digits) + (item.unit ? " " + item.unit : "");
}

function age(iso: string | null) {
  if (!iso) return "Sin lectura";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "Hace " + seconds + " s";
  if (seconds < 3600) return "Hace " + Math.floor(seconds / 60) + " min";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(payload?.error || "No fue posible completar la operación.");
  return payload as T;
}

export function ElectricalView({
  canWriteAssets = false,
  canWriteSettings = false,
}: {
  canWriteAssets?: boolean;
  canWriteSettings?: boolean;
}) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [configuration, setConfiguration] = useState<ConfigurationResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [dialog, setDialog] = useState<"point" | "meter" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pointForm, setPointForm] = useState({ code: "", name: "", area: "", nominalVoltageKv: "0.4" });
  const [meterForm, setMeterForm] = useState({
    pointId: "",
    gatewayId: "",
    code: "PM5560-01",
    name: "Schneider PM5560",
    unitId: "1",
    baudRate: "19200",
    parity: "even",
    pollIntervalMs: "1000",
  });

  const refresh = async () => {
    try {
      const [live, config] = await Promise.all([
        json<OverviewResponse>("/api/v1/electrical/overview"),
        json<ConfigurationResponse>("/api/v1/electrical/configuration"),
      ]);
      setOverview(live);
      setConfiguration(config);
      setMeterForm((current) => ({
        ...current,
        pointId: current.pointId || config.points[0]?.id || "",
        gatewayId: current.gatewayId || config.gateways[0]?.id || "",
      }));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [live, config] = await Promise.all([
          json<OverviewResponse>("/api/v1/electrical/overview"),
          json<ConfigurationResponse>("/api/v1/electrical/configuration"),
        ]);
        if (!active) return;
        setOverview(live);
        setConfiguration(config);
        setMeterForm((current) => ({
          ...current,
          pointId: current.pointId || config.points[0]?.id || "",
          gatewayId: current.gatewayId || config.gateways[0]?.id || "",
        }));
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const meters = useMemo(() => overview?.points.flatMap((point) => point.meters) ?? [], [overview]);
  const onlineMeters = meters.filter((item) => item.online).length;

  const createPoint = async () => {
    setBusy(true);
    setError("");
    try {
      await json("/api/v1/electrical/configuration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_point",
          code: pointForm.code,
          name: pointForm.name,
          area: pointForm.area,
          nominalVoltageKv: pointForm.nominalVoltageKv ? Number(pointForm.nominalVoltageKv) : null,
        }),
      });
      setPointForm({ code: "", name: "", area: "", nominalVoltageKv: "0.4" });
      setDialog(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible crear el punto.");
    } finally {
      setBusy(false);
    }
  };

  const createMeter = async () => {
    setBusy(true);
    setError("");
    try {
      await json("/api/v1/electrical/configuration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_pm5560",
          pointId: meterForm.pointId,
          gatewayId: meterForm.gatewayId,
          code: meterForm.code,
          name: meterForm.name,
          unitId: Number(meterForm.unitId),
          baudRate: Number(meterForm.baudRate),
          parity: meterForm.parity,
          pollIntervalMs: Number(meterForm.pollIntervalMs),
        }),
      });
      setDialog(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible crear el medidor.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="electrical-view">
    <section className="electrical-toolbar">
      <div>
        <span className="eyebrow"><Bolt size={13} /> PowerLogic PM5560</span>
        <h2>Monitoreo eléctrico</h2>
        <p>Telemetría normalizada de medidores trifásicos. La adquisición física RS485 permanece desacoplada del portal.</p>
      </div>
      <div className="electrical-actions">
        <button className="secondary-button" onClick={() => void refresh()}><Refresh size={15} /> Actualizar</button>
        {canWriteAssets && <button className="secondary-button" onClick={() => { setError(""); setDialog("point"); }}><Plus size={15} /> Punto eléctrico</button>}
        {canWriteSettings && <button className="primary-button" onClick={() => { setError(""); setDialog("meter"); }} disabled={!configuration?.points.length || !configuration?.gateways.length}><Plus size={15} /> PM5560</button>}
      </div>
    </section>

    <section className="electrical-summary">
      <article><span>Puntos eléctricos</span><strong>{overview?.points.length ?? 0}</strong></article>
      <article><span>Medidores PM5560</span><strong>{meters.length}</strong></article>
      <article><span>Con lectura vigente</span><strong>{onlineMeters}/{meters.length}</strong></article>
      <article><span>Actualización</span><strong>{overview ? new Intl.DateTimeFormat("es-CL", { timeStyle: "medium" }).format(new Date(overview.serverTime)) : "—"}</strong></article>
    </section>

    {status === "loading" && <div className="electrical-empty"><Refresh className="spin" size={20} /> Cargando monitoreo eléctrico…</div>}
    {status === "error" && <div className="electrical-empty">No fue posible consultar el monitoreo eléctrico.</div>}
    {status === "ready" && !overview?.points.length && <div className="electrical-empty">Aún no existen puntos eléctricos configurados en este sitio.</div>}

    <div className="electrical-points">
      {overview?.points.map((point) => <section className="electrical-point" key={point.id}>
        <header>
          <div><span>{point.code}</span><h3>{point.name}</h3><p>{point.area || "Sin área"}{point.nominalVoltageKv ? " · " + point.nominalVoltageKv + " kV nominal" : ""}</p></div>
          <b className={"electrical-state electrical-state-" + point.state}>{point.state}</b>
        </header>

        {!point.meters.length && <div className="electrical-empty compact">Sin PM5560 asociado.</div>}
        {point.meters.map((meter) => <article className="pm-meter-card" key={meter.id}>
          <div className="pm-meter-heading">
            <div className="pm-meter-icon"><Cpu size={20} /></div>
            <div><span>{meter.code}</span><h4>{meter.name}</h4><p>{meter.gateway ? meter.gateway.code + " · RS485 · ID " + (meter.unitId ?? "—") : "Sin gateway asociado"}</p></div>
            <div className={meter.online ? "pm-online" : "pm-offline"}>{meter.online ? "Telemetría vigente" : "Sin telemetría vigente"}<small>{age(meter.lastReadingAt)}</small></div>
          </div>

          <div className="pm-phase-grid">
            {(["l1", "l2", "l3"] as const).map((phase) => <div key={phase}>
              <strong>{phase.toUpperCase()}</strong>
              <span>{value(metric(meter, "electrical.voltage." + phase + "_n"), 1)}</span>
              <small>{value(metric(meter, "electrical.current." + phase), 1)}</small>
            </div>)}
          </div>

          <div className="pm-kpis">
            <div><span>Potencia activa</span><strong>{value(metric(meter, "electrical.power.active.total"), 1)}</strong></div>
            <div><span>Potencia aparente</span><strong>{value(metric(meter, "electrical.power.apparent.total"), 1)}</strong></div>
            <div><span>Reactiva</span><strong>{value(metric(meter, "electrical.power.reactive.total"), 1)}</strong></div>
            <div><span>Factor potencia</span><strong>{value(metric(meter, "electrical.power_factor"), 3)}</strong></div>
            <div><span>Frecuencia</span><strong>{value(metric(meter, "electrical.frequency"), 2)}</strong></div>
            <div><span>Demanda</span><strong>{value(metric(meter, "electrical.demand.active"), 1)}</strong></div>
            <div><span>Energía importada</span><strong>{value(metric(meter, "electrical.energy.import"), 1)}</strong></div>
          </div>
        </article>)}
      </section>)}
    </div>

    {dialog && <div className="cold-config-backdrop" role="presentation">
      <section className="cold-config-dialog electrical-dialog" role="dialog" aria-modal="true">
        <header><div><span><Settings size={16} /></span><div><strong>{dialog === "point" ? "Nuevo punto eléctrico" : "Configurar PM5560"}</strong><small>{dialog === "point" ? "Objeto operacional que será monitoreado." : "Adquisición RS485 en modo sólo lectura."}</small></div></div><button onClick={() => setDialog(null)} aria-label="Cerrar"><X size={18} /></button></header>
        <div className="cold-config-form">
          {dialog === "point" ? <>
            <div className="cold-config-columns">
              <label><span>Código</span><input value={pointForm.code} onChange={(event) => setPointForm({ ...pointForm, code: event.target.value })} placeholder="TAB-01" /></label>
              <label><span>Nombre</span><input value={pointForm.name} onChange={(event) => setPointForm({ ...pointForm, name: event.target.value })} placeholder="Tablero principal" /></label>
            </div>
            <div className="cold-config-columns">
              <label><span>Área</span><input value={pointForm.area} onChange={(event) => setPointForm({ ...pointForm, area: event.target.value })} /></label>
              <label><span>Tensión nominal kV</span><input type="number" step="0.001" min="0" value={pointForm.nominalVoltageKv} onChange={(event) => setPointForm({ ...pointForm, nominalVoltageKv: event.target.value })} /></label>
            </div>
          </> : <>
            <div className="cold-config-columns">
              <label><span>Punto eléctrico</span><select value={meterForm.pointId} onChange={(event) => setMeterForm({ ...meterForm, pointId: event.target.value })}>{configuration?.points.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
              <label><span>Gateway</span><select value={meterForm.gatewayId} onChange={(event) => setMeterForm({ ...meterForm, gatewayId: event.target.value })}>{configuration?.gateways.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
            </div>
            <div className="cold-config-columns">
              <label><span>Código</span><input value={meterForm.code} onChange={(event) => setMeterForm({ ...meterForm, code: event.target.value })} /></label>
              <label><span>Nombre</span><input value={meterForm.name} onChange={(event) => setMeterForm({ ...meterForm, name: event.target.value })} /></label>
            </div>
            <div className="cold-config-columns">
              <label><span>Modbus slave ID</span><input type="number" min="1" max="247" value={meterForm.unitId} onChange={(event) => setMeterForm({ ...meterForm, unitId: event.target.value })} /></label>
              <label><span>Baud rate</span><select value={meterForm.baudRate} onChange={(event) => setMeterForm({ ...meterForm, baudRate: event.target.value })}><option value="9600">9600</option><option value="19200">19200</option><option value="38400">38400</option><option value="57600">57600</option><option value="115200">115200</option></select></label>
            </div>
            <div className="cold-config-columns">
              <label><span>Paridad</span><select value={meterForm.parity} onChange={(event) => setMeterForm({ ...meterForm, parity: event.target.value })}><option value="even">Even</option><option value="none">None</option><option value="odd">Odd</option></select></label>
              <label><span>Polling (ms)</span><input type="number" min="250" value={meterForm.pollIntervalMs} onChange={(event) => setMeterForm({ ...meterForm, pollIntervalMs: event.target.value })} /></label>
            </div>
            <div className="cold-maintenance-note"><strong>V1 sólo lectura</strong><p>HOIT Core almacena parámetros de adquisición. El driver físico y la interpretación del mapa Modbus se implementarán en el gateway.</p></div>
          </>}
          {error && <div className="cold-config-error">{error}</div>}
        </div>
        <footer><button className="secondary-button" onClick={() => setDialog(null)} disabled={busy}>Cancelar</button><button className="primary-button" onClick={() => void (dialog === "point" ? createPoint() : createMeter())} disabled={busy}>{busy ? "Guardando…" : dialog === "point" ? "Crear punto" : "Crear PM5560"}</button></footer>
      </section>
    </div>}
  </div>;
}

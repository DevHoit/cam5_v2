"use client";

import { useEffect, useMemo, useState } from "react";
import { AtsHistoryDialog } from "./ats-history";
import {
  IconArrowsExchange as Transfer,
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
  dataType: string;
  unit: string;
  value: number | boolean | string | null;
  quality: string;
  recordedAt: string | null;
};

type AtsConfig = {
  source1Label: string;
  source2Label: string;
  staleAfterSeconds: number;
  source1Required: boolean;
  source2Required: boolean;
  sourceUnavailableDelaySeconds: number;
  commonAlarmDelaySeconds: number;
  expectedPosition: "source1" | "source2" | null;
  unexpectedPositionDelaySeconds: number;
};

type Controller = {
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

type AtsUnit = {
  id: string;
  code: string;
  name: string;
  area: string | null;
  state: string;
  config: AtsConfig;
  controllers: Controller[];
};

type OverviewResponse = {
  schemaVersion: "2.0";
  serverTime: string;
  units: AtsUnit[];
};

type ConfigurationResponse = {
  units: Array<{ id: string; code: string; name: string; area: string | null; state: string; metadata: Record<string, unknown> }>;
  gateways: Array<{ id: string; code: string; name: string; state: string }>;
  controllers: Array<{ id: string; assetId: string; code: string; name: string; unitId: number | null; gatewayId: string | null; bindingConfig: Record<string, unknown> | null }>;
};

function metric(controller: Controller, key: string) {
  return controller.metrics.find((item) => item.key === key) ?? null;
}

function numberMetric(controller: Controller, key: string) {
  const item = metric(controller, key);
  return item && typeof item.value === "number" ? item.value : null;
}

function boolMetric(controller: Controller, key: string) {
  const item = metric(controller, key);
  return item && typeof item.value === "boolean" ? item.value : null;
}

function textMetric(controller: Controller, key: string) {
  const item = metric(controller, key);
  return item && typeof item.value === "string" ? item.value : null;
}

function formatNumber(value: number | null, unit = "", digits = 1) {
  return value === null ? "—" : value.toFixed(digits) + (unit ? " " + unit : "");
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

export function AtsView({
  canWriteAssets = false,
  canWriteSettings = false,
}: {
  canWriteAssets?: boolean;
  canWriteSettings?: boolean;
}) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [configuration, setConfiguration] = useState<ConfigurationResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [dialog, setDialog] = useState<"unit" | "controller" | "settings" | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<{ assetId: string; controller: Controller } | null>(null);
  const [error, setError] = useState("");
  const [unitForm, setUnitForm] = useState({ code: "", name: "", area: "", source1Label: "Fuente 1", source2Label: "Fuente 2" });
  const [controllerForm, setControllerForm] = useState({
    assetId: "",
    gatewayId: "",
    code: "DSE8660-01",
    name: "DSE8660 MKII",
    busKey: "rs485-1",
    unitId: "1",
    baudRate: "",
    parity: "",
    pollIntervalMs: "1000",
  });
  const [settingsForm, setSettingsForm] = useState({
    assetId: "",
    source1Label: "Fuente 1",
    source2Label: "Fuente 2",
    staleAfterSeconds: "30",
    source1Required: false,
    source2Required: false,
    sourceUnavailableDelaySeconds: "5",
    commonAlarmDelaySeconds: "0",
    expectedPosition: "",
    unexpectedPositionDelaySeconds: "10",
  });

  const refresh = async () => {
    try {
      const [live, config] = await Promise.all([
        json<OverviewResponse>("/api/v1/ats/overview"),
        json<ConfigurationResponse>("/api/v1/ats/configuration"),
      ]);
      setOverview(live);
      setConfiguration(config);
      setControllerForm((current) => ({
        ...current,
        assetId: current.assetId || config.units[0]?.id || "",
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
          json<OverviewResponse>("/api/v1/ats/overview"),
          json<ConfigurationResponse>("/api/v1/ats/configuration"),
        ]);
        if (!active) return;
        setOverview(live);
        setConfiguration(config);
        setControllerForm((current) => ({
          ...current,
          assetId: current.assetId || config.units[0]?.id || "",
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

  const controllers = useMemo(() => overview?.units.flatMap((unit) => unit.controllers) ?? [], [overview]);
  const onlineControllers = controllers.filter((item) => item.online).length;

  const createUnit = async () => {
    setBusy(true); setError("");
    try {
      await json("/api/v1/ats/configuration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_ats", ...unitForm }),
      });
      setUnitForm({ code: "", name: "", area: "", source1Label: "Fuente 1", source2Label: "Fuente 2" });
      setDialog(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible crear el ATS.");
    } finally { setBusy(false); }
  };

  const createController = async () => {
    setBusy(true); setError("");
    try {
      await json("/api/v1/ats/configuration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_dse8660",
          assetId: controllerForm.assetId,
          gatewayId: controllerForm.gatewayId,
          code: controllerForm.code,
          name: controllerForm.name,
          busKey: controllerForm.busKey,
          unitId: Number(controllerForm.unitId),
          baudRate: Number(controllerForm.baudRate),
          parity: controllerForm.parity,
          pollIntervalMs: Number(controllerForm.pollIntervalMs),
        }),
      });
      setDialog(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible crear el controlador.");
    } finally { setBusy(false); }
  };

  const openSettings = (unit: AtsUnit) => {
    setSettingsForm({
      assetId: unit.id,
      source1Label: unit.config.source1Label,
      source2Label: unit.config.source2Label,
      staleAfterSeconds: String(unit.config.staleAfterSeconds),
      source1Required: unit.config.source1Required,
      source2Required: unit.config.source2Required,
      sourceUnavailableDelaySeconds: String(unit.config.sourceUnavailableDelaySeconds),
      commonAlarmDelaySeconds: String(unit.config.commonAlarmDelaySeconds),
      expectedPosition: unit.config.expectedPosition ?? "",
      unexpectedPositionDelaySeconds: String(unit.config.unexpectedPositionDelaySeconds),
    });
    setError("");
    setDialog("settings");
  };

  const saveSettings = async () => {
    setBusy(true); setError("");
    try {
      await json("/api/v1/ats/configuration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: settingsForm.assetId,
          source1Label: settingsForm.source1Label,
          source2Label: settingsForm.source2Label,
          staleAfterSeconds: Number(settingsForm.staleAfterSeconds),
          source1Required: settingsForm.source1Required,
          source2Required: settingsForm.source2Required,
          sourceUnavailableDelaySeconds: Number(settingsForm.sourceUnavailableDelaySeconds),
          commonAlarmDelaySeconds: Number(settingsForm.commonAlarmDelaySeconds),
          expectedPosition: settingsForm.expectedPosition || null,
          unexpectedPositionDelaySeconds: Number(settingsForm.unexpectedPositionDelaySeconds),
        }),
      });
      setDialog(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible guardar la configuración.");
    } finally { setBusy(false); }
  };

  return <div className="ats-view">
    <section className="electrical-toolbar">
      <div>
        <span className="eyebrow"><Transfer size={13} /> Deep Sea Electronics DSE8660 MKII</span>
        <h2>ATS</h2>
        <p>Supervisión de fuentes, transferencia, carga y alarmas. V1 es estrictamente sólo lectura.</p>
      </div>
      <div className="electrical-actions">
        <button className="secondary-button" onClick={() => void refresh()}><Refresh size={15} /> Actualizar</button>
        {canWriteAssets && <button className="secondary-button" onClick={() => { setError(""); setDialog("unit"); }}><Plus size={15} /> ATS</button>}
        {canWriteSettings && <button className="primary-button" onClick={() => { setError(""); setDialog("controller"); }} disabled={!configuration?.units.length || !configuration?.gateways.length}><Plus size={15} /> DSE8660</button>}
      </div>
    </section>

    <section className="electrical-summary">
      <article><span>ATS configurados</span><strong>{overview?.units.length ?? 0}</strong></article>
      <article><span>Controladores DSE8660</span><strong>{controllers.length}</strong></article>
      <article><span>Con lectura vigente</span><strong>{onlineControllers}/{controllers.length}</strong></article>
      <article><span>Actualización</span><strong>{overview ? new Intl.DateTimeFormat("es-CL", { timeStyle: "medium" }).format(new Date(overview.serverTime)) : "—"}</strong></article>
    </section>

    {status === "loading" && <div className="electrical-empty"><Refresh className="spin" size={20} /> Cargando ATS…</div>}
    {status === "error" && <div className="electrical-empty">No fue posible consultar los ATS.</div>}
    {status === "ready" && !overview?.units.length && <div className="electrical-empty">Aún no existen ATS configurados en este sitio.</div>}

    <div className="ats-units">
      {overview?.units.map((unit) => <section className="ats-unit-card" key={unit.id}>
        <header>
          <div><span>{unit.code}</span><h3>{unit.name}</h3><p>{unit.area || "Sin área"}</p></div>
          <div className="electrical-point-actions">
            {canWriteAssets && <button className="secondary-button" onClick={() => openSettings(unit)}><Settings size={14} /> Configurar</button>}
            <b className={"electrical-state electrical-state-" + unit.state}>{unit.state}</b>
          </div>
        </header>

        {!unit.controllers.length && <div className="electrical-empty compact">Sin DSE8660 asociado.</div>}
        {unit.controllers.map((controller) => {
          const source1Available = boolMetric(controller, "ats.source1.available");
          const source2Available = boolMetric(controller, "ats.source2.available");
          const source1Breaker = boolMetric(controller, "ats.breaker.source1_closed");
          const source2Breaker = boolMetric(controller, "ats.breaker.source2_closed");
          const position = textMetric(controller, "ats.transfer.position");
          const mode = textMetric(controller, "dse.mode");
          const commonAlarm = boolMetric(controller, "ats.common_alarm");
          return <article className="ats-controller-card" key={controller.id}>
            <div className="pm-meter-heading">
              <div className="pm-meter-icon"><Cpu size={20} /></div>
              <div><span>{controller.code}</span><h4>{controller.name}</h4><p>{controller.gateway ? controller.gateway.code + " · " + String(controller.acquisition.interfaceKey || "RS485") + " · ID " + (controller.unitId ?? "—") : "Sin gateway asociado"}</p></div>
              <div className="pm-meter-actions">
                <button className="secondary-button" onClick={() => setHistoryTarget({ assetId: unit.id, controller })}>Histórico</button>
                <div className={controller.online ? "pm-online" : "pm-offline"}>{controller.online ? "Telemetría vigente" : "Sin telemetría vigente"}<small>{age(controller.lastReadingAt)}</small></div>
              </div>
            </div>

            <div className="ats-source-grid">
              <article className={source1Available === false ? "source-unavailable" : ""}>
                <header><Bolt size={16} /><strong>{unit.config.source1Label}</strong><b>{source1Available === null ? "Sin dato" : source1Available ? "Disponible" : "No disponible"}</b></header>
                <div><span>L1-N <b>{formatNumber(numberMetric(controller, "ats.source1.voltage.l1_n"), "V")}</b></span><span>L2-N <b>{formatNumber(numberMetric(controller, "ats.source1.voltage.l2_n"), "V")}</b></span><span>L3-N <b>{formatNumber(numberMetric(controller, "ats.source1.voltage.l3_n"), "V")}</b></span></div>
                <footer><span>{formatNumber(numberMetric(controller, "ats.source1.frequency"), "Hz", 2)}</span><span>Interruptor {source1Breaker === null ? "—" : source1Breaker ? "cerrado" : "abierto"}</span></footer>
              </article>
              <div className="ats-transfer-core">
                <Transfer size={26} />
                <small>Posición</small>
                <strong>{position || "—"}</strong>
                <span>Modo {mode || "—"}</span>
                <b className={commonAlarm ? "ats-alarm-active" : ""}>{commonAlarm === null ? "Alarma: sin dato" : commonAlarm ? "ALARMA ACTIVA" : "Sin alarma común"}</b>
              </div>
              <article className={source2Available === false ? "source-unavailable" : ""}>
                <header><Bolt size={16} /><strong>{unit.config.source2Label}</strong><b>{source2Available === null ? "Sin dato" : source2Available ? "Disponible" : "No disponible"}</b></header>
                <div><span>L1-N <b>{formatNumber(numberMetric(controller, "ats.source2.voltage.l1_n"), "V")}</b></span><span>L2-N <b>{formatNumber(numberMetric(controller, "ats.source2.voltage.l2_n"), "V")}</b></span><span>L3-N <b>{formatNumber(numberMetric(controller, "ats.source2.voltage.l3_n"), "V")}</b></span></div>
                <footer><span>{formatNumber(numberMetric(controller, "ats.source2.frequency"), "Hz", 2)}</span><span>Interruptor {source2Breaker === null ? "—" : source2Breaker ? "cerrado" : "abierto"}</span></footer>
              </article>
            </div>

            <div className="pm-kpis">
              <div><span>Corriente L1</span><strong>{formatNumber(numberMetric(controller, "ats.load.current.l1"), "A")}</strong></div>
              <div><span>Corriente L2</span><strong>{formatNumber(numberMetric(controller, "ats.load.current.l2"), "A")}</strong></div>
              <div><span>Corriente L3</span><strong>{formatNumber(numberMetric(controller, "ats.load.current.l3"), "A")}</strong></div>
              <div><span>Potencia activa</span><strong>{formatNumber(numberMetric(controller, "ats.load.power.active.total"), "kW")}</strong></div>
              <div><span>Potencia aparente</span><strong>{formatNumber(numberMetric(controller, "ats.load.power.apparent.total"), "kVA")}</strong></div>
              <div><span>Factor potencia</span><strong>{formatNumber(numberMetric(controller, "ats.load.power_factor"), "", 3)}</strong></div>
            </div>
            <div className="cold-maintenance-note"><strong>Mapa físico pendiente de congelar</strong><p>HOIT ya define el contrato normalizado. El mapeo exacto de registros GenComm/Modbus se incorporará al gateway únicamente contra la documentación oficial de la revisión instalada.</p></div>
          </article>;
        })}
      </section>)}
    </div>

    {historyTarget && <AtsHistoryDialog
      assetId={historyTarget.assetId}
      controller={{ id: historyTarget.controller.id, code: historyTarget.controller.code, name: historyTarget.controller.name }}
      metrics={historyTarget.controller.metrics.map((item) => ({ key: item.key, name: item.name, unit: item.unit, dataType: item.dataType }))}
      onClose={() => setHistoryTarget(null)}
    />}

    {dialog && <div className="cold-config-backdrop" role="presentation">
      <section className="cold-config-dialog electrical-dialog" role="dialog" aria-modal="true">
        <header><div><span><Settings size={16} /></span><div><strong>{dialog === "unit" ? "Nuevo ATS" : dialog === "controller" ? "Configurar DSE8660 MKII" : "Configuración ATS"}</strong><small>{dialog === "controller" ? "Parámetros de adquisición RS485. Deben confirmarse contra el equipo real." : "Semántica operacional y alarmas del activo."}</small></div></div><button onClick={() => setDialog(null)} aria-label="Cerrar"><X size={18} /></button></header>
        <div className="cold-config-form">
          {dialog === "unit" ? <>
            <div className="cold-config-columns"><label><span>Código</span><input value={unitForm.code} onChange={(event) => setUnitForm({ ...unitForm, code: event.target.value })} placeholder="ATS-01" /></label><label><span>Nombre</span><input value={unitForm.name} onChange={(event) => setUnitForm({ ...unitForm, name: event.target.value })} placeholder="ATS principal" /></label></div>
            <div className="cold-config-columns"><label><span>Área</span><input value={unitForm.area} onChange={(event) => setUnitForm({ ...unitForm, area: event.target.value })} /></label><span /></div>
            <div className="cold-config-columns"><label><span>Nombre Fuente 1</span><input value={unitForm.source1Label} onChange={(event) => setUnitForm({ ...unitForm, source1Label: event.target.value })} /></label><label><span>Nombre Fuente 2</span><input value={unitForm.source2Label} onChange={(event) => setUnitForm({ ...unitForm, source2Label: event.target.value })} /></label></div>
          </> : dialog === "controller" ? <>
            <div className="cold-config-columns"><label><span>ATS</span><select value={controllerForm.assetId} onChange={(event) => setControllerForm({ ...controllerForm, assetId: event.target.value })}>{configuration?.units.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label><span>Gateway</span><select value={controllerForm.gatewayId} onChange={(event) => setControllerForm({ ...controllerForm, gatewayId: event.target.value })}>{configuration?.gateways.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label></div>
            <div className="cold-config-columns"><label><span>Código</span><input value={controllerForm.code} onChange={(event) => setControllerForm({ ...controllerForm, code: event.target.value })} /></label><label><span>Nombre</span><input value={controllerForm.name} onChange={(event) => setControllerForm({ ...controllerForm, name: event.target.value })} /></label></div>
            <div className="cold-config-columns"><label><span>Bus físico RS485</span><input value={controllerForm.busKey} onChange={(event) => setControllerForm({ ...controllerForm, busKey: event.target.value })} placeholder="rs485-1" /></label><label><span>Modbus slave ID</span><input type="number" min="1" max="247" value={controllerForm.unitId} onChange={(event) => setControllerForm({ ...controllerForm, unitId: event.target.value })} /></label></div>
            <div className="cold-config-columns"><label><span>Polling (ms)</span><input type="number" min="250" value={controllerForm.pollIntervalMs} onChange={(event) => setControllerForm({ ...controllerForm, pollIntervalMs: event.target.value })} /></label></div>
            <div className="cold-config-columns"><label><span>Baud rate</span><select required value={controllerForm.baudRate} onChange={(event) => setControllerForm({ ...controllerForm, baudRate: event.target.value })}><option value="">Seleccionar</option><option value="9600">9600</option><option value="19200">19200</option><option value="38400">38400</option><option value="57600">57600</option><option value="115200">115200</option></select></label><label><span>Paridad</span><select required value={controllerForm.parity} onChange={(event) => setControllerForm({ ...controllerForm, parity: event.target.value })}><option value="">Seleccionar</option><option value="none">None</option><option value="even">Even</option><option value="odd">Odd</option></select></label></div>
            <div className="cold-maintenance-note"><strong>No se asumen parámetros de fábrica</strong><p>Bus físico, baud rate, paridad y slave ID deben confirmarse en los DSE8660 MKII instalados. Los controladores del mismo bus comparten configuración serial y usan direcciones distintas; otro puerto RS485 puede reutilizar una dirección.</p></div>
          </> : <>
            <div className="cold-config-columns"><label><span>Nombre Fuente 1</span><input value={settingsForm.source1Label} onChange={(event) => setSettingsForm({ ...settingsForm, source1Label: event.target.value })} /></label><label><span>Nombre Fuente 2</span><input value={settingsForm.source2Label} onChange={(event) => setSettingsForm({ ...settingsForm, source2Label: event.target.value })} /></label></div>
            <div className="cold-config-columns"><label><span>Sin telemetría después de (s)</span><input type="number" min="5" value={settingsForm.staleAfterSeconds} onChange={(event) => setSettingsForm({ ...settingsForm, staleAfterSeconds: event.target.value })} /></label><label><span>Persistencia fuente no disponible (s)</span><input type="number" min="0" value={settingsForm.sourceUnavailableDelaySeconds} onChange={(event) => setSettingsForm({ ...settingsForm, sourceUnavailableDelaySeconds: event.target.value })} /></label></div>
            <div className="cold-config-columns"><label className="ats-checkbox"><input type="checkbox" checked={settingsForm.source1Required} onChange={(event) => setSettingsForm({ ...settingsForm, source1Required: event.target.checked })} /><span>Fuente 1 debe estar disponible</span></label><label className="ats-checkbox"><input type="checkbox" checked={settingsForm.source2Required} onChange={(event) => setSettingsForm({ ...settingsForm, source2Required: event.target.checked })} /><span>Fuente 2 debe estar disponible</span></label></div>
            <div className="cold-config-columns"><label><span>Alarma común: persistencia (s)</span><input type="number" min="0" value={settingsForm.commonAlarmDelaySeconds} onChange={(event) => setSettingsForm({ ...settingsForm, commonAlarmDelaySeconds: event.target.value })} /></label><label><span>Posición esperada</span><select value={settingsForm.expectedPosition} onChange={(event) => setSettingsForm({ ...settingsForm, expectedPosition: event.target.value })}><option value="">No supervisar</option><option value="source1">Fuente 1</option><option value="source2">Fuente 2</option></select></label></div>
            <div className="cold-config-columns"><label><span>Posición inesperada: persistencia (s)</span><input type="number" min="0" value={settingsForm.unexpectedPositionDelaySeconds} onChange={(event) => setSettingsForm({ ...settingsForm, unexpectedPositionDelaySeconds: event.target.value })} /></label><span /></div>
            <div className="cold-maintenance-note"><strong>Disponibilidad de fuentes no se presupone</strong><p>Una fuente sólo genera alarma por indisponibilidad cuando se marca explícitamente como requerida. Esto evita alarmas falsas si la Fuente 2 corresponde a una fuente de respaldo que normalmente está fuera de servicio.</p></div>
          </>}
          {error && <div className="cold-config-error">{error}</div>}
        </div>
        <footer><button className="secondary-button" onClick={() => setDialog(null)} disabled={busy}>Cancelar</button><button className="primary-button" onClick={() => void (dialog === "unit" ? createUnit() : dialog === "controller" ? createController() : saveSettings())} disabled={busy || (dialog === "controller" && (!controllerForm.baudRate || !controllerForm.parity))}>{busy ? "Guardando…" : dialog === "unit" ? "Crear ATS" : dialog === "controller" ? "Crear DSE8660" : "Guardar configuración"}</button></footer>
      </section>
    </div>}
  </div>;
}

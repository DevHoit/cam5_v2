"use client";

import { useEffect, useState } from "react";
import { ColdChainDetail } from "./cold-chain-detail";
import {
  IconAlertTriangle as AlertTriangle,
  IconBattery as Battery,
  IconCircleCheck as CircleCheck,
  IconPlus as Plus,
  IconRefresh as Refresh,
  IconSettings as Settings,
  IconSnowflake as Snowflake,
  IconTemperature as Thermometer,
  IconWifi as Wifi,
  IconX as X,
} from "@tabler/icons-react";

type ChamberStatus = "normal" | "warning" | "critical" | "offline" | "unconfigured" | "maintenance";
type GatewayOption = { id: string; code: string; name: string; state: string; active: boolean };

type ColdChainSensor = {
  id: string;
  code: string;
  name: string;
  deviceState: string;
  status: "normal" | "warning" | "critical" | "offline" | "unconfigured";
  stale: boolean;
  temperatureC: number | null;
  temperatureQuality: string | null;
  temperatureRecordedAt: string | null;
  batteryVoltage: number | null;
  rssi: number | null;
  lastReadAt: string | null;
};

type ColdChainChamber = {
  id: string;
  code: string;
  name: string;
  area: string | null;
  assetState: string;
  status: ChamberStatus;
  config: {
    minimumC: number | null;
    maximumC: number | null;
    targetC: number | null;
    staleAfterSeconds: number;
    disagreementThresholdC: number | null;
    excursionDelaySeconds: number;
    batteryLowVoltage: number | null;
    temperatureHysteresisC: number;
  };
  summary: {
    minimumObservedC: number | null;
    maximumObservedC: number | null;
    averageC: number | null;
    spreadC: number | null;
    sensorsOnline: number;
    sensorsTotal: number;
    disagreement: boolean;
  };
  sensors: ColdChainSensor[];
};

type ColdChainResponse = {
  schemaVersion: "2.0";
  serverTime: string;
  chambers: ColdChainChamber[];
};

type ConfigurationResponse = {
  chambers: Array<{
    id: string;
    code: string;
    name: string;
    area: string | null;
    state: string;
    active: boolean;
    metadata: Record<string, unknown>;
  }>;
  gateways: GatewayOption[];
};

const statusLabel: Record<ChamberStatus, string> = {
  normal: "Normal",
  warning: "Advertencia",
  critical: "Crítica",
  offline: "Sin datos",
  unconfigured: "Sin rango configurado",
  maintenance: "Mantenimiento",
};

function temperature(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(1) + " °C";
}

function age(value: string | null) {
  if (!value) return "Sin lectura";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Hace " + seconds + " s";
  if (seconds < 3600) return "Hace " + Math.round(seconds / 60) + " min";
  return "Hace " + Math.round(seconds / 3600) + " h";
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || "No fue posible completar la solicitud.");
  return payload as T;
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ColdChainView({ canWrite = false }: { canWrite?: boolean }) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; data: ColdChainResponse | null }>({
    status: "loading",
    data: null,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [gateways, setGateways] = useState<GatewayOption[]>([]);
  const [dialog, setDialog] = useState<"chamber" | "sensor" | "edit" | null>(null);
  const [detailChamberId, setDetailChamberId] = useState<string | null>(null);
  const [selectedChamber, setSelectedChamber] = useState<ColdChainChamber | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [chamberForm, setChamberForm] = useState({
    code: "",
    name: "",
    area: "",
    minimumC: "",
    maximumC: "",
    targetC: "",
    staleAfterSeconds: "180",
    disagreementThresholdC: "",
    excursionDelaySeconds: "300",
    batteryLowVoltage: "",
    temperatureHysteresisC: "0",
  });
  const [sensorForm, setSensorForm] = useState({
    code: "",
    name: "",
    gatewayId: "",
    namespaceId: "",
    instanceId: "",
  });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const data = await requestJson<ColdChainResponse>("/api/v1/cold-chain/overview");
        if (active) setState({ status: "ready", data });
      } catch {
        if (active) setState((current) => ({ status: "error", data: current.data }));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refreshKey]);

  useEffect(() => {
    if (!canWrite) return;
    let active = true;
    void requestJson<ConfigurationResponse>("/api/v1/cold-chain/configuration")
      .then((data) => { if (active) setGateways(data.gateways.filter((gateway) => gateway.active)); })
      .catch(() => { if (active) setGateways([]); });
    return () => { active = false; };
  }, [canWrite, refreshKey]);

  const closeDialog = () => {
    setDialog(null);
    setSelectedChamber(null);
    setFormError("");
  };

  const openCreateChamber = () => {
    setChamberForm({
      code: "",
      name: "",
      area: "",
      minimumC: "",
      maximumC: "",
      targetC: "",
      staleAfterSeconds: "180",
      disagreementThresholdC: "",
      excursionDelaySeconds: "300",
      batteryLowVoltage: "",
      temperatureHysteresisC: "0",
    });
    setDialog("chamber");
    setSelectedChamber(null);
    setFormError("");
  };

  const openEditChamber = (chamber: ColdChainChamber) => {
    setSelectedChamber(chamber);
    setChamberForm({
      code: chamber.code,
      name: chamber.name,
      area: chamber.area ?? "",
      minimumC: chamber.config.minimumC === null ? "" : String(chamber.config.minimumC),
      maximumC: chamber.config.maximumC === null ? "" : String(chamber.config.maximumC),
      targetC: chamber.config.targetC === null ? "" : String(chamber.config.targetC),
      staleAfterSeconds: String(chamber.config.staleAfterSeconds),
      disagreementThresholdC: chamber.config.disagreementThresholdC === null ? "" : String(chamber.config.disagreementThresholdC),
      excursionDelaySeconds: String(chamber.config.excursionDelaySeconds),
      batteryLowVoltage: chamber.config.batteryLowVoltage === null ? "" : String(chamber.config.batteryLowVoltage),
      temperatureHysteresisC: String(chamber.config.temperatureHysteresisC),
    });
    setDialog("edit");
    setFormError("");
  };

  const openCreateSensor = (chamber: ColdChainChamber) => {
    setSelectedChamber(chamber);
    setSensorForm({
      code: "",
      name: "",
      gatewayId: gateways[0]?.id ?? "",
      namespaceId: "",
      instanceId: "",
    });
    setDialog("sensor");
    setFormError("");
  };

  const saveChamber = async () => {
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        name: chamberForm.name,
        area: chamberForm.area,
        minimumC: numberOrNull(chamberForm.minimumC),
        maximumC: numberOrNull(chamberForm.maximumC),
        targetC: numberOrNull(chamberForm.targetC),
        staleAfterSeconds: Number(chamberForm.staleAfterSeconds),
        disagreementThresholdC: numberOrNull(chamberForm.disagreementThresholdC),
        excursionDelaySeconds: Number(chamberForm.excursionDelaySeconds),
        batteryLowVoltage: numberOrNull(chamberForm.batteryLowVoltage),
        temperatureHysteresisC: numberOrNull(chamberForm.temperatureHysteresisC) ?? 0,
      };
      if (dialog === "edit" && selectedChamber) {
        await requestJson("/api/v1/cold-chain/configuration", {
          method: "PATCH",
          body: JSON.stringify({ chamberId: selectedChamber.id, ...payload }),
        });
      } else {
        await requestJson("/api/v1/cold-chain/configuration", {
          method: "POST",
          body: JSON.stringify({ action: "create_chamber", code: chamberForm.code, ...payload }),
        });
      }
      closeDialog();
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No fue posible guardar la cámara.");
    } finally {
      setSaving(false);
    }
  };

  const saveSensor = async () => {
    if (!selectedChamber) return;
    setSaving(true);
    setFormError("");
    try {
      await requestJson("/api/v1/cold-chain/configuration", {
        method: "POST",
        body: JSON.stringify({
          action: "create_sensor",
          chamberId: selectedChamber.id,
          gatewayId: sensorForm.gatewayId,
          code: sensorForm.code,
          name: sensorForm.name,
          namespaceId: sensorForm.namespaceId,
          instanceId: sensorForm.instanceId,
        }),
      });
      closeDialog();
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No fue posible crear el sensor.");
    } finally {
      setSaving(false);
    }
  };

  if (state.status === "loading" && !state.data) {
    return <section className="panel cold-chain-state"><Refresh className="spin" size={24} /><div><strong>Cargando cámaras de refrigeración</strong><p>Consultando cámaras, sensores y últimas temperaturas del sitio.</p></div></section>;
  }

  if (state.status === "error" && !state.data) {
    return <section className="panel cold-chain-state"><AlertTriangle size={24} /><div><strong>No fue posible consultar la cadena de frío</strong><p>El portal no declara un estado cuando no puede verificar las lecturas.</p></div></section>;
  }

  const chambers = state.data?.chambers ?? [];
  const attention = chambers.filter((chamber) => chamber.status === "warning" || chamber.status === "critical").length;
  const normal = chambers.filter((chamber) => chamber.status === "normal").length;
  const offline = chambers.filter((chamber) => chamber.status === "offline").length;

  return <div className="cold-chain-view">
    {canWrite && <div className="cold-chain-toolbar">
      <button className="primary-button" onClick={openCreateChamber}><Plus size={16} /> Nueva cámara</button>
    </div>}

    <section className="cold-chain-summary-grid">
      <article className="cold-chain-summary-card"><Snowflake size={20} /><div><span>Cámaras</span><strong>{chambers.length}</strong><small>En el sitio activo</small></div></article>
      <article className="cold-chain-summary-card"><CircleCheck size={20} /><div><span>Normales</span><strong>{normal}</strong><small>Dentro de rango y con datos</small></div></article>
      <article className="cold-chain-summary-card"><AlertTriangle size={20} /><div><span>Con atención</span><strong>{attention}</strong><small>Advertencia o condición crítica</small></div></article>
      <article className="cold-chain-summary-card"><Wifi size={20} /><div><span>Sin datos</span><strong>{offline}</strong><small>Sin lectura fresca disponible</small></div></article>
    </section>

    {!chambers.length && <section className="panel cold-chain-state"><Snowflake size={24} /><div><strong>No hay cámaras configuradas</strong><p>Cada cámara es un activo independiente y puede tener uno o más sensores de temperatura asociados.</p></div></section>}

    <section className="cold-chain-grid">
      {chambers.map((chamber) => <article className={"cold-room-card cold-room-" + chamber.status} key={chamber.id}>
        <header>
          <span className="cold-room-icon"><Snowflake size={21} /></span>
          <div><span>{chamber.code}</span><h2>{chamber.name}</h2><p>{chamber.area || "Sin área definida"}</p></div>
          <div className="cold-room-header-actions">
            <b>{statusLabel[chamber.status]}</b>
            {canWrite && <button className="cold-room-action" onClick={() => openEditChamber(chamber)} aria-label={"Configurar " + chamber.name}><Settings size={16} /></button>}
          </div>
        </header>

        <div className="cold-room-primary">
          <div><span>Promedio actual</span><strong>{temperature(chamber.summary.averageC)}</strong></div>
          <div><span>Rango configurado</span><strong>{chamber.config.minimumC === null || chamber.config.maximumC === null ? "Pendiente" : chamber.config.minimumC.toFixed(1) + " a " + chamber.config.maximumC.toFixed(1) + " °C"}</strong></div>
          <div><span>Sensores</span><strong>{chamber.summary.sensorsOnline + "/" + chamber.summary.sensorsTotal}</strong></div>
        </div>

        <div className="cold-room-stats">
          <span><small>Mínima</small><strong>{temperature(chamber.summary.minimumObservedC)}</strong></span>
          <span><small>Máxima</small><strong>{temperature(chamber.summary.maximumObservedC)}</strong></span>
          <span><small>Diferencia</small><strong>{temperature(chamber.summary.spreadC)}</strong></span>
          <span><small>Persistencia alarma</small><strong>{chamber.config.excursionDelaySeconds + " s"}</strong></span>
        </div>

        {chamber.summary.disagreement && <div className="cold-room-warning"><AlertTriangle size={16} /><span>Los sensores difieren más que el límite configurado. Revisar ubicación, calibración o condición térmica.</span></div>}

        <div className="cold-sensor-list">
          {chamber.sensors.map((sensor) => <div className={"cold-sensor-row sensor-" + sensor.status} key={sensor.id}>
            <span className="cold-sensor-status"><i /></span>
            <div className="cold-sensor-name"><strong>{sensor.code}</strong><small>{sensor.name}</small></div>
            <div className="cold-sensor-reading"><Thermometer size={17} /><strong>{temperature(sensor.temperatureC)}</strong><small>{age(sensor.temperatureRecordedAt)}</small></div>
            <div className="cold-sensor-health">
              <span><Battery size={15} />{sensor.batteryVoltage === null ? "—" : sensor.batteryVoltage.toFixed(2) + " V"}</span>
              <span><Wifi size={15} />{sensor.rssi === null ? "—" : sensor.rssi + " dBm"}</span>
            </div>
          </div>)}
          {!chamber.sensors.length && <div className="cold-room-warning"><AlertTriangle size={16} /><span>La cámara no tiene sensores activos asociados.</span></div>}
        </div>

        <footer className="cold-room-footer">
          <button className="secondary-button" onClick={() => setDetailChamberId(chamber.id)}>Ver histórico y excursiones</button>
          {canWrite && <button className="secondary-button" onClick={() => openCreateSensor(chamber)}><Plus size={15} /> Agregar sensor BLE</button>}
        </footer>
      </article>)}
    </section>

    {state.status === "error" && state.data && <p className="cold-chain-refresh-warning">Se muestran las últimas lecturas disponibles; la actualización automática falló temporalmente.</p>}

    {detailChamberId && <ColdChainDetail chamberId={detailChamberId} onClose={() => setDetailChamberId(null)} />}

    {dialog && <div className="cold-config-backdrop" role="presentation" onMouseDown={closeDialog}>
      <section className="cold-config-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span className="eyebrow">Cadena de frío</span><h2>{dialog === "sensor" ? "Agregar sensor BLE" : dialog === "edit" ? "Configurar cámara" : "Nueva cámara"}</h2></div>
          <button onClick={closeDialog} aria-label="Cerrar"><X size={18} /></button>
        </header>

        {dialog !== "sensor" ? <div className="cold-config-form">
          {dialog === "chamber" && <label><span>Código</span><input value={chamberForm.code} onChange={(event) => setChamberForm({ ...chamberForm, code: event.target.value })} placeholder="CAM-REF-01" /></label>}
          <label><span>Nombre</span><input value={chamberForm.name} onChange={(event) => setChamberForm({ ...chamberForm, name: event.target.value })} placeholder="Cámara refrigeración 01" /></label>
          <label><span>Área</span><input value={chamberForm.area} onChange={(event) => setChamberForm({ ...chamberForm, area: event.target.value })} placeholder="Farmacia" /></label>
          <div className="cold-config-columns">
            <label><span>Mínimo °C</span><input type="number" step="0.1" value={chamberForm.minimumC} onChange={(event) => setChamberForm({ ...chamberForm, minimumC: event.target.value })} /></label>
            <label><span>Máximo °C</span><input type="number" step="0.1" value={chamberForm.maximumC} onChange={(event) => setChamberForm({ ...chamberForm, maximumC: event.target.value })} /></label>
            <label><span>Objetivo °C</span><input type="number" step="0.1" value={chamberForm.targetC} onChange={(event) => setChamberForm({ ...chamberForm, targetC: event.target.value })} /></label>
          </div>
          <div className="cold-config-columns">
            <label><span>Lectura obsoleta después de (s)</span><input type="number" min="1" value={chamberForm.staleAfterSeconds} onChange={(event) => setChamberForm({ ...chamberForm, staleAfterSeconds: event.target.value })} /></label>
            <label><span>Diferencia máxima sensores °C</span><input type="number" step="0.1" min="0" value={chamberForm.disagreementThresholdC} onChange={(event) => setChamberForm({ ...chamberForm, disagreementThresholdC: event.target.value })} /></label>
            <label><span>Persistencia alarma (s)</span><input type="number" min="1" value={chamberForm.excursionDelaySeconds} onChange={(event) => setChamberForm({ ...chamberForm, excursionDelaySeconds: event.target.value })} /></label>
          </div>
          <div className="cold-config-columns">
            <label><span>Histéresis temperatura °C</span><input type="number" step="0.1" min="0" value={chamberForm.temperatureHysteresisC} onChange={(event) => setChamberForm({ ...chamberForm, temperatureHysteresisC: event.target.value })} /></label>
            <label><span>Batería baja bajo (V)</span><input type="number" step="0.01" min="0" value={chamberForm.batteryLowVoltage} onChange={(event) => setChamberForm({ ...chamberForm, batteryLowVoltage: event.target.value })} placeholder="Opcional" /></label>
          </div>
        </div> : <div className="cold-config-form">
          <p className="cold-config-context">{selectedChamber?.code} · {selectedChamber?.name}</p>
          <label><span>Código sensor</span><input value={sensorForm.code} onChange={(event) => setSensorForm({ ...sensorForm, code: event.target.value })} placeholder="TEMP-01" /></label>
          <label><span>Nombre</span><input value={sensorForm.name} onChange={(event) => setSensorForm({ ...sensorForm, name: event.target.value })} placeholder="Sensor frontal" /></label>
          <label><span>Gateway</span><select value={sensorForm.gatewayId} onChange={(event) => setSensorForm({ ...sensorForm, gatewayId: event.target.value })}><option value="">Seleccionar gateway</option>{gateways.map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.code} · {gateway.name}</option>)}</select></label>
          <label><span>Eddystone Namespace ID</span><input value={sensorForm.namespaceId} onChange={(event) => setSensorForm({ ...sensorForm, namespaceId: event.target.value })} placeholder="10-byte namespace" /></label>
          <label><span>Eddystone Instance ID</span><input value={sensorForm.instanceId} onChange={(event) => setSensorForm({ ...sensorForm, instanceId: event.target.value })} placeholder="6-byte instance" /></label>
        </div>}

        {formError && <div className="cold-config-error"><AlertTriangle size={16} /><span>{formError}</span></div>}

        <footer>
          <button className="secondary-button" onClick={closeDialog} disabled={saving}>Cancelar</button>
          <button className="primary-button" onClick={() => void (dialog === "sensor" ? saveSensor() : saveChamber())} disabled={saving}>
            {saving ? <><Refresh className="spin" size={16} /> Guardando…</> : <>Guardar</>}
          </button>
        </footer>
      </section>
    </div>}
  </div>;
}

"use client";

import { useEffect, useState } from "react";
import {
  IconAlertTriangle as AlertTriangle,
  IconBattery as Battery,
  IconCircleCheck as CircleCheck,
  IconRefresh as Refresh,
  IconSnowflake as Snowflake,
  IconTemperature as Thermometer,
  IconWifi as Wifi,
} from "@tabler/icons-react";

type ChamberStatus = "normal" | "warning" | "critical" | "offline" | "unconfigured" | "maintenance";

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

export function ColdChainView() {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; data: ColdChainResponse | null }>({
    status: "loading",
    data: null,
  });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/v1/cold-chain/overview", { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error("No fue posible cargar la cadena de frío.");
        const data = await response.json() as ColdChainResponse;
        if (active) setState({ status: "ready", data });
      } catch {
        if (active) setState((current) => ({ status: "error", data: current.data }));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

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
    <section className="cold-chain-summary-grid">
      <article className="cold-chain-summary-card"><Snowflake size={20} /><div><span>Cámaras</span><strong>{chambers.length}</strong><small>En el sitio activo</small></div></article>
      <article className="cold-chain-summary-card"><CircleCheck size={20} /><div><span>Normales</span><strong>{normal}</strong><small>Dentro de rango y con datos</small></div></article>
      <article className="cold-chain-summary-card"><AlertTriangle size={20} /><div><span>Con atención</span><strong>{attention}</strong><small>Advertencia o condición crítica</small></div></article>
      <article className="cold-chain-summary-card"><Wifi size={20} /><div><span>Sin datos</span><strong>{offline}</strong><small>Sin lectura fresca disponible</small></div></article>
    </section>

    {!chambers.length && <section className="panel cold-chain-state"><Snowflake size={24} /><div><strong>No hay cámaras configuradas</strong><p>Cada cámara debe ser un activo cold_room y puede tener uno o más sensores de temperatura asociados.</p></div></section>}

    <section className="cold-chain-grid">
      {chambers.map((chamber) => <article className={"cold-room-card cold-room-" + chamber.status} key={chamber.id}>
        <header>
          <span className="cold-room-icon"><Snowflake size={21} /></span>
          <div><span>{chamber.code}</span><h2>{chamber.name}</h2><p>{chamber.area || "Sin área definida"}</p></div>
          <b>{statusLabel[chamber.status]}</b>
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
      </article>)}
    </section>

    {state.status === "error" && state.data && <p className="cold-chain-refresh-warning">Se muestran las últimas lecturas disponibles; la actualización automática falló temporalmente.</p>}
  </div>;
}

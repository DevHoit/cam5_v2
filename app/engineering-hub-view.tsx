"use client";

import {
  IconActivity,
  IconArrowsExchange,
  IconBolt,
  IconChevronRight,
  IconCircuitCell,
  IconKey,
  IconRouter,
  IconSettings,
  IconTemperature,
  IconTool,
  IconListDetails,
} from "@tabler/icons-react";
import { DeviceModelCatalog } from "./device-model-catalog";

type EngineeringAsset = { id: string; code: string; name: string; area: string | null; type: string; state: string };
type EngineeringDevice = { id: string; pointId: string; code: string; name: string; model: string; state: string; active: boolean };
type View = "electrical" | "ats" | "cold-chain" | "settings" | "diagnostics" | "commissioning" | "provisioning";

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    general_asset: "Activo general",
    room_environment: "Sala / ambiente",
    cold_room: "Cámara de frío",
    hvac: "Climatización / HVAC",
    electrical_point: "Punto o sistema eléctrico",
    switchgear_cabinet: "Celda / tablero eléctrico",
    transformer: "Transformador",
    ats: "ATS / transferencia automática",
    generator: "Generador",
    ups: "UPS",
    motor: "Motor",
    pump: "Bomba",
    compressor: "Compresor",
    fan: "Ventilador",
    conveyor: "Correa transportadora",
    tank: "Estanque / depósito",
    process_equipment: "Equipo de proceso",
  };
  return labels[type] ?? type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function operationalState(value: string) {
  if (["active", "online", "normal"].includes(value)) return "Operativo";
  if (["warning", "degraded", "commissioning"].includes(value)) return "Atención";
  if (value === "critical") return "Crítico";
  return "Sin comunicación";
}

export function EngineeringHubView({ asset, devices, canWrite, onNavigate, notify }: {
  asset?: EngineeringAsset;
  devices: EngineeringDevice[];
  canWrite: boolean;
  onNavigate: (view: View) => void;
  notify: (message: string, tone?: "success" | "info" | "warning") => void;
}) {
  if (!asset) return <section className="engineering-empty-state">
    <span><IconTool size={24} /></span>
    <div><h1>Selecciona un activo</h1><p>Las herramientas de ingeniería se habilitan dentro del contexto del activo seleccionado.</p></div>
  </section>;

  const assetDevices = devices.filter((device) => device.pointId === asset.id && device.active);
  const specializedCapability = asset.type === "electrical_point"
    ? { icon: IconBolt, title: "Análisis eléctrico", detail: "Variables eléctricas, umbrales y comportamiento operacional del activo.", view: "electrical" as const }
    : asset.type === "ats"
      ? { icon: IconArrowsExchange, title: "Transferencia automática", detail: "Fuentes, posición de transferencia y condiciones operacionales ATS.", view: "ats" as const }
      : asset.type === "cold_room"
        ? { icon: IconTemperature, title: "Cadena de frío", detail: "Temperaturas, rangos configurados, sensores y excursiones térmicas.", view: "cold-chain" as const }
        : null;
  const AssetIcon = specializedCapability?.icon ?? IconCircuitCell;

  return <div className="engineering-hub engineering-hub-v5">
    <section className="engineering-home-commandbar">
      <div>
        <span className="eyebrow"><IconTool size={13} /> Ingeniería</span>
        <h1>Ingeniería del activo</h1>
        <p>Configura, valida y deja listo para operación el activo seleccionado. Las herramientas están ordenadas por alcance y secuencia de trabajo.</p>
      </div>
      <span className={`engineering-state state-${["active","online","normal"].includes(asset.state) ? "ready" : asset.state === "critical" ? "critical" : "warning"}`}>{assetDevices.length ? operationalState(asset.state) : "Sin monitoreo"}</span>
    </section>

    <section className="engineering-context-card">
      <span className="engineering-context-icon"><AssetIcon size={20} /></span>
      <div className="engineering-context-identity">
        <small>Activo seleccionado · {asset.code}</small>
        <strong>{asset.name}</strong>
        <p>{typeLabel(asset.type)}{asset.area ? ` · ${asset.area}` : ""}</p>
      </div>
      <div className="engineering-context-facts">
        <span><strong>{assetDevices.length}</strong><small>Dispositivos asociados</small></span>
        <span><strong>{assetDevices.filter((device) => ["active","online","normal"].includes(device.state)).length}</strong><small>Operativos</small></span>
      </div>
    </section>

    {specializedCapability && <section className="engineering-specialized-callout">
      <span><AssetIcon size={20} /></span>
      <div><small>Capacidad especializada</small><strong>{specializedCapability.title}</strong><p>{specializedCapability.detail}</p></div>
      <button onClick={() => onNavigate(specializedCapability.view)}>Abrir monitoreo <IconChevronRight size={15} /></button>
    </section>}

    <section className="engineering-workflow">
      <header>
        <div><span className="eyebrow">Activo</span><h2>Flujo de ingeniería</h2><p>Trabaja sobre el activo en este orden para mantener configuración, diagnóstico y puesta en marcha separados.</p></div>
      </header>
      <div className="engineering-workflow-grid">
        <button onClick={() => onNavigate("settings")}>
          <b>1</b><span className="engineering-workflow-icon"><IconSettings size={19} /></span>
          <div><strong>Configurar activo</strong><small>Identidad lógica, dispositivos asociados, gateways, métricas y capacidades.</small></div>
          <IconChevronRight size={16} />
        </button>
        <button onClick={() => onNavigate("diagnostics")}>
          <b>2</b><span className="engineering-workflow-icon"><IconActivity size={19} /></span>
          <div><strong>Validar diagnóstico</strong><small>Comprueba gateway, dispositivo, ingesta y calidad de la telemetría.</small></div>
          <IconChevronRight size={16} />
        </button>
        <button onClick={() => onNavigate("commissioning")}>
          <b>3</b><span className="engineering-workflow-icon"><IconSettings size={19} /></span>
          <div><strong>Puesta en marcha</strong><small>Revisa readiness, evidencia y controles antes de habilitar operación.</small></div>
          <IconChevronRight size={16} />
        </button>
      </div>
    </section>

    <section className="engineering-site-tools">
      <header><div><span className="eyebrow">Sitio</span><h2>Infraestructura del sitio</h2><p>Estas herramientas no pertenecen sólo al activo seleccionado; administran componentes compartidos del sitio.</p></div></header>
      <button onClick={() => onNavigate("provisioning")}>
        <span><IconKey size={19} /></span>
        <div><strong>Gateways y credenciales</strong><small>Provisionamiento, identidad y credenciales de los gateways del sitio.</small></div>
        <i>Alcance sitio</i>
        <IconChevronRight size={16} />
      </button>
    </section>

    <section className="panel engineering-device-inventory engineering-device-inventory-v5">
      <header><div><span className="eyebrow">Contexto técnico</span><h2>Dispositivos asociados al activo</h2><p>Equipos que entregan telemetría al activo seleccionado.</p></div><span>{assetDevices.length}</span></header>
      <div>
        {assetDevices.map((device) => <article key={device.id}><span className="engineering-device-icon"><IconRouter size={16} /></span><div><strong>{device.name}</strong><small>{device.code} · {device.model}</small></div><i className={`engineering-device-state state-${["active","online","normal"].includes(device.state) ? "ready" : "warning"}`}>{operationalState(device.state)}</i></article>)}
        {!assetDevices.length && <div className="engineering-no-devices"><IconRouter size={19} /><span><strong>Sin dispositivos asociados</strong><small>{canWrite ? "Asocia un dispositivo desde Activos → Infraestructura." : "Un administrador debe asociar un dispositivo al activo."}</small></span></div>}
      </div>
    </section>

    <details className="engineering-advanced">
      <summary>
        <span><IconListDetails size={18} /></span>
        <div><strong>Catálogo técnico avanzado</strong><small>Modelos de dispositivo, capacidades y plantillas de métricas. Úsalo sólo para administración técnica.</small></div>
        <IconChevronRight size={16} />
      </summary>
      <div className="engineering-advanced-content">
        <DeviceModelCatalog canWrite={canWrite} notify={notify} />
      </div>
    </details>
  </div>;
}

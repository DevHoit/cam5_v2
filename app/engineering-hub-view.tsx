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

type EngineeringAsset = {
  id: string;
  code: string;
  name: string;
  area: string | null;
  type: string;
  state: string;
};

type EngineeringDevice = {
  id: string;
  pointId: string;
  code: string;
  name: string;
  model: string;
  state: string;
  active: boolean;
};

type View = "electrical" | "ats" | "cold-chain" | "settings" | "diagnostics" | "commissioning" | "provisioning";

function typeLabel(type: string) {
  if (type === "electrical_point") return "Activo eléctrico";
  if (type === "ats") return "Transferencia automática";
  if (type === "cold_room") return "Cadena de frío";
  if (type === "switchgear_cabinet") return "Monitoreo de condición";
  return type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function EngineeringHubView({
  asset,
  devices,
  canWrite,
  onNavigate,
  notify,
}: {
  asset?: EngineeringAsset;
  devices: EngineeringDevice[];
  canWrite: boolean;
  onNavigate: (view: View) => void;
  notify: (message: string, tone?: "success" | "info" | "warning") => void;
}) {
  if (!asset) {
    return <article className="panel engineering-hub-empty">
      <IconTool size={25} />
      <div><span className="eyebrow">Ingeniería</span><h2>Selecciona un activo</h2><p>Las herramientas técnicas se muestran según las capacidades del activo seleccionado.</p></div>
    </article>;
  }

  const assetDevices = devices.filter((device) => device.pointId === asset.id && device.active);
  const capability = asset.type === "electrical_point"
    ? { icon: IconBolt, title: "Análisis y configuración eléctrica", detail: "Medidores, variables, umbrales y adquisición eléctrica.", view: "electrical" as const }
    : asset.type === "ats"
      ? { icon: IconArrowsExchange, title: "Transferencia automática", detail: "Fuentes, posición, controlador y reglas ATS.", view: "ats" as const }
      : asset.type === "cold_room"
        ? { icon: IconTemperature, title: "Cadena de frío", detail: "Cámara, sensores, rangos térmicos y excursiones.", view: "cold-chain" as const }
        : { icon: IconCircuitCell, title: "Monitoreo de condición", detail: "Métricas, canales y configuración técnica del dispositivo.", view: "settings" as const };
  const CapabilityIcon = capability.icon;
  const cam5Like = !["electrical_point", "ats", "cold_room"].includes(asset.type);

  return <div className="engineering-hub">
    <section className="panel engineering-asset-card">
      <div className="engineering-asset-icon"><CapabilityIcon size={24} /></div>
      <div><span className="eyebrow">Activo seleccionado</span><h2>{asset.code} · {asset.name}</h2><p>{typeLabel(asset.type)}{asset.area ? ` · ${asset.area}` : ""}</p></div>
      <span className={`status-pill status-${asset.state === "normal" ? "normal" : asset.state === "critical" ? "critical" : asset.state === "warning" ? "warning" : "offline"}`}>{asset.state}</span>
    </section>

    <section className="engineering-hub-grid">
      <button className="panel engineering-tool-card primary" onClick={() => onNavigate(capability.view)}>
        <span><CapabilityIcon size={21} /></span>
        <div><small>Capacidad del activo</small><strong>{capability.title}</strong><p>{capability.detail}</p></div>
        <IconChevronRight size={18} />
      </button>

      <button className="panel engineering-tool-card" onClick={() => onNavigate("provisioning")}>
        <span><IconKey size={21} /></span>
        <div><small>Infraestructura</small><strong>Gateways y credenciales</strong><p>Provisionamiento, rotación y estado de credenciales de adquisición.</p></div>
        <IconChevronRight size={18} />
      </button>

      {cam5Like && <button className="panel engineering-tool-card" onClick={() => onNavigate("diagnostics")}>
        <span><IconActivity size={21} /></span>
        <div><small>Validación técnica</small><strong>Diagnóstico de adquisición</strong><p>Calidad, latencia y continuidad de la cadena del dispositivo.</p></div>
        <IconChevronRight size={18} />
      </button>}

      {cam5Like && <button className="panel engineering-tool-card" onClick={() => onNavigate("commissioning")}>
        <span><IconSettings size={21} /></span>
        <div><small>Habilitación</small><strong>Puesta en marcha</strong><p>Controles, evidencias y habilitación del dispositivo para operación.</p></div>
        <IconChevronRight size={18} />
      </button>}
    </section>

    <section className="panel engineering-tool-card" style={{ marginBottom: "1rem" }}>
      <span><IconListDetails size={21} /></span>
      <div><small>Catálogo técnico</small><strong>Modelos de dispositivo</strong><p>Plantillas reutilizables de driver, protocolo, capacidades y métricas para nuevas altas.</p></div>
    </section>
    <DeviceModelCatalog canWrite={canWrite} notify={notify} />

    <section className="panel engineering-device-inventory">
      <header><div><span className="eyebrow">Inventario asociado</span><h2>Dispositivos del activo</h2></div><span>{assetDevices.length} asociados</span></header>
      <div>
        {assetDevices.map((device) => <article key={device.id}><span className="engineering-device-icon"><IconRouter size={17} /></span><div><strong>{device.code} · {device.name}</strong><small>{device.model}</small></div><i className={`status-pill status-${["active", "online", "normal"].includes(device.state) ? "normal" : "offline"}`}>{device.state}</i></article>)}
        {!assetDevices.length && <div className="engineering-no-devices"><IconRouter size={20} /><span><strong>Sin dispositivos asociados</strong><small>{canWrite ? "Crea o asocia un dispositivo desde Organización y activos." : "Un administrador debe asociar el dispositivo."}</small></span></div>}
      </div>
    </section>
  </div>;
}

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
  if (type === "electrical_point") return "Activo eléctrico";
  if (type === "ats") return "Transferencia automática";
  if (type === "cold_room") return "Cadena de frío";
  if (type === "switchgear_cabinet") return "Monitoreo de condición";
  return type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  const capability = asset.type === "electrical_point"
    ? { icon: IconBolt, title: "Variables eléctricas", detail: "Métricas, umbrales y comportamiento eléctrico del activo.", view: "electrical" as const }
    : asset.type === "ats"
      ? { icon: IconArrowsExchange, title: "Transferencia automática", detail: "Fuentes, posición y condiciones operacionales ATS.", view: "ats" as const }
      : asset.type === "cold_room"
        ? { icon: IconTemperature, title: "Cadena de frío", detail: "Temperatura, humedad, rangos y excursiones del activo.", view: "cold-chain" as const }
        : { icon: IconCircuitCell, title: "Métricas del dispositivo", detail: "Capacidades, métricas y configuración lógica en Core.", view: "settings" as const };
  const CapabilityIcon = capability.icon;

  return <div className="engineering-hub engineering-hub-v3">
    <section className="engineering-asset-strip">
      <span className="engineering-asset-icon"><CapabilityIcon size={19} /></span>
      <div><small>{asset.code}</small><strong>{asset.name}</strong><p>{typeLabel(asset.type)}{asset.area ? ` · ${asset.area}` : ""}</p></div>
      <span className={`engineering-state state-${["active","online","normal"].includes(asset.state) ? "ready" : asset.state === "critical" ? "critical" : "warning"}`}>{operationalState(asset.state)}</span>
      <div className="engineering-asset-count"><strong>{assetDevices.length}</strong><small>dispositivos</small></div>
    </section>

    <section className="engineering-tools-v3">
      <header><div><h2>Herramientas técnicas</h2><p>Validación y configuración del contexto lógico que administra HoitLive Core.</p></div></header>
      <div>
        <button onClick={() => onNavigate(capability.view)}><span><CapabilityIcon size={18} /></span><div><strong>{capability.title}</strong><small>{capability.detail}</small></div><IconChevronRight size={15} /></button>
        <button onClick={() => onNavigate("diagnostics")}><span><IconActivity size={18} /></span><div><strong>Diagnóstico</strong><small>Salud del dispositivo, gateway, ingesta normalizada y calidad de telemetría.</small></div><IconChevronRight size={15} /></button>
        <button onClick={() => onNavigate("commissioning")}><span><IconSettings size={18} /></span><div><strong>Puesta en marcha</strong><small>Readiness, controles de habilitación y evidencia de terreno.</small></div><IconChevronRight size={15} /></button>
        <button onClick={() => onNavigate("provisioning")}><span><IconKey size={18} /></span><div><strong>Gateways</strong><small>Identidad, credenciales y asociación lógica con la plataforma.</small></div><IconChevronRight size={15} /></button>
      </div>
    </section>

    <section className="panel engineering-device-inventory engineering-device-inventory-v3">
      <header><div><h2>Dispositivos asociados</h2><p>Equipos lógicos vinculados al activo seleccionado.</p></div><span>{assetDevices.length}</span></header>
      <div>
        {assetDevices.map((device) => <article key={device.id}><span className="engineering-device-icon"><IconRouter size={16} /></span><div><strong>{device.code} · {device.name}</strong><small>{device.model}</small></div><i className={`engineering-device-state state-${["active","online","normal"].includes(device.state) ? "ready" : "warning"}`}>{operationalState(device.state)}</i></article>)}
        {!assetDevices.length && <div className="engineering-no-devices"><IconRouter size={19} /><span><strong>Sin dispositivos asociados</strong><small>{canWrite ? "Asocia un dispositivo desde Activos → Infraestructura." : "Un administrador debe asociar un dispositivo al activo."}</small></span></div>}
      </div>
    </section>

    <section className="engineering-catalog-section">
      <header><span><IconListDetails size={18} /></span><div><h2>Modelos de dispositivo</h2><p>Plantillas reutilizables de capacidades y métricas semánticas.</p></div></header>
      <DeviceModelCatalog canWrite={canWrite} notify={notify} />
    </section>
  </div>;
}

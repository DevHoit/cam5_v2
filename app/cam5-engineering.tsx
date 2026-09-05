"use client";

import { useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconAntennaBars5 as AntennaBars5,
  IconCheck as Check,
  IconChevronDown as ChevronDown,
  IconCircuitCell as CircuitBoard,
  IconCloudUpload as CloudUpload,
  IconDatabase as Database,
  IconDeviceFloppy,
  IconDownload as Download,
  IconFileCode as FileCode,
  IconInfoCircle as InfoCircle,
  IconNetwork as Network,
  IconPlugConnected as PlugConnected,
  IconRefresh as Refresh,
  IconRouter as Router,
  IconShieldCheck as ShieldCheck,
  IconTopologyStar3 as TopologyStar3,
} from "@tabler/icons-react";
import { cam5InputInventory, cam5RegisterCatalog, cam5RelayDefaults } from "./cam5-model";
import { usePersistentState } from "./use-persistent-state";
import { Pagination, useClientPagination } from "./pagination";

type CommissioningTab = "device" | "inputs" | "alarms" | "system" | "checklist";
type Notify = (message: string, tone?: "success" | "info" | "warning") => void;
type RelayDraft = { id: number; name: string; source: string; level: string; state: "Activo" | "Inactivo" };

const defaultDevice = {
  model: "CAM5-TPH-XDCW",
  serial: "Pendiente de lectura",
  firmware: "Pendiente de lectura",
  dataVersion: "1",
  controllerIp: "192.168.10.42",
  port: "502",
  unitId: "1",
  pollSeconds: "2",
  timeoutMs: "1000",
  retries: "2",
  referenceMode: "Registro nativo + referencia 400xxx",
};

const defaultAlarmEngine = {
  activationSamples: "3",
  recoverySamples: "3",
  staleSeconds: "30",
  thermalDeadband: "2.0",
  humidityDeadband: "3.0",
  dischargeDeadband: "5",
};

const defaultNetwork = {
  address: "192.168.10.42",
  subnet: "255.255.255.0",
  gateway: "192.168.10.1",
  dns: "192.168.10.1",
  mac: "Pendiente de lectura",
  timezone: "America/Santiago",
  ntp: "pool.ntp.org",
};

const checklistSeed = [
  { id: "identity", label: "Identidad y versión leídas desde el CAM-5", done: false, owner: "Integración" },
  { id: "modbus", label: "Lectura FC03 validada entre registros 418 y 522", done: false, owner: "Integración" },
  { id: "inputs", label: "Bandas, códigos e índices contrastados en terreno", done: false, owner: "Puesta en marcha" },
  { id: "clock", label: "Fecha, hora y zona horaria sincronizadas", done: false, owner: "Integración" },
  { id: "alarms", label: "Umbrales, persistencia y seis relés validados", done: false, owner: "Protecciones" },
  { id: "backup", label: "Respaldo inicial de configuración almacenado", done: false, owner: "Administrador" },
  { id: "history", label: "Histórico y calidad de datos verificados por 24 horas", done: false, owner: "Operaciones" },
  { id: "handover", label: "Acta de entrega y responsables aprobados", done: false, owner: "Proyecto" },
];

function SectionHeading({ icon, eyebrow, title, detail }: { icon: React.ReactNode; eyebrow: string; title: string; detail: string }) {
  return <div className="engineering-heading"><span>{icon}</span><div><small>{eyebrow}</small><h2>{title}</h2><p>{detail}</p></div></div>;
}

export function Cam5CommissioningView({ notify }: { notify: Notify }) {
  const [tab, setTab] = useState<CommissioningTab>("device");
  const [connection, setConnection] = useState<"idle" | "testing" | "ready">("idle");
  const [inputFilter, setInputFilter] = useState<"Todos" | "Temperatura SAW" | "Interfaz UHF" | "Humedad">("Todos");
  const [registerFilter, setRegisterFilter] = useState("Todos");
  const [device, setDevice] = usePersistentState("cam5.front.commissioning.device.v1", defaultDevice);
  const [alarmEngine, setAlarmEngine] = usePersistentState("cam5.front.commissioning.alarms.v1", defaultAlarmEngine);
  const [network, setNetwork] = usePersistentState("cam5.front.commissioning.network.v1", defaultNetwork);
  const [relays, setRelays] = usePersistentState<RelayDraft[]>("cam5.front.commissioning.relays.v1", cam5RelayDefaults.map((relay) => ({ ...relay })) as RelayDraft[]);
  const [checklist, setChecklist] = usePersistentState("cam5.front.commissioning.checklist.v1", checklistSeed);
  const configuredInputs = cam5InputInventory.filter((input) => input.enabled).length;
  const completedChecks = checklist.filter((item) => item.done).length;
  const filteredInputs = cam5InputInventory.filter((input) => inputFilter === "Todos" || input.kind === inputFilter);
  const registerGroups = ["Todos", ...new Set(cam5RegisterCatalog.map((register) => register.group))];
  const visibleRegisters = useMemo(() => cam5RegisterCatalog.filter((register) => registerFilter === "Todos" || register.group === registerFilter), [registerFilter]);
  const inputPage = useClientPagination(filteredInputs, 8);
  const registerPage = useClientPagination(visibleRegisters, 12);

  const testConnection = () => {
    setConnection("testing");
    window.setTimeout(() => {
      setConnection("ready");
      notify("Contrato de conexión preparado. La respuesta real llegará desde el gateway al conectar el CAM-5.", "info");
    }, 900);
  };

  const saveSection = (label: string) => notify(`${label} guardada en el prototipo y lista para persistencia por API.`);
  const toggleChecklist = (id: string) => setChecklist((current) => current.map((item) => item.id === id ? { ...item, done: !item.done } : item));

  return <>
    <section className="commissioning-summary">
      <article><span className="summary-symbol blue"><CircuitBoard size={20} /></span><div><small>Equipo objetivo</small><strong>{device.model}</strong><p>Un CAM-5 · Unit ID {device.unitId}</p></div></article>
      <article><span className="summary-symbol green"><Database size={20} /></span><div><small>Mapa nativo</small><strong>{cam5RegisterCatalog.length} registros</strong><p>418–522 · FC03</p></div></article>
      <article><span className="summary-symbol amber"><AntennaBars5 size={20} /></span><div><small>Entradas asignadas</small><strong>{configuredInputs}/24</strong><p>12 temperatura · 4 UHF · 8 ambiente</p></div></article>
      <article><span className={`summary-symbol ${completedChecks === checklist.length ? "green" : "slate"}`}><ShieldCheck size={20} /></span><div><small>Preparación</small><strong>{completedChecks}/{checklist.length}</strong><p>{completedChecks === checklist.length ? "Lista para producción" : "Pendiente de conexión"}</p></div></article>
    </section>

    <article className="panel engineering-module">
      <div className="module-toolbar engineering-toolbar">
        <div className="module-tabs" role="tablist" aria-label="Puesta en marcha CAM-5">
          <button className={tab === "device" ? "active" : ""} onClick={() => setTab("device")}><CircuitBoard size={16} /> Equipo</button>
          <button className={tab === "inputs" ? "active" : ""} onClick={() => setTab("inputs")}><AntennaBars5 size={16} /> Entradas</button>
          <button className={tab === "alarms" ? "active" : ""} onClick={() => setTab("alarms")}><IconAlertTriangle size={16} /> Alarmas y relés</button>
          <button className={tab === "system" ? "active" : ""} onClick={() => setTab("system")}><Network size={16} /> Sistema</button>
          <button className={tab === "checklist" ? "active" : ""} onClick={() => setTab("checklist")}><ShieldCheck size={16} /> Cierre</button>
        </div>
        <span className="engineering-scope"><TopologyStar3 size={15} /> 1 ubicación · 1 gateway · 1 CAM-5</span>
      </div>

      {tab === "device" && <div className="engineering-content">
        <SectionHeading icon={<CircuitBoard size={22} />} eyebrow="Descubrimiento" title="Identidad y comunicación del CAM-5" detail="Contrato preparado para leer el equipo desde CAM5-GW-01 sin exponer escrituras directas desde Internet." />
        <div className="engineering-split">
          <div className="engineering-form-grid">
            <label><span>Modelo</span><select value={device.model} onChange={(event) => setDevice({ ...device, model: event.target.value })}><option>CAM5-TPH-XDCW</option><option>CAM5-TPH-ASSY</option><option>CAM5-TPS-ASSY</option><option>IRM-48 TPH</option></select></label>
            <label><span>Número de serie</span><input value={device.serial} onChange={(event) => setDevice({ ...device, serial: event.target.value })} /></label>
            <label><span>Firmware</span><input value={device.firmware} onChange={(event) => setDevice({ ...device, firmware: event.target.value })} /></label>
            <label><span>Versión de datos · registro 454</span><input value={device.dataVersion} onChange={(event) => setDevice({ ...device, dataVersion: event.target.value })} /></label>
            <label><span>IP del CAM-5/controlador</span><input value={device.controllerIp} onChange={(event) => setDevice({ ...device, controllerIp: event.target.value })} /></label>
            <label><span>Puerto / Unit ID</span><div className="paired-input"><input value={device.port} onChange={(event) => setDevice({ ...device, port: event.target.value })} /><input value={device.unitId} onChange={(event) => setDevice({ ...device, unitId: event.target.value })} /></div></label>
            <label><span>Intervalo de lectura</span><div className="input-unit"><input value={device.pollSeconds} onChange={(event) => setDevice({ ...device, pollSeconds: event.target.value })} /><b>s</b></div></label>
            <label><span>Timeout / reintentos</span><div className="paired-input"><input value={device.timeoutMs} onChange={(event) => setDevice({ ...device, timeoutMs: event.target.value })} /><input value={device.retries} onChange={(event) => setDevice({ ...device, retries: event.target.value })} /></div></label>
            <label className="engineering-span-2"><span>Convención de direcciones</span><select value={device.referenceMode} onChange={(event) => setDevice({ ...device, referenceMode: event.target.value })}><option>Registro nativo + referencia 400xxx</option><option>Solo registro nativo</option><option>Remapeo definido por gateway</option></select></label>
          </div>
          <aside className={`connection-contract connection-${connection}`}>
            <span><Router size={27} /></span><small>Ruta de adquisición</small><h3>CAM5 → CAM5-GW-01 → CORE</h3>
            <dl><div><dt>Lectura</dt><dd>FC03</dd></div><div><dt>Rango</dt><dd>418–522</dd></div><div><dt>Escritura</dt><dd>Bloqueada</dd></div><div><dt>Frescura</dt><dd>{alarmEngine.staleSeconds} s</dd></div></dl>
            <button onClick={testConnection} disabled={connection === "testing"}>{connection === "testing" ? <><Refresh className="spin" size={16} /> Preparando…</> : connection === "ready" ? <><Check size={16} /> Contrato validado</> : <><PlugConnected size={16} /> Validar contrato</>}</button>
          </aside>
        </div>
        <div className="capability-strip"><span><Check size={15} />12 temperaturas SAW</span><span><Check size={15} />4 interfaces UHF</span><span><Check size={15} />8 sensores ambientales</span><span><Check size={15} />6 salidas de relé</span></div>
        <div className="engineering-actions"><button className="primary-button" onClick={() => saveSection("Identidad del equipo")}><IconDeviceFloppy size={16} /> Guardar definición</button></div>
      </div>}

      {tab === "inputs" && <div className="engineering-content edge-to-edge-mobile">
        <div className="engineering-section-top">
          <SectionHeading icon={<AntennaBars5 size={22} />} eyebrow="Inventario de campo" title="24 entradas físicas" detail="Bandas, puertos, calibración e índices listos para ser completados durante la conexión." />
          <label className="engineering-filter"><span>Tipo</span><select value={inputFilter} onChange={(event) => { setInputFilter(event.target.value as typeof inputFilter); inputPage.setPage(1); }}><option>Todos</option><option>Temperatura SAW</option><option>Interfaz UHF</option><option>Humedad</option></select><ChevronDown size={13} /></label>
        </div>
        <div className="engineering-table-scroll"><div className="input-inventory-table">
          <div className="input-inventory-head"><span>Entrada</span><span>Ubicación</span><span>Registros</span><span>Asignación</span><span>Calibración</span><span>Señal</span></div>
          {inputPage.pageItems.map((input) => <div className="input-inventory-row" key={input.id}>
            <span><b>{input.id}</b><small>{input.kind}</small></span><span>{input.location}</span><span className="mono-data">{input.register}</span><span>{input.assignment}</span><span>{input.calibration}</span><span className={input.enabled ? input.signal.includes("Media") ? "quality-warning" : "quality-good" : "quality-muted"}><i />{input.signal}</span>
          </div>)}
        </div></div>
        <Pagination page={inputPage.page} totalPages={inputPage.totalPages} total={inputPage.total} pageSize={inputPage.pageSize} onPageChange={inputPage.setPage} itemLabel="entradas" />
        <div className="engineering-note"><InfoCircle size={17} /><p>Los códigos de calibración, bandas y puertos deben confirmarse físicamente. El frontend ya conserva estos campos; el backend recibirá el inventario mediante la API de configuración.</p></div>
      </div>}

      {tab === "alarms" && <div className="engineering-content">
        <SectionHeading icon={<IconAlertTriangle size={22} />} eyebrow="Motor de condición" title="Persistencia, recuperación y seis relés" detail="La interfaz refleja la lógica del CAM-5 y deja explícitas las reglas que deberá ejecutar el backend." />
        <div className="alarm-engine-grid">
          <label><span>Muestras para activar</span><input value={alarmEngine.activationSamples} onChange={(event) => setAlarmEngine({ ...alarmEngine, activationSamples: event.target.value })} /><small>Manual: tres lecturas consecutivas</small></label>
          <label><span>Muestras para recuperar</span><input value={alarmEngine.recoverySamples} onChange={(event) => setAlarmEngine({ ...alarmEngine, recoverySamples: event.target.value })} /><small>Evita oscilación de estado</small></label>
          <label><span>Dato vencido</span><div className="input-unit"><input value={alarmEngine.staleSeconds} onChange={(event) => setAlarmEngine({ ...alarmEngine, staleSeconds: event.target.value })} /><b>s</b></div><small>Calidad stale después del plazo</small></label>
          <label><span>Histéresis térmica</span><div className="input-unit"><input value={alarmEngine.thermalDeadband} onChange={(event) => setAlarmEngine({ ...alarmEngine, thermalDeadband: event.target.value })} /><b>°C</b></div><small>Margen de recuperación</small></label>
          <label><span>Histéresis humedad</span><div className="input-unit"><input value={alarmEngine.humidityDeadband} onChange={(event) => setAlarmEngine({ ...alarmEngine, humidityDeadband: event.target.value })} /><b>%RH</b></div><small>Margen de recuperación</small></label>
          <label><span>Histéresis UHF</span><div className="input-unit"><input value={alarmEngine.dischargeDeadband} onChange={(event) => setAlarmEngine({ ...alarmEngine, dischargeDeadband: event.target.value })} /><b>idx</b></div><small>Escala aproximada/no lineal</small></label>
        </div>
        <div className="relay-section-head"><div><small>SALIDAS FÍSICAS</small><h3>Matriz de relés</h3></div><span>6 disponibles</span></div>
        <div className="relay-grid">{relays.map((relay) => <article className={relay.state === "Activo" ? "relay-active" : ""} key={relay.id}>
          <div><span>R{relay.id}</span><button aria-label={`Cambiar estado del relé ${relay.id}`} onClick={() => setRelays((current) => current.map((item) => item.id === relay.id ? { ...item, state: item.state === "Activo" ? "Inactivo" : "Activo" } : item))}><i /></button></div>
          <strong>{relay.name}</strong><p>{relay.source}</p><small>{relay.level} · {relay.state}</small>
        </article>)}</div>
        <div className="engineering-actions"><button className="primary-button" onClick={() => saveSection("Lógica de alarmas y relés")}><IconDeviceFloppy size={16} /> Guardar reglas</button></div>
      </div>}

      {tab === "system" && <div className="engineering-content">
        <SectionHeading icon={<Network size={22} />} eyebrow="Sistema CAM-5" title="Red, reloj y ciclo de configuración" detail="Pantallas preparadas para consultar el equipo y desplegar cambios a través del gateway." />
        <div className="system-config-grid">
          <section><h3><Network size={17} /> Red del equipo</h3><div className="engineering-form-grid">
            <label><span>Dirección IP</span><input value={network.address} onChange={(event) => setNetwork({ ...network, address: event.target.value })} /></label>
            <label><span>Máscara</span><input value={network.subnet} onChange={(event) => setNetwork({ ...network, subnet: event.target.value })} /></label>
            <label><span>Gateway</span><input value={network.gateway} onChange={(event) => setNetwork({ ...network, gateway: event.target.value })} /></label>
            <label><span>DNS</span><input value={network.dns} onChange={(event) => setNetwork({ ...network, dns: event.target.value })} /></label>
            <label><span>MAC</span><input value={network.mac} onChange={(event) => setNetwork({ ...network, mac: event.target.value })} /></label>
            <label><span>NTP</span><input value={network.ntp} onChange={(event) => setNetwork({ ...network, ntp: event.target.value })} /></label>
            <label className="engineering-span-2"><span>Zona horaria</span><select value={network.timezone} onChange={(event) => setNetwork({ ...network, timezone: event.target.value })}><option>America/Santiago</option><option>UTC</option></select></label>
          </div></section>
          <section className="configuration-lifecycle"><h3><FileCode size={17} /> Configuración y respaldo</h3>
            <article><span><CloudUpload size={19} /></span><div><strong>Desplegar config.xml</strong><p>Validación, aprobación y envío seguro mediante el gateway.</p></div><button onClick={() => notify("Flujo de despliegue preparado; falta conectar el endpoint del gateway.", "info")}>Preparar</button></article>
            <article><span><Download size={19} /></span><div><strong>Crear respaldo</strong><p>Snapshot de parámetros, calibración y versión activa.</p></div><button onClick={() => notify("Solicitud de respaldo preparada para el backend.", "info")}>Solicitar</button></article>
            <article><span><Database size={19} /></span><div><strong>Captura y logs</strong><p>Inventario de archivos, descarga y retención auditada.</p></div><button onClick={() => notify("Gestor de archivos listo para recibir el catálogo del CAM-5.", "info")}>Revisar</button></article>
            <div className="write-safety"><ShieldCheck size={17} /><p><strong>Escritura protegida.</strong> Cambios de firmware, restauración y reinicio requerirán rol Administrador, doble confirmación y auditoría.</p></div>
          </section>
        </div>
        <div className="engineering-actions"><button className="primary-button" onClick={() => saveSection("Configuración de red y sistema")}><IconDeviceFloppy size={16} /> Guardar sistema</button></div>
      </div>}

      {tab === "checklist" && <div className="engineering-content">
        <SectionHeading icon={<ShieldCheck size={22} />} eyebrow="Control de entrega" title="Cierre de puesta en marcha" detail="Ninguna acción marca el equipo como productivo hasta validar cada punto con datos reales." />
        <div className="readiness-progress"><div><span style={{ width: `${Math.round(completedChecks / checklist.length * 100)}%` }} /></div><strong>{Math.round(completedChecks / checklist.length * 100)}%</strong><p>{completedChecks} de {checklist.length} controles completos</p></div>
        <div className="commissioning-checklist">{checklist.map((item) => <button className={item.done ? "done" : ""} key={item.id} onClick={() => toggleChecklist(item.id)}>
          <span>{item.done ? <Check size={17} /> : item.id === "identity" || item.id === "modbus" ? <PlugConnected size={17} /> : <ShieldCheck size={17} />}</span><div><strong>{item.label}</strong><small>Responsable: {item.owner}</small></div><b>{item.done ? "Validado" : "Pendiente"}</b>
        </button>)}</div>
        <div className="release-gate"><span className={completedChecks === checklist.length ? "ready" : "blocked"}>{completedChecks === checklist.length ? <Check size={20} /> : <IconAlertTriangle size={20} />}</span><div><small>GATE DE PRODUCCIÓN</small><h3>{completedChecks === checklist.length ? "Frontend listo para operar con datos reales" : "Conexión productiva bloqueada"}</h3><p>{completedChecks === checklist.length ? "Todos los controles de puesta en marcha fueron confirmados." : "Conecta el CAM-5 y completa las validaciones antes de habilitar decisiones operativas."}</p></div></div>
      </div>}

      <div className="register-reference-drawer">
        <div><Database size={17} /><span><strong>Catálogo de integración</strong><small>Mapa oficial incorporado al frontend</small></span></div>
        <label><span>Grupo</span><select value={registerFilter} onChange={(event) => { setRegisterFilter(event.target.value); registerPage.setPage(1); }}>{registerGroups.map((group) => <option key={group}>{group}</option>)}</select><ChevronDown size={12} /></label>
        <span className="register-drawer-count">{visibleRegisters.length} registros</span>
        <details><summary>Ver mapa 418–522</summary><div className="register-reference-scroll"><div className="register-reference-table">
          <div className="register-reference-head"><span>Nativo</span><span>Referencia</span><span>Variable</span><span>Tipo</span><span>Escala</span><span>Error</span></div>
          {registerPage.pageItems.map((register) => <div className="register-reference-row" key={register.register}><span>{register.register}</span><span>{register.reference}</span><span><strong>{register.description}</strong><small>{register.group} · {register.unit}</small></span><span>{register.dataType}</span><span>{register.scale}</span><span>{register.errorCode}</span></div>)}
        </div></div><Pagination page={registerPage.page} totalPages={registerPage.totalPages} total={registerPage.total} pageSize={registerPage.pageSize} onPageChange={registerPage.setPage} itemLabel="registros" /></details>
      </div>
    </article>
  </>;
}

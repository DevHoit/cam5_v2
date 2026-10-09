# HOIT Critical Infrastructure Platform
## Especificación funcional y técnica — Documento vivo

**Versión:** 0.11  
**Fecha:** 2026-10-07  
**Estado:** Backend + Frontend V1 listos para E2E de gateway y corte productivo  
**Origen:** Evolución de la plataforma HOIT/CAM5

---

## 0. Criterio de uso de este documento

Este archivo Markdown será la **fuente de verdad funcional/técnica** del proyecto.  
Los PDF/Word que se generen en el futuro serán derivados de este documento y no documentos maestros.

Convenciones:

- `DECISION`: decisión cerrada.
- `PENDING`: definición pendiente.
- `V1`: requerido para primera versión productiva.
- `V2`: evolución posterior.
- `NOTE`: observación de ingeniería.
- `IMPLEMENTED`: implementado en la rama `feature/hoit-core-v1` y cubierto por pruebas automatizadas.
- `PARTIAL`: implementado parcialmente; conserva pendientes explícitos.

---

## 0.1 Estado de implementación — 2026-10-07

Esta versión incorpora el estado real del repositorio `DevHoit/cam5_v2`, rama `feature/hoit-core-v1`. El documento continúa siendo la fuente de verdad funcional/técnica; las notas `IMPLEMENTED` y `PARTIAL` indican el grado de materialización del diseño sin reemplazar las decisiones funcionales originales.

`IMPLEMENTED`:

- jerarquía multi-tenant `Tenant/Client -> Site -> Area -> Asset -> Device/Gateway`, incluyendo guards de base de datos para impedir relaciones cruzadas entre tenants/sites;
- RBAC con `platform_admin`, `client_admin`, `site_admin`, `engineer`, `operator`, `viewer`;
- catálogo de métricas y telemetría normalizada para PM5560, DSE8660 y Eddystone TLM;
- contratos Gateway -> Cloud para config, heartbeat e ingest, manteniendo compatibilidad controlada con contratos previos;
- control plane genérico con transportes `modbus_rtu`, `modbus_tcp` y `ble`; Modbus TCP entrega `host`, `port`, `unit_id`, `timeout_ms` y `retries` sin recompilar firmware;
- ingest genérico conectado al Rule Engine para evaluar reglas aplicables al `tenant/site/area/asset/device` afectado por cada muestra;
- identidad explícita de buses RS-485 y puerto Linux de cada binding;
- Rule Engine V1 seguro para comparaciones y composición booleana, con duración y scopes;
- lifecycle de alarmas, mantenimiento, escalamiento persistente, turnos/on-call y resolución de destinatarios;
- Notification Service con email y adapter Meta WhatsApp Cloud API;
- persistencia separada de `sent`, `delivered`, `read` y `ack`;
- webhook de WhatsApp con verificación de firma, idempotencia, correlación por mensaje, validación de teléfono autorizado, ACK, `AlarmTransition` y audit trail;
- reportes, históricos, módulos eléctricos/ATS/cadena de frío y ciclo operacional independiente de Vercel;
- contrato HOIT V1 de ingest estrictamente normalizado: Cloud rechaza campos de protocolo/registro fuera del envelope y `metrics`;
- UI de Operación con NOC consolidado, ventanas de mantenimiento y turnos/on-call conectados al backend;
- administración de asignaciones on-call por usuario, vigencia y prioridad, con prevención de solapamientos ambiguos y audit trail;
- NOC por sitio con alarmas activas, salud de gateways/dispositivos, mantenimiento y cobertura on-call en una sola vista;
- administración de políticas de escalamiento Core multinivel: demora, destinatario `user`/`role`/`on_call_group`, canales Email/WhatsApp, habilitación y audit trail.
- Frontend UX 2.0 orientado a operación y multi-dispositivo: Dashboard consolidado por cliente, navegación por tareas, contexto `Cliente -> Sitio -> Activo`, resumen de activo y herramientas técnicas desacopladas de la navegación principal;
- ficha universal de activo para PM/ATS/cadena de frío construida sobre `/api/v1/telemetry/metrics/latest`, con dispositivos, calidad/frescura y métricas normalizadas; CAM5 mantiene su visualización especializada;
- Dashboard de cartera con condición de activos, alertas, salud de adquisición, mantenimiento, cobertura on-call, resumen por sitio, activos prioritarios y eventos relevantes;
- workspace de Ingeniería sensible al tipo/capabilities del activo; PM5560, DSE8660, CAM5 y BLE dejan de ser destinos principales de navegación y pasan a ser implementaciones/capacidades contextuales;
- terminología operacional normalizada a Activo / Dispositivo / Métrica; detalles de protocolo, registros y decodificación quedan restringidos al workspace técnico;
- separación UX explícita entre reglas de entrega de notificaciones y políticas de escalamiento operativo multinivel.

`PARTIAL`:

- histéresis y calendario del Rule Engine: los campos existen, pero su contrato JSON/semántica aún no está congelado; el motor falla cerrado cuando aparecen;
- `repeat_count > 1` en escalamiento: falta definir intervalo/semántica de repetición;
- Meta Business, número real, credenciales y templates aprobados: integración implementada, habilitación productiva externa pendiente;
- HOIT Gateway Agent Linux: núcleo de control y Store & Forward `IMPLEMENTED`; adquisición física PM5560/DSE/Eddystone y validación prolongada en hardware siguen `PENDING`;
- E2E productivo con gateway físico MDM9607 enviando telemetría simulada a HoitLive Core: `PENDING` antes del merge a `main`.

---

# 1. Objetivo

Construir una plataforma SaaS multi-tenant para monitoreo de infraestructura crítica capaz de integrar dispositivos de distintos fabricantes mediante gateways HOIT Linux, normalizando variables comunes y conservando capacidades específicas por equipo.

La plataforma deberá soportar:

- telemetría eléctrica;
- estados operacionales;
- cadena de frío;
- alarmas configurables;
- escalamiento;
- ACK;
- mantenimiento;
- históricos;
- reportes;
- audit trail;
- monitoreo de salud de gateways/dispositivos;
- API de integración.

---

# 2. Alcance V1

| Equipo | Cantidad | Integración |
|---|---:|---|
| Schneider PM5560 | 2 | RS-485 / Modbus RTU, un gateway por PM |
| DSE8660 MKII | 2 | RS-485 / Modbus RTU/GenComm, ambos en un gateway compartido |
| Sensor temperatura BLE | 2 | Eddystone TLM, un gateway BLE |
| Cámara de frío | 1 | Asset lógico que agrupa ambos sensores |
| UPS | 0 | V2 |
| Usuarios iniciales | <= 20 | RBAC |

`DECISION` El producto debe ser replicable y multi-tenant desde V1.

---

# 3. Arquitectura física V1

```text
                         HOIT CLOUD
                             |
              HTTPS / Internet / 4G
                             |
       +-----------+---------+---------+------------+
       |           |                   |            |
    GW-PM01     GW-PM02             GW-DSE       GW-TEMP
       |           |                   |            |
     RS485       RS485               RS485          BLE
       |           |                /     \        /   \
     PM-01       PM-02           DSE-01 DSE-02  T-01 T-02
```

`DECISION` Todos los gateways utilizarán la misma base de software **HOIT Gateway Agent**.

---

# 4. Modelo de dominio

```text
Tenant
└── Site
    └── Area
        └── Asset
            ├── Device
            └── Gateway
```

Ejemplo:

```text
FALP
└── Sede
    ├── Sala eléctrica
    │   ├── PM-01
    │   ├── PM-02
    │   ├── DSE-01
    │   └── DSE-02
    └── Cámara 01
        ├── TEMP-01
        └── TEMP-02
```

`DECISION` **Asset**, **Device** y **Gateway** son entidades diferentes.

---

# 5. Evolución de CAM5 hacia HOIT

CAM5 no será el dominio central de la solución.

```text
HOIT Platform
├── CAM5
├── PM5560
├── DSE8660
├── BLE Temperature
└── UPS [V2]
```

`DECISION` CAM5 pasa a ser una familia/driver dentro de HOIT.

---

# 6. HOIT Gateway Agent

Plataforma:

- Open Linux.
- Mismo hardware utilizado por CAM5.
- 1 puerto RS-485.
- Ethernet.
- Wi-Fi.
- 4G.
- Bluetooth/BLE.
- Sin RTC.
- Rango de alimentación: `PENDING`.

## 6.1 Módulos

```text
hoit-agent
├── device_manager
├── drivers
│   ├── cam5
│   ├── pm5560
│   ├── dse8660
│   └── ble_eddystone_tlm
├── protocols
│   ├── modbus_rtu
│   └── ble
├── normalization
├── local_store
├── sync_engine
├── health_monitor
├── connectivity_manager
├── watchdog
└── cloud_client
```

## 6.2 Responsabilidades

- cargar configuración;
- adquirir telemetría;
- normalizar datos;
- validar calidad/frescura;
- almacenar localmente;
- retransmitir después de cortes;
- reportar salud;
- recuperar conectividad;
- mantener logging local.

## 6.3 Estado de implementación — 2026-10-03

`IMPLEMENTED` en `feature/hoit-core-v1` para el núcleo del agente:

- daemon Linux administrable por `systemd`;
- `cloud_client` para config, ingest y heartbeat V1;
- cache local de la última configuración válida y arranque offline con esa configuración;
- `local_store` SQLite con WAL y `synchronous=FULL`;
- Store & Forward durable antes del primer intento de upload;
- preservación exacta de `message_id`, `boot_id`, `sequence`, timestamps y payload durante reintentos/restarts;
- retry con backoff para red, `429` y `5xx`;
- dead-letter explícito para errores contractuales `4xx`;
- capacidad de buffer medible y rechazo explícito cuando se alcanza el límite configurado, evitando pérdida silenciosa;
- retención acotada de registros terminales ya enviados/dead-letter;
- detección conservadora de `time_quality` usando sincronización NTP del sistema;
- health de CPU, memoria, disco, buffer y estado por device;
- `device_manager` con estados `ONLINE`, `DEGRADED`, `OFFLINE`, `UNKNOWN`;
- superficie plug-in para drivers;
- transporte Modbus RTU V1 read-only con FC03/FC04, CRC16, excepciones y validación de frames;
- tests automatizados de cache offline, persistencia tras restart, retry idempotente, overflow, health y Modbus RTU.

`PARTIAL`: conectividad Ethernet/Wi-Fi/4G se refleja de forma básica; selección de interfaz, RSSI real, watchdog de hardware y recuperación avanzada quedan pendientes de hardware objetivo.

`PENDING`: drivers físicos PM5560, DSE8660 MKII y BLE Eddystone TLM. No se incorporan mapas de registros no verificados.

`DECISION` El desarrollo del Gateway queda **congelado temporalmente**. Se completarán primero Backend y Frontend; la integración física del Gateway se retomará como fase final.

---

# 7. Tiempo y almacenamiento offline

El gateway no posee RTC.

Cada dato deberá incluir:

```text
gateway_id
boot_id
sequence_number
message_id
device_id
timestamp
time_quality
```

`time_quality`:

- `SYNCED`
- `ESTIMATED`
- `UNSYNCED`

`DECISION` Nunca presentar una hora reconstruida como si fuera una hora sincronizada.

## 7.1 Store & Forward

```text
adquisición
   |
persistencia local
   |
pending_upload = true
   |
upload
   |
ACK cloud
   |
pending_upload = false
```

`DECISION` Los reintentos deben ser idempotentes.

`NOTE` No se utiliza la expresión contractual "cero pérdida de datos"; se especificará capacidad medible de buffer y recuperación.

`IMPLEMENTED` El agente persiste cada envelope V1 en SQLite antes de transmitirlo. Los reintentos conservan el payload original incluso después de reiniciar el proceso. Errores transitorios permanecen en cola; errores contractuales se mueven a dead-letter para diagnóstico. El buffer tiene un límite configurable y, al agotarse, el agente falla de forma explícita en lugar de descartar telemetría silenciosamente.

`NOTE` La validación actual es automatizada. La capacidad efectiva en horas y el comportamiento ante cortes prolongados deben medirse en el hardware gateway real antes de declarar Store & Forward productivo de campo.

---

# 8. PM5560

## 8.1 Variables comunes

- tensiones L-N;
- tensiones L-L;
- corriente por fase;
- kW;
- kVA;
- kVAr;
- PF;
- Hz.

## 8.2 Variables específicas

- energía;
- demanda;
- THD;
- armónicos;
- diagnósticos disponibles.

`DECISION` Driver de solo lectura en V1.

`NOTE` No inferir microcortes o transitorios subsegundo únicamente mediante polling Modbus.

---

# 9. DSE8660 MKII

## 9.1 Variables comunes

- tensiones;
- corrientes;
- kW;
- kVA;
- kVAr;
- PF;
- frecuencia.

## 9.2 Variables específicas

- disponibilidad mains/bus;
- estados de breakers;
- modo del controlador;
- sincronización;
- alarmas;
- warnings/faults;
- eventos disponibles.

`DECISION` Ambos DSE podrán compartir un bus RS-485 utilizando mismos parámetros seriales e IDs únicos.

`PENDING` Mapa definitivo oficial de registros.

`PENDING` Unilineal/función real de cada DSE para construir el sinóptico.

`DECISION` Solo lectura en V1.

---

# 10. Sensores BLE

Características conocidas:

- BLE 5.0;
- nRF528xx;
- -40 °C a +70 °C;
- precisión declarada ±0,3 °C;
- ER14505 3,6 V / 2600 mAh;
- broadcast por defecto 1 s;
- Eddystone UID/URL/TLM;
- Ksensor;
- OTA disponible.

## 10.1 Protocolo seleccionado

`DECISION` La adquisición V1 utilizará **Eddystone TLM**, ya validado en terreno.

No se requiere conexión BLE persistente.

```text
TEMP-01 ─┐
         ├── BLE advertisements ──> Gateway ──> Normalización
TEMP-02 ─┘
```

Datos objetivo:

- temperatura;
- battery voltage;
- RSSI;
- last_seen;
- advertising counter / uptime cuando resulte útil.

`NOTE` RSSI será indicador de calidad de enlace, no distancia.

## 10.2 Salud del sensor

Estados sugeridos:

- ONLINE
- DEGRADED
- OFFLINE
- UNKNOWN

Reglas:

- sensor no visto durante X segundos;
- batería baja;
- RSSI degradado;
- diferencia entre sensores superior a X °C durante Y minutos.

---

# 11. Cámara de frío

Setpoint de referencia:

```text
-18 °C
```

`PENDING` Rango operativo y límites de alarma definitivos.

Los límites deben ser configurables:

- warning low;
- critical low;
- warning high;
- critical high;
- duración;
- histéresis.

La vista de usuario se organiza por **Cámara 01**, no por identificadores BLE.

Datos:

- TEMP-01;
- TEMP-02;
- mínimo;
- máximo;
- promedio;
- tendencia;
- excursiones;
- tiempo fuera de rango;
- MKT;
- batería;
- RSSI;
- estado del sensor.

---

# 12. Modelo normalizado

## 12.1 Eléctrico común

```text
electrical.voltage.l1_n
electrical.voltage.l2_n
electrical.voltage.l3_n
electrical.voltage.l1_l2
electrical.voltage.l2_l3
electrical.voltage.l3_l1

electrical.current.l1
electrical.current.l2
electrical.current.l3

electrical.power.active.total
electrical.power.reactive.total
electrical.power.apparent.total

electrical.power_factor
electrical.frequency
```

## 12.2 Específicos

PM:

```text
electrical.energy.*
electrical.demand.*
electrical.thd.*
electrical.harmonics.*
```

DSE:

```text
ats.mains.*
ats.bus.*
ats.breaker.*
ats.sync.*
dse.mode
dse.alarm.*
```

BLE:

```text
environment.temperature
sensor.battery_voltage
sensor.rssi
sensor.last_seen
```

`DECISION` El frontend se construye a partir de **capabilities**, no de condiciones rígidas por fabricante.

---

# 13. Frecuencias iniciales

| Grupo | Frecuencia |
|---|---:|
| V / A / kW | 1 s gateway |
| Hz / PF / kVA / kVAr | 1-2 s |
| DSE states | 1 s |
| BLE scan | continuo; advertisement ~1 s || Upload cloud | 5 s nominal |
| Energía / demanda | 30-60 s |
| THD | 10-30 s |
| Armónicos | bajo demanda o 1-5 min |

---

# 14. Motor de alarmas

```text
Telemetry
   ↓
Rule Engine
   ↓
Alarm Engine
   ↓
Escalation Engine
   ↓
Notification Engine
   ├── WhatsApp
   └── Email
```

## 14.1 Reglas

Deben soportar:

- variable;
- operador;
- umbral;
- duración;
- histéresis;
- severidad;
- scope;
- calendario;
- condiciones booleanas.

Ejemplo:

```text
IF environment.temperature > -15
FOR 300 seconds
THEN CRITICAL
```

Ejemplo combinado:

```text
IF electrical.voltage.l1_n < 50
AND ats.mains.available == false
FOR 15 seconds
THEN CRITICAL
```

## 14.2 Estados de alarma

```text
ACTIVE
ACKNOWLEDGED
RESOLVED
CLOSED
SUPPRESSED
```

`DECISION` ACK no significa resolución.

Indicadores:

- MTTA;
- MTTR.

---

# 15. Escalamiento

Ejemplo:

```text
Nivel 1 → Técnico de turno
5 min sin ACK
Nivel 2 → Supervisor
5 min sin ACK
Nivel 3 → Jefatura
```

Los tiempos y destinatarios serán configurables.

---

# 16. WhatsApp

## 16.1 Arquitectura seleccionada

`RECOMMENDATION` Integración directa con **Meta WhatsApp Cloud API**, evitando agregar un intermediario si HOIT puede administrar su propia cuenta Meta Business.

```text
Alarm Engine
    |
Notification Service
    |
Meta WhatsApp Cloud API
    |
WhatsApp usuario
    |
Quick Reply: ACK
    |
Meta Webhook
    |
HOIT Notification Webhook
    |
Alarm Engine
```

## 16.2 Mensaje de alerta

El mensaje debe contener:

- severidad;
- instalación;
- asset;
- descripción;
- valor;
- límite;
- duración;
- hora;
- identificador de alarma;
- acción `ACK`;
- acceso al detalle en HOIT cuando corresponda.

Ejemplo conceptual:

```text
ALERTA CRÍTICA

Cámara: Cámara 01
Temperatura: -12,8 °C
Límite: -15 °C
Duración: 5 min
Hora: 14:32

Alarma: ALM-000184

[ ACK ]
[ Ver detalle ]
```

## 16.3 ACK

`DECISION` El ACK debe provenir de una interacción verificable:

1. Quick Reply `ACK` recibido por webhook, o
2. link autenticado/firmado hacia HOIT.

No se considerará `delivered` o `read` como ACK.

## 16.4 Persistencia de notificaciones

Guardar:

```text
notification_id
alarm_id
channel
recipient_user_id
recipient_address
provider
provider_message_id
template_name
sent_at
delivered_at
read_at
failed_at
ack_at
provider_status
error_code
attempt
```

## 16.5 Webhooks

El endpoint deberá procesar:

- mensajes entrantes;
- quick replies;
- sent;
- delivered;
- read;
- failed.

Debe ser:

- HTTPS;
- idempotente;
- tolerante a eventos repetidos;
- desacoplado mediante cola/job para procesamiento posterior.

---

# 17. Email

Canal secundario V1.

Debe usar el mismo `Notification Service`.

```text
Alarm
   |
Notification Service
   ├── whatsapp_provider
   └── email_provider
```

La lógica de escalamiento no debe estar implementada dentro del proveedor de WhatsApp ni email.

---

# 18. Mantenimiento

La telemetría continúa durante mantenimiento.

Se suprimen notificaciones según scope y período.

Campos:

```text
scope
start_at
end_at
reason
created_by
```

`DECISION` La condición puede seguir quedando registrada como `SUPPRESSED`.

---

# 19. Arquitectura de información del Frontend

`DECISION` La navegación de HOIT se organiza por **tarea operacional y alcance**, no por fabricante, protocolo ni modelo de dispositivo.

Jerarquía visible:

```text
Cliente
└── Sitio
    └── Activo
        └── Dispositivo
            └── Capacidad
                └── Métrica
```

## 19.1 Navegación principal

```text
Inicio
└── Dashboard

Supervisión
├── Resumen del activo
└── Tendencias

Operación
├── NOC y continuidad
├── Centro de alertas
├── Histórico
└── Reportes

Administración
├── Organización y activos
├── Notificaciones
├── Usuarios y roles
└── Ingeniería
```

`DECISION` PM5560, DSE8660, CAM5, BLE y futuros modelos **no** son módulos principales del menú.

## 19.2 Dashboard

El Dashboard principal opera a alcance **Cliente** y debe responder “¿cómo está toda mi operación?”.

Debe consolidar como mínimo:

- sitios y activos;
- condición de activos;
- alertas críticas y warning;
- gateways/dispositivos con problemas de adquisición;
- mantenimiento activo/próximo;
- cobertura on-call;
- activos que requieren atención;
- eventos relevantes por sitio.

En Dashboard, el encabezado muestra sólo el contexto Cliente. Sitio y Activo aparecen al entrar a supervisión u operación contextual.

## 19.3 Resumen del activo

El Dashboard anterior centrado en un punto pasa a ser **Resumen del activo**.

Debe mostrar:

- condición global;
- métricas normalizadas;
- frescura/calidad;
- alarmas activas;
- tendencias;
- salud de adquisición;
- accesos a capacidades disponibles para ese activo.

`DECISION` El frontend presenta capacidades contextuales. La navegación base no cambia cuando se agrega un nuevo fabricante.

Ejemplos:

```text
Activo eléctrico
└── capacidad: electrical

ATS
└── capacidad: automatic_transfer

Cámara de frío
└── capacidad: cold_chain

Transformador instrumentado
├── capability: temperature
├── capability: humidity
└── capability: partial_discharge
```

## 19.4 Ingeniería

Las funciones de bajo nivel se agrupan en un workspace **Ingeniería** visible sólo para perfiles autorizados.

Incluye, según el activo:

- configuración avanzada;
- diagnóstico;
- puesta en marcha;
- gateways/credenciales;
- inventario de dispositivos;
- decodificación técnica cuando corresponda.

`DECISION` Modbus, registros, function codes, RS-485, baud rate, endian, raw values y demás detalles físicos **no deben aparecer en la experiencia operacional normal**. Pueden existir en Ingeniería mientras el Gateway/driver correspondiente requiera administración técnica.

## 19.5 Notificaciones y escalamiento

`DECISION` Se distinguen dos conceptos:

- **Reglas de entrega**: qué alarma/evento se envía por qué canal, filtros, demora y reintento de entrega;
- **Políticas de escalamiento**: secuencia multinivel de destinatarios/on-call ante ausencia de ACK.

No deben presentarse al usuario como dos módulos llamados “Escalamiento”.

## 19.6 Principios UX

- estados siempre distinguen `offline`, `stale`, `unknown/error`, `warning`, `critical` y `normal`;
- no declarar un dispositivo offline cuando sólo falló la consulta del portal;
- ocultar funciones sin permiso cuando no aporten valor de lectura;
- minimizar información de implementación en pantallas operacionales;
- mantener color + texto/icono para no depender sólo del color;
- conservar trazabilidad y acciones críticas explícitas;
- soportar desktop operativo y responsive móvil/tablet;
- evitar crecimiento del sidebar al agregar nuevas familias de dispositivos.

---

# 20. Roles

| Rol | Alcance |
|---|---|
| Super Admin HOIT | Total |
| Admin Cliente | usuarios, turnos, reportes, mantenimiento, límites autorizados |
| Operador Técnico | eléctrico, DSE, alarmas, ACK |
| Farmacia / Clínico | cadena de frío, alarmas asociadas, históricos, reportes |

---

# 21. Reportes

## PDF

Reporte ejecutivo:

- disponibilidad;
- alarmas;
- MTTA/MTTR;
- eventos;
- temperaturas;
- excursiones;
- MKT;
- estado general.

## Excel

Detalle:

- Resumen;
- Mediciones;
- Alarmas;
- Eventos;
- Temperaturas;
- Energía;
- Audit Trail.

`DECISION` Un Excel/CSV no se denominará "inalterable". La integridad podrá verificarse mediante hash, identificador y audit trail.

---

# 22. IoT Health

Por gateway:

- online;
- heartbeat;
- uptime;
- versión;
- buffer;
- 4G RSSI;
- conectividad;
- RS-485;
- BLE;
- almacenamiento.

Por device:

- ONLINE;
- DEGRADED;
- OFFLINE;
- UNKNOWN;
- latency;
- last_seen;
- last_valid_sample.

`DECISION` `0 V` y `no communication` son estados conceptualmente diferentes.

---

# 23. API base

Contratos propuestos:

```text
GET  /api/v1/gateway/config
POST /api/v1/gateway/heartbeat
POST /api/v1/gateway/ingest
POST /api/v1/gateway/events

GET  /api/v1/devices
GET  /api/v1/devices/{id}
GET  /api/v1/measurements

GET  /api/v1/alarms
POST /api/v1/alarms/{id}/ack
POST /api/v1/alarms/{id}/resolve

POST /api/v1/webhooks/whatsapp

GET  /api/v1/reports
POST /api/v1/reports
```

`PENDING` Contrastar estos endpoints con CAM5 antes de congelar nombres.

---

# 24. Entidades de backend

```text
Tenant
Site
Area
Asset
Gateway
Device
Capability
Measurement
Event
Rule
Alarm
AlarmTransition
MaintenanceWindow
Shift
OnCallAssignment
Notification
User
Role
AuditEntry
Report
```

---

# 25. Seguridad

- TLS.
- Token/identidad independiente por gateway.
- RBAC.
- aislamiento tenant.
- password hashing.
- session management.
- rate limiting.
- validación estricta de payloads.
- audit trail.
- solo lectura PM/DSE en V1.

---

# 26. MVP

Incluye:

- PM5560;
- DSE8660;
- Eddystone TLM;
- multi-tenant;
- dashboards;
- históricos;
- reglas;
- WhatsApp + email;
- ACK;
- escalamiento;
- mantenimiento;
- turnos;
- gateway health;
- Store & Forward;
- PDF ejecutivo;
- Excel detallado;
- audit trail;
- API.

V2:

- UPS;
- mapas térmicos;
- OTA completa;
- BMS avanzado;
- rule builder avanzado;
- capacidades ampliadas de power quality.

---

# 27. Pendientes

| Pendiente | Impacto | Estado 2026-10-03 |
|---|---|---|
| Registro oficial DSE definitivo | driver físico | `PENDING` |
| Unilineal eléctrico | sinóptico | `PENDING` |
| Alimentación exacta gateway | instalación | `PENDING` |
| Umbrales definitivos cámara | reglas por defecto | `PENDING` |
| Política retención | dimensionamiento | `PENDING` |
| Meta Business / número WhatsApp / templates aprobados | habilitación productiva WhatsApp | `PENDING` externo; adapter y webhook `IMPLEMENTED` |
| Contrato de histéresis del Rule Engine | evaluación de reglas | `PENDING` |
| Semántica/calendario de `schedule_id` | evaluación de reglas | `PENDING` |
| Intervalo para `repeat_count > 1` | escalamiento repetido | `PENDING` |
| HOIT Gateway Agent Linux | adquisición / Store & Forward | núcleo `IMPLEMENTED`; hardware/soak `PARTIAL` |
| Drivers físicos PM5560/DSE/Eddystone en Gateway Agent | integración de campo | `PENDING`; Modbus RTU base `IMPLEMENTED` |
| Auditoría/refactor final de código CAM5 remanente | deuda técnica | `PARTIAL` |

---

# 28. Próximo trabajo

Estado del orden original:

1. auditar repositorio CAM5 actual — `PARTIAL`;
2. crear matriz `reuse / refactor / replace / new` — `PARTIAL`;
3. congelar modelo de datos Core V1 — `IMPLEMENTED` para jerarquía, métricas, reglas, alarmas, mantenimiento, turnos, escalamiento y notificaciones; quedan contratos puntuales indicados en §27;
4. congelar contrato Gateway ↔ Cloud — `IMPLEMENTED` para config/heartbeat/ingest V1 con compatibilidad CAM5;
5. implementar/generalizar HOIT Gateway Agent — núcleo/control plane/Store & Forward `IMPLEMENTED`; conectividad/hardware `PARTIAL`;
6. implementar drivers PM/DSE/Eddystone productivos — `PENDING`;
7. implementar pipeline cloud de ingesta — `IMPLEMENTED`;
8. implementar Alarm/Rule Engine — `PARTIAL`: comparación, booleanos, duración, scopes y lifecycle implementados; histéresis/calendario pendientes;
9. implementar Notification Service + WhatsApp — `IMPLEMENTED` en backend; habilitación Meta productiva pendiente;
10. construir vistas — `PARTIAL`; existen vistas eléctricas, ATS, cadena de frío, reportes, notificaciones y administración, faltan módulos operacionales completos;
11. pruebas end-to-end — `IMPLEMENTED` para flujos Core disponibles y continúa ampliándose;
12. despliegue piloto — `PENDING`.

Prioridad inmediata actualizada:

1. estabilizar CI y mantener migraciones automáticas verdes;
2. cerrar administración de plataforma: cliente, sitio, usuarios, roles y alcances;
3. UI Operación: Mantenimiento, Turnos y NOC — `IMPLEMENTED` base; falta refinamiento E2E de asignaciones y políticas;
4. administración de políticas/escalamiento multinivel — `IMPLEMENTED` base; resolver semántica de repetición `repeat_count > 1` y vinculación visual avanzada con reglas genéricas;
5. congelar contrato faltante de histéresis, calendario de reglas y repetición de escalamiento;
6. habilitar Meta Business real y templates;
7. cerrar pruebas E2E de Backend + Frontend y dejar portal listo para piloto;
8. **recién entonces** retomar integración Gateway: PM5560, DSE8660, BLE, conectividad/watchdog y soak test;
9. ejecutar piloto end-to-end con hardware real.

---

# 29. ADR — Decisiones registradas

- **ADR-001:** HOIT es el producto; CAM5 es un driver/familia.- **ADR-002:** modelo común + capabilities.
- **ADR-003:** multi-tenant desde V1.
- **ADR-004:** PM/DSE read-only en V1.
- **ADR-005:** reglas con duración e histéresis.
- **ADR-006:** ACK y RESOLVED son conceptos distintos.
- **ADR-007:** mantenimiento no detiene telemetría.
- **ADR-008:** PDF ejecutivo / Excel detallado.
- **ADR-009:** sin RTC se registra calidad temporal.
- **ADR-010:** Store & Forward medible, no promesa absoluta de cero pérdida.
- **ADR-011:** sensor BLE V1 mediante Eddystone TLM.
- **ADR-012:** WhatsApp desacoplado mediante Notification Service.
- **ADR-013:** el Gateway encapsula todos los protocolos físicos; Backend recibe sólo JSON normalizado y protocol-agnostic.
- **ADR-014:** Backend + Frontend se completan antes de retomar la integración física del Gateway.


---

# 30. Modelo de datos V1

## 30.1 Objetivo

El modelo debe permitir:

- multi-tenant;
- múltiples sedes y áreas;
- activos con uno o más dispositivos;
- dispositivos asociados a uno o más gateways;
- métricas normalizadas;
- telemetría histórica;
- estados y eventos;
- reglas de alarma;
- alarmas con ciclo de vida;
- notificaciones y escalamiento;
- mantenimiento;
- turnos;
- auditoría;
- crecimiento futuro sin rediseñar el esquema base.

`DECISION` La base de datos operacional debe modelar explícitamente **configuración**, **telemetría**, **eventos** y **auditoría** como dominios separados.

---

## 30.2 Diagrama lógico simplificado

```text
Tenant
 ├── Site
 │    └── Area
 │         └── Asset
 │              └── Device
 │                   ├── DeviceCapability
 │                   └── Measurement
 │
 ├── Gateway
 │    └── GatewayDeviceBinding
 │
 ├── Rule
 │    └── Alarm
 │         ├── AlarmTransition
 │         └── Notification
 │
 ├── MaintenanceWindow
 ├── Shift
 │    └── OnCallAssignment
 │
 ├── User
 │    └── UserRole
 │
 └── AuditEntry
```

---

# 31. Entidades principales

## 31.1 tenant

Representa un cliente lógico de HOIT.

```text
id                  UUID PK
code                VARCHAR UNIQUE
name                VARCHAR
status              ENUM(active, suspended, archived)
timezone            VARCHAR
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
```

Notas:

- `timezone` se utiliza para presentación y calendarios.
- Todos los timestamps persistidos deben mantenerse en UTC.
- Ningún usuario de un tenant debe acceder a datos de otro tenant.

## 31.2 site

```text
id                  UUID PK
tenant_id           UUID FK -> tenant
code                VARCHAR
name                VARCHAR
timezone            VARCHAR NULL
status              ENUM(active, inactive)
metadata            JSONB
created_at
updated_at
```

Índice:

```text
UNIQUE (tenant_id, code)
```

## 31.3 area

```text
id                  UUID PK
tenant_id           UUID FK
site_id             UUID FK
parent_area_id      UUID NULL FK -> area
code
name
type                VARCHAR
metadata            JSONB
created_at
updated_at
```

## 31.4 asset

```text
id                  UUID PK
tenant_id           UUID FK
site_id             UUID FK
area_id             UUID FK
code
name
asset_type          VARCHAR
status              ENUM(active, maintenance, inactive)
metadata            JSONB
created_at
updated_at
```

`DECISION` Las alarmas de negocio deben poder apuntar a `asset_id`, aunque la medición provenga de uno o más devices.

## 31.5 gateway

```text
id                  UUID PK
tenant_id           UUID FK
site_id             UUID FK
code                VARCHAR
serial_number       VARCHAR NULL
hardware_model      VARCHAR
software_version    VARCHAR
status              ENUM(online, degraded, offline, unknown)
last_heartbeat_at   TIMESTAMPTZ NULL
last_ip             INET NULL
config_version      INTEGER
metadata            JSONB
created_at
updated_at
```

`DECISION` El gateway debe tener identidad propia, independiente de cualquier usuario.

## 31.6 device

```text
id                  UUID PK
tenant_id           UUID FK
site_id             UUID FK
area_id             UUID FK NULL
asset_id            UUID FK NULL
code                VARCHAR
manufacturer        VARCHAR
model               VARCHAR
device_type         VARCHAR
driver              VARCHAR
protocol            VARCHAR
status              ENUM(online, degraded, offline, unknown)
enabled             BOOLEAN
metadata            JSONB
created_at
updated_at
```

Ejemplos:

```text
device_type = power_meter
driver      = pm5560
protocol    = modbus_rtu

device_type = ats_controller
driver      = dse8660
protocol    = modbus_rtu

device_type = temperature_sensor
driver      = ble_eddystone_tlm
protocol    = ble
```

## 31.7 gateway_device_binding

```text
id                  UUID PK
tenant_id           UUID FK
gateway_id          UUID FK
device_id           UUID FK
interface_type      ENUM(rs485, ble, ethernet, wifi, virtual)
enabled             BOOLEAN
config              JSONB
created_at
updated_at
```

Ejemplo PM5560:

```json
{
  "port": "/dev/ttyS1",
  "baud": 19200,
  "parity": "E",
  "stop_bits": 1,
  "slave_id": 1,
  "poll_profile": "pm5560_default"
}
```

Ejemplo DSE:

```json
{
  "port": "/dev/ttyS1",
  "baud": 19200,
  "parity": "N",
  "stop_bits": 1,
  "slave_id": 2,
  "poll_profile": "dse8660_default"
}
```

Ejemplo BLE:

```json
{
  "identity": {
    "namespace_id": "6B6B6D636E2E636FD01",
    "instance_id": "000000000001"
  },
  "protocol": "eddystone_tlm"
}
```

---

# 32. Métricas y capabilities

## 32.1 metric_definition

```text
id                  UUID PK
key                 VARCHAR UNIQUE
name                VARCHAR
category            VARCHAR
unit                VARCHAR
data_type           ENUM(float, integer, boolean, string, enum)
aggregation         ENUM(last, avg, min, max, sum, counter)
description         TEXT
```

Ejemplos:

```text
electrical.voltage.l1_n        V
electrical.current.l1          A
electrical.power.active.total  kW
environment.temperature        °C
sensor.rssi                    dBm
ats.mains.available            boolean
```

`DECISION` Las unidades se normalizan antes de almacenar/enviar al frontend.

## 32.2 device_capability

```text
id                    UUID PK
device_id             UUID FK
capability_key        VARCHAR
metric_definition_id  UUID NULL FK
enabled               BOOLEAN
metadata              JSONB
```

`DECISION` El frontend usa capabilities para construir vistas; no lógica rígida por fabricante.

---

# 33. Telemetría

## 33.1 measurement

```text
id                  BIGINT / UUID
tenant_id           UUID
site_id             UUID
asset_id            UUID NULL
device_id           UUID
gateway_id          UUID
metric_key          VARCHAR
ts                  TIMESTAMPTZ
value_double        DOUBLE PRECISION NULL
value_bool          BOOLEAN NULL
value_text          TEXT NULL
quality             ENUM(good, stale, invalid, unknown)
time_quality        ENUM(synced, estimated, unsynced)
message_id          UUID
sequence_number     BIGINT
ingested_at         TIMESTAMPTZ
```

Índices mínimos:

```text
(device_id, metric_key, ts DESC)
(asset_id, metric_key, ts DESC)
(tenant_id, ts DESC)
UNIQUE(message_id, device_id, metric_key, ts)
```

`RECOMMENDATION` Si el volumen crece, usar particionado por tiempo o una capa time-series compatible con PostgreSQL.

## 33.2 Retención inicial propuesta

```text
0 - 7 días      -> alta resolución
8 - 90 días     -> agregados 1 minuto
> 90 días       -> agregados 5 o 15 minutos
```

`PENDING` Definir retención contractual.

---

# 34. Eventos

## 34.1 event

```text
id                  UUID PK
tenant_id
site_id
asset_id            UUID NULL
device_id           UUID NULL
gateway_id          UUID NULL
event_type          VARCHAR
severity            ENUM(info, warning, critical)
ts                  TIMESTAMPTZ
payload             JSONB
source              VARCHAR
created_at
```

Ejemplos:

```text
device.online
device.offline
gateway.reconnected
ats.breaker.closed
ats.breaker.opened
temperature.excursion.started
temperature.excursion.ended
```

`DECISION` Un evento no es necesariamente una alarma.

---

# 35. Reglas

## 35.1 rule

```text
id                    UUID PK
tenant_id
site_id               UUID NULL
name
description
enabled               BOOLEAN
scope_type            ENUM(tenant, site, area, asset, device)
scope_id              UUID
severity              ENUM(info, warning, critical)
expression            JSONB
duration_seconds      INTEGER
hysteresis            JSONB NULL
schedule_id           UUID NULL
escalation_policy_id  UUID NULL
created_by
created_at
updated_at
```

Ejemplo simple:

```json
{
  "op": "gt",
  "metric": "environment.temperature",
  "value": -15.0
}
```

Ejemplo compuesto:

```json
{
  "op": "and",
  "conditions": [
    {
      "op": "lt",
      "metric": "electrical.voltage.l1_n",
      "value": 50
    },
    {
      "op": "eq",
      "metric": "ats.mains.available",
      "value": false
    }
  ]
}
```

`DECISION` No se guardará código ejecutable arbitrario proporcionado por usuarios.

`IMPLEMENTED` El Rule Engine V1 acepta comparaciones `gt/gte/lt/lte/eq/neq` y composición `and/or/not`, opera sobre métricas normalizadas y aplica `duration_seconds`. Los scopes `tenant/site/area/asset/device` se resuelven contra la jerarquía real. Una condición persistente reutiliza la alarma activa y una recuperación la resuelve. `hysteresis` y `schedule_id` permanecen `PENDING`; si están presentes, el motor no los ignora silenciosamente y falla cerrado como no soportado.

---

# 36. Alarmas

## 36.1 alarm

```text
id                  UUID PK
tenant_id
rule_id              UUID FK
site_id
asset_id            UUID NULL
device_id           UUID NULL
severity
status               ENUM(active, acknowledged, resolved, closed, suppressed)
opened_at            TIMESTAMPTZ
acknowledged_at      TIMESTAMPTZ NULL
acknowledged_by      UUID NULL
resolved_at          TIMESTAMPTZ NULL
closed_at            TIMESTAMPTZ NULL
closed_by            UUID NULL
current_value        JSONB NULL
context              JSONB
created_at
updated_at
```

`DECISION` Una condición persistente no crea una alarma nueva en cada evaluación.

`IMPLEMENTED` El backend reutiliza la alarma vigente, permite ACK independiente de RESOLVED, resuelve automáticamente al recuperarse la condición y cancela los jobs de escalamiento pendientes al ACK/RESOLVE/CLOSE. El enum físico conserva `open` por compatibilidad interna donde el diseño conceptual utiliza `active`.

## 36.2 alarm_transition

```text
id                  UUID PK
alarm_id             UUID FK
from_status          VARCHAR NULL
to_status            VARCHAR
reason               VARCHAR NULL
actor_type           ENUM(user, system, provider)
actor_id             UUID NULL
ts                   TIMESTAMPTZ
metadata             JSONB
```

---

# 37. Escalamiento

## 37.1 escalation_policy

```text
id                  UUID PK
tenant_id
name
enabled
created_at
updated_at
```
## 37.2 escalation_level

```text
id                  UUID PK
policy_id
level_number
delay_seconds
recipient_type       ENUM(user, role, on_call_group)
recipient_ref
channels             JSONB
repeat_count         INTEGER
```

`DECISION` Los jobs de escalamiento deben persistirse; no depender de timers en memoria.

`IMPLEMENTED` Los jobs se persisten con `due_at`, se reclaman de forma idempotente en el ciclo operacional y resuelven el destinatario en tiempo de ejecución para `user`, `role` y `on_call_group`. ACK detiene niveles posteriores. Si una alarma se recupera y luego reabre, los niveles cancelados pueden reprogramarse.

`PARTIAL` `repeat_count = 1` está soportado. Para `repeat_count > 1` falta congelar un intervalo de repetición; el backend rechaza ese caso en lugar de inventar una cadencia.

---

# 38. Notificaciones

## 38.1 notification

```text
id                  UUID PK
tenant_id
alarm_id            UUID NULL
channel             ENUM(whatsapp, email)
recipient_user_id   UUID NULL
recipient_address   VARCHAR
provider            VARCHAR
provider_message_id VARCHAR NULL
template_name       VARCHAR NULL
status              ENUM(queued, sent, delivered, read, failed, cancelled)
attempt             INTEGER
queued_at
sent_at
delivered_at
read_at
failed_at
ack_at
error_code          VARCHAR NULL
error_message       TEXT NULL
metadata            JSONB
```

`DECISION`

```text
sent != delivered != read != acknowledged
```

`IMPLEMENTED` `notification_deliveries` persiste destinatario explícito, `recipient_user_id`, proveedor, template, `provider_message_id`, timestamps separados de envío/entrega/lectura/falla/ACK y error del proveedor. La aceptación de Resend o Meta se registra como `sent`; `delivered` y `read` sólo avanzan mediante evidencia posterior del proveedor.

---

# 39. WhatsApp — diseño V1

## 39.1 Adapter

```text
notification_provider
├── whatsapp_meta
└── email
```

Funciones conceptuales:

```text
send_alarm()
send_escalation()
send_resolution()
parse_webhook()
```

## 39.2 Flujo

```text
Rule Engine
   |
Alarm ACTIVE
   |
Escalation Engine
   |
Notification Service
   |
Meta WhatsApp Cloud API
   |
Usuario
   |
Quick Reply: ACK
   |
Webhook HOIT
   |
Alarm Service
   |
ACKNOWLEDGED
```

## 39.3 Reglas del ACK

Para aceptar un ACK:

1. webhook válido;
2. correlación con alarma vigente;
3. teléfono asociado a usuario autorizado;
4. procesamiento idempotente;
5. crear `AlarmTransition`;
6. crear `AuditEntry`.

`DECISION` Un número no reconocido no puede cambiar el estado de la alarma.

`IMPLEMENTED` Existe `POST /api/v1/webhooks/whatsapp` con verificación HMAC de Meta, persistencia idempotente de eventos, correlación por `provider_message_id`, validación de `phone_e164` contra usuario activo/autorizado, Quick Reply `ACK`, creación de transición de alarma y audit trail. Los callbacks `sent`, `delivered`, `read` y `failed` actualizan la notificación sin regresión de estado.

## 39.4 Templates sugeridos

```text
hoit_alarm_warning_es
hoit_alarm_critical_es
hoit_alarm_escalated_es
hoit_alarm_resolved_es
```

---

# 40. Turnos

## 40.1 shift

```text
id                  UUID PK
tenant_id
name
timezone
active
```

## 40.2 shift_schedule

```text
id
shift_id
day_of_week
start_time
end_time
valid_from
valid_to
```

## 40.3 on_call_assignment

```text
id
shift_id
user_id
starts_at
ends_at
priority
```

`DECISION` El destinatario se resuelve al ejecutar cada nivel de escalamiento.

`IMPLEMENTED` La resolución on-call evalúa calendario semanal en el timezone del turno, ventanas que cruzan medianoche, vigencia temporal, usuarios activos y prioridad. Prioridad numérica menor significa mayor prioridad. Un empate en la prioridad superior se considera ambiguo y no selecciona un usuario arbitrariamente.

---

# 41. Maintenance Window

```text
id                  UUID PK
tenant_id
scope_type
scope_id
starts_at
ends_at
reason
created_by
cancelled_at
cancelled_by
created_at
```

---

# 42. Usuarios y autorización

## 42.1 user

```text
id                  UUID PK
tenant_id           UUID NULL
email
phone_e164
name
status
created_at
updated_at
```

## 42.2 role

```text
id
code
name
scope
```

## 42.3 user_role

```text
user_id
role_id
tenant_id
site_id NULL
```

`DECISION` La autorización se valida siempre en backend.

`IMPLEMENTED` `phone_e164` está incorporado al usuario con validación E.164 y unicidad cuando está presente. La API de usuarios permite administrarlo respetando el alcance RBAC y lo registra en audit trail.

---

# 43. Audit Trail

## 43.1 audit_entry

```text
id                  UUID PK
tenant_id
user_id             UUID NULL
actor_type          ENUM(user, gateway, system)
action              VARCHAR
entity_type         VARCHAR
entity_id           UUID NULL
before_data         JSONB NULL
after_data          JSONB NULL
ip_address          INET NULL
user_agent          TEXT NULL
ts                  TIMESTAMPTZ
metadata            JSONB
```

Acciones mínimas:

```text
auth.login
alarm.ack
alarm.resolve
alarm.close
rule.create
rule.update
maintenance.create
maintenance.cancel
user.create
user.role_changed
gateway.config_changed
report.generated
report.exported
```

---

# 44. Contrato Gateway -> Cloud

## 44.1 Principios

`DECISION` **El Backend recibe exclusivamente datos normalizados y limpios en JSON.** Los protocolos físicos, mapas de registros, offsets, function codes, endianness, escalas crudas y decodificación específica de fabricante pertenecen al Gateway y no forman parte del contrato de telemetría Cloud.

El contrato HOIT V1 utiliza allowlist estricta. Un payload que intente incorporar campos de protocolo como `protocol`, `register`, `raw_value`, `function_code`, `byte_order` u otros equivalentes fuera de `metrics` debe rechazarse como payload inválido.

Esto aplica a **todos los dispositivos presentes y futuros**, no sólo PM5560/DSE8660/BLE.

- versionado;
- idempotencia;
- lotes;
- UTC;
- unidades normalizadas;
- calidad del dato;
- identidad inequívoca;
- tolerancia a retransmisión.

## 44.2 Envelope común

```json
{
  "schema_version": "1.0",
  "gateway_id": "GW-DSE-01",
  "boot_id": "550e8400-e29b-41d4-a716-446655440000",
  "message_id": "d1025c19-cfa7-4b90-93d7-725ad310d431",
  "sequence": 18452,
  "created_at": "2026-10-02T16:30:05.210Z",
  "time_quality": "SYNCED"
}
```

`sequence` es monotónico dentro de `boot_id`.

---

# 45. Telemetry ingest

Endpoint:

```text
POST /api/v1/gateway/ingest
```

Payload:

```json
{
  "schema_version": "1.0",
  "gateway_id": "GW-DSE-01",
  "boot_id": "550e8400-e29b-41d4-a716-446655440000",
  "message_id": "d1025c19-cfa7-4b90-93d7-725ad310d431",
  "sequence": 18452,
  "created_at": "2026-10-02T16:30:05.210Z",
  "time_quality": "SYNCED",
  "samples": [
    {
      "device_id": "DSE-01",
      "sampled_at": "2026-10-02T16:30:04.900Z",
      "quality": "GOOD",
      "metrics": {
        "electrical.voltage.l1_n": 231.4,
        "electrical.voltage.l2_n": 230.8,
        "electrical.voltage.l3_n": 232.1,
        "electrical.current.l1": 85.3,
        "electrical.power.active.total": 56.8,
        "electrical.frequency": 50.02,
        "electrical.power_factor": 0.96,
        "ats.mains.available": true
      }
    }
  ]
}
```

Respuesta:

```json
{
  "accepted": true,
  "message_id": "d1025c19-cfa7-4b90-93d7-725ad310d431",
  "server_time": "2026-10-02T16:30:05.430Z"
}
```

`DECISION` Repetir el mismo `message_id` no debe duplicar datos.

`DECISION` `samples[]` sólo admite `device_id`, `sampled_at`, `quality` y `metrics`. `metrics` contiene únicamente claves normalizadas del catálogo HOIT con valores escalares. El Backend no interpreta registros Modbus, GenComm, BLE crudo ni protocolos propietarios.

---

# 46. BLE ingest

Ejemplo normalizado:

```json
{
  "device_id": "TEMP-01",
  "sampled_at": "2026-10-02T16:31:00.000Z",
  "quality": "GOOD",
  "metrics": {
    "environment.temperature": -18.3,
    "sensor.battery_voltage": 3.52,
    "sensor.rssi": -67,
    "sensor.adv_count": 138225
  }
}
```

`DECISION` Eddystone TLM se decodifica en el gateway; el cloud no conoce offsets BLE.

---

# 47. Gateway heartbeat

```text
POST /api/v1/gateway/heartbeat
```

Ejemplo:

```json
{
  "schema_version": "1.0",
  "gateway_id": "GW-PM-01",
  "boot_id": "uuid",
  "software_version": "1.2.0",
  "uptime_seconds": 84521,
  "buffer": {
    "pending_messages": 0,
    "bytes": 0,
    "usage_percent": 3.1
  },
  "network": {
    "active_interface": "4g",
    "rssi_dbm": -72,
    "ip_available": true
  },
  "system": {
    "cpu_percent": 11.4,
    "memory_percent": 33.2,
    "disk_percent": 18.9
  },
  "interfaces": {
    "rs485": "OK",
    "ble": "OK"
  },
  "devices": [
    {
      "device_id": "PM-01",
      "status": "ONLINE",
      "latency_ms": 24,
      "last_success_at": "2026-10-02T16:30:59Z",
      "consecutive_errors": 0
    }
  ]
}
```

---

# 48. Configuración Cloud -> Gateway

```text
GET /api/v1/gateway/config
```

Ejemplo:

```json
{
  "schema_version": "1.0",
  "config_version": 17,
  "gateway_id": "GW-DSE-01",
  "upload": {
    "interval_seconds": 5,
    "max_batch_samples": 100
  },
  "devices": [
    {
      "device_id": "DSE-01",
      "driver": "dse8660",
      "enabled": true,
      "transport": {
        "type": "modbus_rtu",
        "port": "/dev/ttyS1",
        "baud": 19200,
        "parity": "N",
        "stop_bits": 1,
        "slave_id": 1
      },
      "poll_profile": "dse8660_default"
    },
    {
      "device_id": "DSE-02",
      "driver": "dse8660",
      "enabled": true,
      "transport": {
        "type": "modbus_rtu",
        "port": "/dev/ttyS1",
        "baud": 19200,
        "parity": "N",
        "stop_bits": 1,
        "slave_id": 2
      },
      "poll_profile": "dse8660_default"
    }
  ]
}
```

## 48.1 Aplicación segura

```text
download
  ↓
validate schema
  ↓
validate local constraints
  ↓
write candidate config
  ↓
apply
  ↓
health check
  ├── OK   -> commit
  └── FAIL -> rollback
```

---

# 49. Errores de API

```json
{
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "Device does not belong to this gateway",
    "request_id": "req_xxx"
  }
}
```
```text
200/201 éxito
202 aceptado asíncronamente
400 payload inválido
401 autenticación
403 autorización
404 recurso
409 conflicto / versión
422 semántica inválida
429 rate limit
500 error interno
503 dependencia temporalmente no disponible
```

---

# 50. Versionado

Versiones independientes:

```text
API version           /api/v1
payload schema        schema_version
gateway software      software_version
```

---

# 51. Diseño del Rule Engine

## 51.1 Estado reciente

El Rule Engine trabajará sobre el estado reciente por:

```text
tenant + asset/device + metric
```

No consultará todo el histórico para evaluar cada muestra.

## 51.2 Estado temporal

Para `temperature > -15 FOR 300 seconds`:

```text
rule_id
scope_id
condition_started_at
last_true_at
last_false_at
current_state
```

Estados internos:

```text
FALSE
PENDING
FIRING
RECOVERING
```

---

# 52. Histéresis

Ejemplo:

```text
Trigger:
temperature > -15.0 °C

Recovery:
temperature < -16.0 °C
```

`DECISION` La histéresis se aplica a recuperación, evitando rebote de estados.

---

# 53. Missing data

Reglas propias:

```text
device.last_seen > X seconds
sensor.last_seen > X seconds
metric.age > X seconds
gateway.heartbeat.age > X seconds
```

`DECISION` La ausencia de telemetría nunca se interpreta como un valor normal.

---

# 54. Estado agregado de Asset

Estados:

```text
NORMAL
WARNING
CRITICAL
UNKNOWN
MAINTENANCE
```

Regla conceptual:

```text
if maintenance active:
    MAINTENANCE
else if critical alarm:
    CRITICAL
else if warning alarm:
    WARNING
else if no valid source:
    UNKNOWN
else:
    NORMAL
```

---

# 55. Dashboard API

El frontend no debe reconstruir el estado desde toda la tabla histórica.

Endpoints optimizados:

```text
GET /api/v1/overview
GET /api/v1/assets/{id}/summary
GET /api/v1/devices/{id}/latest
GET /api/v1/history
GET /api/v1/alarms
```

---

# 56. Desarrollo paralelo

## Track A — Gateway

- HOIT Agent;
- store & forward;
- PM5560;
- DSE8660;
- Eddystone TLM;
- heartbeat;
- config.

## Track B — Backend

- multi-tenant;
- ingest;
- measurements;
- latest state;
- rules;
- alarms;
- notifications;
- reports;
- audit.

## Track C — Frontend

- overview;
- eléctricos;
- DSE;
- cold chain;
- alarm center;
- IoT health;
- admin.

`DECISION` Los tres tracks desarrollan contra contratos versionados comunes.

---

# 57. Definition of Done de un driver

Un driver no se considera terminado solo porque lee valores.

Debe tener:

1. lectura estable;
2. normalización;
3. unidades correctas;
4. quality;
5. last_seen;
6. timeouts/retries;
7. offline detection;
8. ingest;
9. histórico;
10. latest state;
11. reglas;
12. alarmas;
13. diagnóstico;
14. tests.

---

# 58. Backlog técnico inmediato

## EPIC-01 — Generalizar CAM5 a HOIT Core

- inventario del código;
- matriz `reuse/refactor/replace/new`;
- desacoplar nombres CAM5;
- contratos comunes.

## EPIC-02 — Data Model

- Tenant/Site/Area/Asset;
- Gateway/Device;
- Metrics;
- Measurements;
- Events;
- Rules;
- Alarms;
- Notifications;
- Audit.

## EPIC-03 — Gateway Contract

- config;
- heartbeat;
- ingest;
- idempotencia;
- auth;
- versionado.

## EPIC-04 — Electrical Drivers

- Modbus abstraction;
- PM5560;
- DSE8660.

## EPIC-05 — Cold Chain

- BLE scanner;
- Eddystone TLM;
- Camera Asset;
- discrepancy;
- missing data.

## EPIC-06 — Alarm Platform

- rules;
- duration;
- hysteresis;
- lifecycle;
- escalation;
- maintenance.

## EPIC-07 — Notifications

- Notification Service;
- Meta WhatsApp adapter;
- webhook;
- email;
- ACK.

## EPIC-08 — Portal

- overview;
- eléctricos;
- DSE;
- cold chain;
- alarms;
- IoT health;
- admin.

---

# 59. Matriz para revisar CAM5

| Clasificación | Significado |
|---|---|
| REUSE | conservar sin cambios relevantes |
| REFACTOR | generalizar manteniendo lógica útil |
| REPLACE | sustituir diseño actual |
| NEW | no existe actualmente |

Plantilla:

```text
Componente:
Ruta:
Responsabilidad actual:
Dependencias CAM5:
Clasificación:
Cambios requeridos:
Riesgo:
Prioridad:
```

---

# 60. Milestone M1 — Core Contract Frozen

M1 se considera cumplido cuando se validen:

- entidades y relaciones;
- catálogo inicial de métricas;
- estados de alarmas;
- ingest payload;
- heartbeat;
- gateway config;
- idempotencia;
- errores;
- versionado.

## 60.1 Estado 2026-10-03

`IMPLEMENTED` y cubierto por pruebas automatizadas:

- entidades/relaciones Core y aislamiento de jerarquía;
- catálogo inicial PM5560/DSE8660/Eddystone;
- estados operacionales de alarmas;
- ingest Gateway -> Cloud V1, incluyendo lotes `samples[]` e idempotencia;
- heartbeat V1;
- config Cloud -> Gateway V1;
- versionado y compatibilidad con contratos CAM5 existentes;
- contrato RS-485 con bus lógico y puerto Linux explícitos.

`DECISION` M1 puede considerarse **funcionalmente congelado para el contrato Core/Gateway**, siempre que cambios futuros en histéresis, calendario de reglas o escalamiento repetido no alteren el envelope de telemetría/config/heartbeat. Esos pendientes pertenecen al control plane y se mantienen explícitos en §27.

Después de M1 pueden avanzar en paralelo gateway, backend y frontend con menor riesgo de retrabajo.

---

# 61. Matriz de implementación Core V1 — 2026-10-03

| Componente | Estado | Evidencia/nota |
|---|---|---|
| Multi-tenant/RBAC | `IMPLEMENTED` | scopes plataforma/cliente/sitio y guards de BD |
| Area | `IMPLEMENTED` | entidad real; parent/asset no pueden cruzar tenant/site |
| Métricas/telemetría | `IMPLEMENTED` | catálogo normalizado + latest/history |
| Gateway config/heartbeat/ingest | `IMPLEMENTED` | contrato V1 + compatibilidad previa |
| Rule Engine | `PARTIAL` | booleanos, comparación, duración y scope listos; histéresis/schedule pendientes |
| Alarm lifecycle | `IMPLEMENTED` | open/ACK/resolved/closed/suppressed, reapertura y trazabilidad |
| Maintenance Window | `IMPLEMENTED` | no detiene telemetría; suprime entregas por scope/periodo |
| Escalation jobs | `IMPLEMENTED` | persistentes, due_at, cancelación por ACK y requeue al reopen |
| Turnos/on-call | `IMPLEMENTED` | timezone, overnight, vigencia, prioridad, ambigüedad explícita |
| Email personal | `IMPLEMENTED` | Resend con recipient explícito |
| WhatsApp Meta adapter | `IMPLEMENTED` | envío template por Cloud API; secretos fuera de BD |
| WhatsApp webhook/ACK | `IMPLEMENTED` | firma, idempotencia, correlación, autorización, transition/audit |
| Lifecycle notificación | `IMPLEMENTED` | queued/sending/sent/delivered/read/failed/cancelled/suppressed + ack_at |
| Reports | `IMPLEMENTED` | templates y exportes existentes |
| UI Operación | `PARTIAL` | faltan pantallas completas para reglas/turnos/escalamiento/NOC |
| Gateway Agent Linux | `PARTIAL` | daemon, config cache, Store & Forward, sync, heartbeat, device manager y Modbus RTU base implementados; falta hardware real/drivers |
| Drivers físicos | `PENDING` | requieren documentación/hardware validado |
| Store & Forward | `PARTIAL` | persistencia/retry/restart/overflow implementados y testeados; falta soak test en hardware para declarar productivo |
| Meta productivo | `PENDING` externo | número, WABA, credenciales y templates aprobados |

---

# 62.2 Frontend UX 2.0 — Estado 2026-10-04

| Componente | Estado | Nota |
|---|---|---|
| Dashboard cliente multi-sitio | `IMPLEMENTED` base | condición, alertas, adquisición, mantenimiento y on-call |
| Resumen del activo | `IMPLEMENTED` | vista universal sobre `device -> metric` para activos normalizados; CAM5 conserva renderer especializado |
| Navegación task-oriented | `IMPLEMENTED` | modelos de hardware fuera del menú principal |
| Contexto Cliente/Sitio/Activo | `IMPLEMENTED` | Dashboard usa alcance Cliente; vistas contextuales usan Sitio + Activo |
| Capability navigation | `IMPLEMENTED` base | renderer/contexto según `assetType`; la telemetría universal ya usa métricas normalizadas y evolucionará a catálogo explícito de capabilities |
| Engineering Hub | `IMPLEMENTED` base | enruta a configuración específica según tipo de activo |
| Terminología Activo/Dispositivo/Métrica | `IMPLEMENTED` base | quedan detalles legacy sólo en Ingeniería |
| Reglas de entrega vs escalamiento | `IMPLEMENTED` nomenclatura | conceptos diferenciados en UI |
| Commissioning genérico por capability | `PARTIAL` | CAM5 existente aislado; falta motor de checklist por capability |
| Diagnóstico genérico por capability | `PARTIAL` | vista legacy aislada dentro de Ingeniería |

`DECISION` Ningún nuevo modelo de dispositivo debe agregar por defecto un ítem al sidebar principal. Debe declarar capabilities y aportar su renderer/configuración contextual.

---

# 62.1 Track Backend + Frontend — Operación — Estado 2026-10-03

| Componente | Estado | Nota |
|---|---|---|
| Administración de clientes/sitios | `IMPLEMENTED` base | RBAC y herencia global de `platform_admin` |
| Usuarios y roles | `IMPLEMENTED` base | platform/client/site scopes |
| NOC | `IMPLEMENTED` base | alarmas activas, salud, mantenimiento y on-call |
| Mantenimiento | `IMPLEMENTED` | programación, listado, cancelación auditable |
| Turnos | `IMPLEMENTED` base | horario semanal, timezone, activación |
| Asignaciones on-call | `IMPLEMENTED` base | usuario, vigencia, prioridad y control de ambigüedad |
| Reglas/umbrales | `IMPLEMENTED` base | Centro de alertas permite editar reglas persistentes |
| Canales/notificaciones | `IMPLEMENTED` base | canales, políticas y entregas |
| Escalamiento avanzado | `PARTIAL` | administración multinivel Backend + Frontend implementada; `repeat_count > 1` sigue pendiente por semántica |
| Integración Gateway física | `PENDING` deliberado | se retoma al terminar Backend + Frontend |

`DECISION` El NOC no reemplaza los módulos especializados; consolida señales operacionales que requieren atención inmediata y enlaza con las vistas de gestión.

---

# 62. Track A — Gateway Agent V1 — Estado 2026-10-03

| Componente | Estado | Nota |
|---|---|---|
| Daemon Linux/systemd | `IMPLEMENTED` | proceso continuo con restart administrado |
| Cloud client | `IMPLEMENTED` | config, ingest y heartbeat V1 |
| Config cache offline | `IMPLEMENTED` | conserva última configuración válida |
| Store & Forward SQLite | `IMPLEMENTED` core | WAL, persistencia antes de upload, retry idempotente, restart |
| Buffer medible/overflow | `IMPLEMENTED` | límite configurable; no descarta silenciosamente |
| Time quality | `IMPLEMENTED` | `SYNCED` solo con NTP confirmado |
| Device Manager | `IMPLEMENTED` | plug-ins + ONLINE/DEGRADED/OFFLINE/UNKNOWN |
| Health monitor | `IMPLEMENTED` base | CPU, memoria, disco, buffer y devices |
| Modbus RTU | `IMPLEMENTED` base | V1 read-only FC03/FC04, CRC y excepciones |
| PM5560 físico | `PENDING` | usar únicamente lista oficial Schneider versionada y validar con equipo |
| DSE8660 MKII físico | `PENDING` | bloqueado por mapa oficial definitivo |
| BLE Eddystone TLM físico | `PENDING` | scanner/decoder + prueba RF |
| Connectivity manager | `PARTIAL` | retry Cloud listo; falta selección Ethernet/Wi-Fi/4G y RSSI |
| Watchdog hardware | `PARTIAL` | restart por systemd listo; falta watchdog del hardware objetivo |
| Soak test Store & Forward | `PENDING` | medir duración/capacidad real bajo corte prolongado |

`DECISION` El Track A queda congelado mientras se completa Backend + Frontend. Cuando se retome la integración física, el primer driver será **PM5560**; el protocolo y su mapa permanecerán dentro del Gateway y sólo saldrán métricas HOIT normalizadas en JSON.

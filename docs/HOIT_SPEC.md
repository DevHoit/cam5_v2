# HOIT Critical Infrastructure Platform
## Especificación funcional y técnica — Documento vivo

**Versión:** 0.5  
**Fecha:** 2026-10-03  
**Estado:** Base de diseño y desarrollo — implementación Core V1 en curso  
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

## 0.1 Estado de implementación — 2026-10-03

Esta versión incorpora el estado real del repositorio `DevHoit/cam5_v2`, rama `feature/hoit-core-v1`. El documento continúa siendo la fuente de verdad funcional/técnica; las notas `IMPLEMENTED` y `PARTIAL` indican el grado de materialización del diseño sin reemplazar las decisiones funcionales originales.

`IMPLEMENTED`:

- jerarquía multi-tenant `Tenant/Client -> Site -> Area -> Asset -> Device/Gateway`, incluyendo guards de base de datos para impedir relaciones cruzadas entre tenants/sites;
- RBAC con `platform_admin`, `client_admin`, `site_admin`, `engineer`, `operator`, `viewer`;
- catálogo de métricas y telemetría normalizada para PM5560, DSE8660 y Eddystone TLM;
- contratos Gateway -> Cloud para config, heartbeat e ingest, manteniendo compatibilidad con contratos CAM5 previos;
- identidad explícita de buses RS-485 y puerto Linux de cada binding;
- Rule Engine V1 seguro para comparaciones y composición booleana, con duración y scopes;
- lifecycle de alarmas, mantenimiento, escalamiento persistente, turnos/on-call y resolución de destinatarios;
- Notification Service con email y adapter Meta WhatsApp Cloud API;
- persistencia separada de `sent`, `delivered`, `read` y `ack`;
- webhook de WhatsApp con verificación de firma, idempotencia, correlación por mensaje, validación de teléfono autorizado, ACK, `AlarmTransition` y audit trail;
- reportes, históricos, módulos eléctricos/ATS/cadena de frío y ciclo operacional independiente de Vercel.

`PARTIAL`:

- histéresis y calendario del Rule Engine: los campos existen, pero su contrato JSON/semántica aún no está congelado; el motor falla cerrado cuando aparecen;
- `repeat_count > 1` en escalamiento: falta definir intervalo/semántica de repetición;
- Meta Business, número real, credenciales y templates aprobados: integración implementada, habilitación productiva externa pendiente;
- HOIT Gateway Agent Linux productivo con Store & Forward y drivers físicos: pendiente; los simuladores y contratos cloud ya existen.

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
| BLE scan | continuo; advertisement ~1 s |
| Upload cloud | 5 s nominal |
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

# 19. Módulos de UI

```text
Inicio
Monitoreo
├── Eléctrico
├── Respaldo / ATS
└── Cadena de frío

Alarmas
├── Activas
├── Historial
└── Reglas

Históricos
Reportes

Operación
├── Turnos
├── Mantenimiento
└── NOC

IoT
├── Gateways
├── Devices
└── Diagnóstico

Administración
├── Tenants
├── Sites
├── Users
├── Roles
└── Audit Trail
```

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
| HOIT Gateway Agent Linux productivo | adquisición / Store & Forward | `PENDING` |
| Drivers físicos PM5560/DSE/Eddystone en Gateway Agent | integración de campo | `PENDING` |
| Auditoría/refactor final de código CAM5 remanente | deuda técnica | `PARTIAL` |

---

# 28. Próximo trabajo

Estado del orden original:

1. auditar repositorio CAM5 actual — `PARTIAL`;
2. crear matriz `reuse / refactor / replace / new` — `PARTIAL`;
3. congelar modelo de datos Core V1 — `IMPLEMENTED` para jerarquía, métricas, reglas, alarmas, mantenimiento, turnos, escalamiento y notificaciones; quedan contratos puntuales indicados en §27;
4. congelar contrato Gateway ↔ Cloud — `IMPLEMENTED` para config/heartbeat/ingest V1 con compatibilidad CAM5;
5. implementar/generalizar HOIT Gateway Agent — `PENDING`, siguiente frente principal;
6. implementar drivers PM/DSE/Eddystone productivos — `PENDING`;
7. implementar pipeline cloud de ingesta — `IMPLEMENTED`;
8. implementar Alarm/Rule Engine — `PARTIAL`: comparación, booleanos, duración, scopes y lifecycle implementados; histéresis/calendario pendientes;
9. implementar Notification Service + WhatsApp — `IMPLEMENTED` en backend; habilitación Meta productiva pendiente;
10. construir vistas — `PARTIAL`; existen vistas eléctricas, ATS, cadena de frío, reportes, notificaciones y administración, faltan módulos operacionales completos;
11. pruebas end-to-end — `IMPLEMENTED` para flujos Core disponibles y continúa ampliándose;
12. despliegue piloto — `PENDING`.

Prioridad inmediata actualizada:

1. estabilizar CI y mantener migraciones automáticas verdes;
2. congelar contrato faltante de histéresis, calendario de reglas y repetición de escalamiento;
3. implementar HOIT Gateway Agent Linux;
4. implementar drivers físicos PM5560, DSE8660 MKII y BLE Eddystone TLM;
5. Store & Forward + health/watchdog/conectividad;
6. habilitar Meta Business real y templates;
7. completar UI Operación: Turnos, Mantenimiento, NOC y administración de políticas/reglas;
8. ejecutar piloto end-to-end con hardware real.

---

# 29. ADR — Decisiones registradas

- **ADR-001:** HOIT es el producto; CAM5 es un driver/familia.
- **ADR-002:** modelo común + capabilities.
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
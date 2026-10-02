# HOIT Core v1 — Plan de evolución desde CAM5 v2

**Rama:** `feature/hoit-core-v1`  
**Alcance de esta fase:** Frontend + Backend + Base de Datos + Contratos de API  
**Fuera de esta fase:** Implementación C del gateway productivo

---

## 1. Objetivo

Evolucionar `cam5_v2` hacia un núcleo HOIT multipropósito sin romper el funcionamiento actual de CAM5.

La estrategia será incremental:

1. mantener CAM5 operativo;
2. generalizar el modelo de dominio;
3. agregar soporte nativo para PM5560, DSE8660 y sensores BLE;
4. ampliar alarmas, notificaciones y vistas;
5. congelar el contrato Gateway ↔ Cloud;
6. implementar el gateway C posteriormente contra ese contrato.

---

## 2. Principio de compatibilidad

No se elimina ni reemplaza de inmediato el flujo actual CAM5.

Se conserva:

- `/api/v1/gateway/config`
- `/api/v1/gateway/ingest`
- `/api/v1/gateway/heartbeat`
- autenticación Bearer por gateway;
- `batchKey`;
- `bootId`;
- secuencia;
- idempotencia;
- configuración versionada;
- `latest_readings`;
- agregados;
- alarmas;
- notificaciones;
- auditoría.

La evolución debe ser **aditiva** antes que destructiva.

---

## 3. Separación conceptual

### 3.1 Asset

Elemento que entiende el usuario operacional.

Ejemplos:

- Cámara de frío 01
- Tablero principal
- ATS 01

### 3.2 Device

Equipo o sensor que produce datos.

Ejemplos:

- PM5560
- DSE8660
- sensor BLE
- CAM5

### 3.3 Gateway

Equipo Linux HOIT que adquiere datos de uno o más devices.

---

## 4. Modelo objetivo

```text
Tenant / Client
└── Site
    └── Area
        └── Asset
            ├── Device
            └── Gateway association
```

La estructura actual `clients / sites / assets / gateways / devices` se reutiliza.

Se agregará `areas` si la revisión de navegación confirma que aporta valor real.

---

## 5. Device genérico

El modelo actual de `devices` está acoplado a Modbus TCP mediante:

- `host`
- `port`
- `unitId`
- `registerConvention`

Estos datos no deben seguir siendo obligatorios para todos los devices.

### Objetivo

```text
device
├── identity
├── device_type
├── driver
├── capabilities
└── gateway binding
     └── transport configuration
```

Ejemplos:

```text
CAM5
device_type = condition_monitor
driver      = cam5
transport   = modbus_tcp

PM5560
device_type = power_meter
driver      = pm5560
transport   = modbus_rtu

DSE8660
device_type = ats_controller
driver      = dse8660
transport   = modbus_rtu

TEMP
device_type = temperature_sensor
driver      = eddystone_tlm
transport   = ble
```

---

## 6. Nuevas entidades propuestas

### 6.1 device_capabilities

Define capacidades funcionales.

Campos iniciales:

```text
id
device_id
capability_key
enabled
metadata
```

Ejemplos:

```text
electrical.voltage
electrical.current
electrical.power
electrical.energy
electrical.thd
ats.status
ats.breakers
temperature
battery
rssi
```

### 6.2 gateway_device_bindings

Separa identidad del device de su transporte.

Campos:

```text
id
gateway_id
device_id
interface_type
enabled
config JSONB
created_at
updated_at
```

Ejemplo Modbus RTU:

```json
{
  "port": "/dev/ttyS1",
  "baud": 19200,
  "parity": "E",
  "stop_bits": 1,
  "slave_id": 1
}
```

Ejemplo BLE:

```json
{
  "protocol": "eddystone_tlm",
  "namespace_id": "...",
  "instance_id": "..."
}
```

### 6.3 metric_definitions

Catálogo de variables normalizadas.

Campos:

```text
id
key
name
category
unit
data_type
aggregation
description
```

Ejemplos:

```text
electrical.voltage.l1_n
electrical.current.l1
electrical.power.active.total
electrical.frequency
electrical.power_factor
environment.temperature
sensor.battery_voltage
sensor.rssi
ats.mains.available
```

---

## 7. Estrategia para readings

No se recomienda reemplazar inmediatamente `channels`, `readings` y `latest_readings`.

### Fase 1

Mantener CAM5 tal como opera hoy.

### Fase 2

Agregar una capa de métrica genérica compatible con el modelo actual.

Alternativas a validar en implementación:

**Opción A — extender channels**

Permitir channels no asociados obligatoriamente a `registerDefinitionId`.

Ventaja:
- menor cantidad de cambios en histórico, tendencias, alarmas y frontend.

**Opción B — crear device_metrics**

Modelo completamente genérico separado de CAM5.

Ventaja:
- diseño más limpio.

Costo:
- más refactor en alarmas, histórico, tendencias y reportes.

### Recomendación inicial

Evaluar primero **Opción A**.

La prioridad es generalizar sin reescribir componentes que ya funcionan.

---

## 8. API de ingestión

### 8.1 CAM5

`schemaVersion 1.x` continúa funcionando.

El backend seguirá aceptando:

```text
register
rawValue
quality
flags
```

y realizará la conversión CAM5 actual.

### 8.2 HOIT normalizado

Se agregará soporte para un payload genérico.

Propuesta:

```json
{
  "schemaVersion": "2.0",
  "batchKey": "uuid-or-stable-key",
  "sentAt": "2026-10-02T16:30:05Z",
  "gateway": {
    "code": "GW-DSE-01",
    "bootId": "uuid",
    "sequence": 18452
  },
  "device": {
    "code": "DSE-01",
    "driver": "dse8660"
  },
  "sampledAt": "2026-10-02T16:30:04Z",
  "quality": "good",
  "metrics": {
    "electrical.voltage.l1_n": 231.4,
    "electrical.current.l1": 85.3,
    "electrical.power.active.total": 56.8,
    "electrical.frequency": 50.02,
    "ats.mains.available": true
  }
}
```

### Regla

El backend no debe necesitar conocer:

- dirección de registro;
- orden de words;
- offset BLE;
- endianess del fabricante.

Esas responsabilidades quedan en el gateway/driver.

---

## 9. Alarm Engine

El motor actual se conserva como base.

### Capacidades actuales reutilizables

- persistencia;
- warning / critical;
- histéresis;
- activation samples;
- recovery samples;
- comunicación;
- data quality;
- apertura persistente;
- resolución;
- eventos;
- notificaciones.

### Extensiones requeridas

- umbral inferior;
- duración real en segundos;
- booleanos;
- igualdad/desigualdad;
- missing data;
- AND;
- OR;
- reglas cross-device;
- reglas por asset;
- maintenance suppression;
- escalation policy.

### Estado objetivo de regla

```text
FALSE
PENDING
FIRING
RECOVERING
```

No se permitirá código arbitrario en las reglas.

Las expresiones se almacenarán declarativamente.

---

## 10. Alarm lifecycle

Se conservarán los estados actuales cuando sea posible y se mapearán al modelo objetivo:

```text
ACTIVE
ACKNOWLEDGED
RESOLVED
CLOSED
SUPPRESSED
```

ACK no implica resolución.

Se deben poder calcular:

- MTTA
- MTTR

---

## 11. Maintenance Window

Nueva entidad.

```text
maintenance_windows
- id
- scope_type
- scope_id
- starts_at
- ends_at
- reason
- created_by
- cancelled_at
- cancelled_by
```

Comportamiento:

- la telemetría continúa;
- las mediciones continúan;
- las condiciones se evalúan;
- la alarma puede quedar trazada como suppressed;
- no se ejecuta el escalamiento normal.

---

## 12. Escalamiento y turnos

Nuevas entidades:

```text
escalation_policies
escalation_levels
shifts
shift_schedules
on_call_assignments
```

Ejemplo:

```text
L1 Técnico        0 min
L2 Supervisor     5 min
L3 Jefatura      10 min
```

Los jobs de escalamiento deben persistirse.

No utilizar solamente timers en memoria.

---

## 13. Notification Engine

`db/notification-engine.ts` se reutiliza.

Canales existentes:

- email;
- Teams;
- webhook.

Nuevo provider:

```text
whatsapp_meta
```

### Estados provider

```text
queued
sent
delivered
read
failed
cancelled
```

### Regla

```text
read != ACK
```

El ACK es una operación del dominio de alarmas.

---

## 14. WhatsApp

Arquitectura:

```text
Alarm Engine
    ↓
Escalation Engine
    ↓
Notification Engine
    ↓
Meta WhatsApp Cloud API
    ↓
Usuario
    ↓
Quick Reply ACK
    ↓
Webhook HOIT
    ↓
Alarm ACK
```

Nuevo endpoint previsto:

```text
POST /api/v1/webhooks/whatsapp
```

El ACK debe:

1. correlacionarse con una alarma;
2. validar número/usuario autorizado;
3. ser idempotente;
4. crear evento de alarma;
5. crear audit log.

---

## 15. Cold Chain

Activo:

```text
CAMARA-01
├── TEMP-01
└── TEMP-02
```

Métricas:

```text
environment.temperature
sensor.battery_voltage
sensor.rssi
sensor.last_seen
```

Funciones:

- temperatura actual;
- min/max;
- promedio;
- histórico;
- excursiones;
- tiempo fuera de rango;
- discrepancia sensores;
- sensor offline;
- MKT;
- batería;
- RSSI.

Setpoint base:

```text
-18 °C
```

Los límites deben ser configurables.

---

## 16. Electrical

Vista común para PM5560 y DSE8660:

```text
V L1/L2/L3
A L1/L2/L3
kW
kVA
kVAr
PF
Hz
```

El frontend consume métricas normalizadas.

No conoce registros Modbus.

---

## 17. PM5560 detail

Pestañas:

- Resumen
- Fases
- Energía
- Calidad
- Histórico
- Alarmas
- Diagnóstico

Capacidades adicionales:

- kWh;
- demanda;
- THD;
- armónicos.

---

## 18. DSE8660 detail

Pestañas:

- Resumen
- Eléctrico
- ATS / estados
- Alarmas
- Eventos
- Histórico
- Diagnóstico

Sinóptico:

`PENDING` hasta recibir unilineal y función real de cada DSE.

---

## 19. Frontend navigation objetivo

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
├── Clientes
├── Sitios
├── Usuarios
├── Roles
└── Auditoría
```

---

## 20. RBAC

No se crea un nuevo sistema.

Se amplía `db/access-control.ts`.

Permisos propuestos:

```text
electrical.read
ats.read
cold_chain.read

alarm_rules.read
alarm_rules.manage

maintenance.read
maintenance.manage

shifts.read
shifts.manage

gateways.read
devices.read

tenants.read
tenants.manage
```

Los roles finales se construirán sobre permisos, evitando lógica hardcoded por nombre de rol.

---

## 21. Reportes

Se reutiliza:

```text
db/report-engine.ts
db/report-export.ts
```

Templates nuevos:

- Executive Infrastructure Weekly
- Electrical Weekly
- Cold Chain Weekly
- Alarm Performance

PDF:
- ejecutivo.

Excel:
- detalle completo.

---

## 22. IoT Health

La vista actual de diagnóstico es base para este módulo.

Gateway:

- heartbeat;
- versión;
- uptime;
- conectividad;
- buffer;
- RSSI 4G;
- almacenamiento.

Device:

- online;
- degraded;
- offline;
- last_seen;
- latency;
- consecutive errors.

Debe diferenciar:

```text
0 V válido
```

de:

```text
sin comunicación
```

---

## 23. Orden de implementación Front/Back

### H1 — Core domain

- generalizar devices;
- capabilities;
- transport bindings;
- metric definitions;
- compatibilidad CAM5.

### H2 — Generic telemetry

- ingest v2;
- latest genérico;
- histórico genérico;
- pruebas de idempotencia.

### H3 — Alarm Engine v2

- operadores;
- low/high;
- duration;
- boolean;
- missing data;
- compound rules.

### H4 — Operations

- maintenance windows;
- escalation policies;
- shifts;
- on-call.

### H5 — Notifications

- WhatsApp Meta;
- webhook;
- ACK;
- estados delivered/read/failed.

### H6 — Frontend verticales

- Electrical;
- DSE;
- Cold Chain;
- IoT Health;
- NOC.

### H7 — Reports

- nuevos templates;
- programación;
- exports.

---

## 24. Estrategia de pruebas

Cada cambio debe preservar:

```text
npm run build
npm run lint
npm run test:db
```

Agregar tests para:

- ingest schema v2;
- metric normalization;
- device capabilities;
- threshold low;
- boolean rules;
- duration;
- AND / OR;
- maintenance suppression;
- escalation;
- WhatsApp ACK;
- unauthorized ACK;
- duplicate webhook;
- cold-chain sensor missing;
- sensor discrepancy.

---

## 25. Regla para esta rama

Durante `feature/hoit-core-v1`:

- no eliminar rutas CAM5 productivas;
- no cambiar semántica existente sin test;
- preferir migraciones aditivas;
- cada cambio de schema debe tener migración;
- no guardar secretos en código;
- no implementar control remoto PM/DSE;
- no introducir dependencia del código C del gateway.

---

## 26. Gateway

El gateway productivo queda deliberadamente fuera de esta fase.

El backend definirá y versionará:

- config;
- ingest;
- heartbeat;
- errores;
- idempotencia;
- metric keys.

El gateway posterior deberá cumplir esos contratos.

---

## 27. Primer cambio de código recomendado

Antes de crear nuevas vistas, implementar la base de genericidad:

1. `device_type` / `driver`;
2. gateway-device binding;
3. metric definitions;
4. capabilities;
5. ingest v2;
6. adaptación de latest/history.

Una vez que esos contratos existan, el frontend de PM/DSE/BLE puede construirse sin depender de mocks rígidos.

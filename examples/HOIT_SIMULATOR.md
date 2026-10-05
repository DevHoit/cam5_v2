# Simulador unificado HOIT

Herramienta de desarrollo para poblar HOIT Core con telemetría realista antes de disponer de todos los dispositivos físicos.

El simulador **no escribe directamente en PostgreSQL**. Envía datos al mismo endpoint autenticado que utiliza el Gateway Agent:

```text
Simulador
   ↓ HTTPS + Bearer token
/api/v1/gateway/ingest
   ↓
validación schemaVersion 2.0
   ↓
telemetría normalizada
   ↓
latest readings / histórico
   ↓
motores de condición y alarmas
   ↓
Dashboard / Activo / Tendencias / Histórico / Alertas / Reportes
```

Esto permite validar el circuito completo y evita crear datos que el gateway real nunca podría producir.

## Requisito previo

En Core deben existir:

1. Cliente.
2. Sitio.
3. Activo.
4. Gateway.
5. Dispositivo asociado al activo y al gateway.
6. Modelo del dispositivo con sus métricas habilitadas.
7. Token Bearer vigente del gateway.

El token completo se obtiene al provisionar el gateway y sólo se muestra una vez. No debe guardarse en Git.

## Uso

Exporta el token:

```bash
export HOIT_GATEWAY_TOKEN="<token>"
```

### PM5560

```bash
python3 examples/hoit_simulator.py \
  --profile pm5560 \
  --base-url https://<preview>.vercel.app \
  --gateway-code GW-PM01 \
  --devices PM5560-01 \
  --scenario demo
```

Escenarios:

```text
normal
undervoltage
overvoltage
overcurrent
low_pf
demo
```

### DSE8660 / ATS

```bash
python3 examples/hoit_simulator.py \
  --profile dse8660 \
  --base-url https://<preview>.vercel.app \
  --gateway-code GW-DSE \
  --devices DSE8660-01,DSE8660-02 \
  --scenario demo
```

Escenarios:

```text
normal
source1_fail
source2_fail
transfer_to_source2
common_alarm
demo
```

### Sensores BLE / cadena de frío

```bash
python3 examples/hoit_simulator.py \
  --profile cold-chain \
  --base-url https://<preview>.vercel.app \
  --gateway-code GW-TEMP-01 \
  --devices TEMP-01,TEMP-02 \
  --scenario demo \
  --min-c 2 \
  --max-c 8
```

Escenarios:

```text
normal
high
low
battery
disagreement
demo
```

## Ejecución continua o acotada

Por defecto el simulador corre hasta detenerlo.

Para enviar 20 ciclos:

```bash
python3 examples/hoit_simulator.py ... --cycles 20
```

Para cambiar la frecuencia:

```bash
python3 examples/hoit_simulator.py ... --interval 5
```

El intervalo mínimo del launcher es 1 segundo. Para pruebas de UI y alarmas normalmente 5 segundos es suficiente.

## Contrato enviado

Cada muestra utiliza exclusivamente el contrato normalizado vigente:

```json
{
  "schemaVersion": "2.0",
  "batchKey": "GW-PM01:<boot-id>:1:PM5560-01",
  "sentAt": "2026-10-05T14:00:00Z",
  "sampledAt": "2026-10-05T14:00:00Z",
  "timeQuality": "synced",
  "quality": "good",
  "qualityFlags": [],
  "gateway": {
    "code": "GW-PM01",
    "bootId": "<uuid>",
    "sequence": 1
  },
  "device": {
    "code": "PM5560-01"
  },
  "metrics": {
    "electrical.voltage.l1_n": 230.4,
    "electrical.frequency": 50.01
  }
}
```

El bloque `device` contiene sólo identidad lógica. Driver, protocolo, bus, Unit ID, registros, escalamiento y decodificación son responsabilidad del Gateway Agent y no se envían a Core.

## Qué valida

Al usar un gateway y dispositivo realmente provisionados, la simulación comprueba:

- autenticación del gateway;
- vínculo gateway ↔ dispositivo;
- catálogo de métricas habilitadas;
- validación de tipos;
- idempotencia por `batchKey`;
- actualización de estado del gateway/dispositivo;
- latest readings;
- histórico;
- motores de condición;
- alarmas y recuperaciones;
- vistas del Front que consumen telemetría real.

## Qué no valida

No valida el protocolo físico del equipo. Por ejemplo, no comprueba:

- mapa Modbus del PM5560;
- mapa GenComm/Modbus del DSE8660;
- recepción BLE real;
- RS-485;
- baud rate;
- registros;
- endianess;
- escalas físicas.

Eso corresponde al Gateway Agent y a las pruebas con hardware.

## Recomendación para poblar el Preview

Crear al menos cuatro activos de prueba:

```text
Tablero Principal
└── PM5560-01

ATS Principal
└── DSE8660-01
└── DSE8660-02

Cámara de Frío 01
└── TEMP-01
└── TEMP-02

Celda MT-01
└── CAM5-01
```

Ejecutando los perfiles en paralelo se obtiene un entorno con telemetría, tendencias, eventos y alarmas suficientemente rico para validar el Front sin depender del hardware de terreno.

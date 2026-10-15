# Simulador unificado HOIT

Herramienta de desarrollo para poblar HOIT Core con telemetría realista antes de disponer de todos los dispositivos físicos.

El simulador **no escribe directamente en PostgreSQL** y tampoco inventa un camino alternativo de ingestión. Emula la comunicación actual del **HOIT Gateway Agent**:

```text
Simulador HOIT Gateway
   │
   ├── GET  /api/v1/gateway/config
   │       valida identidad y dispositivos asignados
   │
   ├── POST /api/v1/gateway/ingest
   │       schema_version 1.0 + samples[]
   │
   └── POST /api/v1/gateway/heartbeat
           salud del gateway y dispositivos
                ↓
           HOIT Core
                ↓
     telemetría / histórico / alarmas
                ↓
 Dashboard / Activo / Tendencias / Reportes
```

Las métricas simuladas son generadas por perfiles PM5560, DSE8660 y cadena de frío, pero el transporte hacia Core usa el mismo envelope que el Gateway Agent productivo.

## Requisitos previos

En Core deben existir previamente:

1. Cliente.
2. Sitio.
3. Activo.
4. Gateway.
5. Dispositivo asociado al activo.
6. Binding de adquisición dispositivo ↔ gateway disponible en `GET /api/v1/gateway/config`.
7. Modelo del dispositivo con sus métricas habilitadas.
8. Token Bearer vigente del gateway.

El token completo se obtiene durante el provisionamiento del gateway y no debe guardarse en Git.

## Seguridad

El token se entrega únicamente mediante variable de entorno:

```bash
export HOIT_GATEWAY_TOKEN="<token>"
```

El launcher se niega por defecto a enviar datos a los hosts productivos conocidos. Para una prueba deliberada en producción debe utilizarse `--allow-production`.

La recomendación normal es ejecutar el simulador contra **https://cam5v2-git-feature-hoit-core-v1-hoit1.vercel.app**, asociado a `feature/hoit-core-v1`, o contra otro ambiente de pruebas. `https://core.hoitlive.com` se considera productivo y requiere `--allow-production`.

El Preview de la rama tiene Deployment Protection. Un token de gateway autentica a Core, pero no sustituye la autenticación de Vercel. Antes de ejecutar desde el gateway físico, disponer de un entorno de pruebas aislado y accesible por HTTPS. `staging.hoitlive.com` no es utilizable mientras su DNS siga pendiente.

## Uso

También puede invocarse mediante:

```bash
npm run simulator -- <argumentos>
```

### PM5560

```bash
python3 examples/hoit_simulator.py \
  --profile pm5560 \
  --base-url https://cam5v2-git-feature-hoit-core-v1-hoit1.vercel.app \
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
  --base-url https://cam5v2-git-feature-hoit-core-v1-hoit1.vercel.app \
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
  --base-url https://cam5v2-git-feature-hoit-core-v1-hoit1.vercel.app \
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

Por defecto el simulador permanece ejecutándose.

Para enviar 20 ciclos:

```bash
python3 examples/hoit_simulator.py ... --cycles 20
```

Para cambiar la frecuencia:

```bash
python3 examples/hoit_simulator.py ... --interval 5
```

El intervalo mínimo es un segundo. Para pruebas normales de UI, tendencias y alarmas, cinco segundos suele ser suficiente.

## Contrato de ingestión utilizado

El simulador reproduce el envelope V1 del Gateway Agent:

```json
{
  "schema_version": "1.0",
  "gateway_id": "GW-DSE-01",
  "boot_id": "550e8400-e29b-41d4-a716-446655440000",
  "message_id": "d1025c19-cfa7-4b90-93d7-725ad310d431",
  "sequence": 18452,
  "created_at": "2026-10-05T14:00:00.000Z",
  "time_quality": "SYNCED",
  "samples": [
    {
      "device_id": "DSE8660-01",
      "sampled_at": "2026-10-05T13:59:59.900Z",
      "quality": "GOOD",
      "metrics": {
        "ats.source1.available": true,
        "ats.source2.available": true,
        "ats.transfer.position": "source1"
      }
    }
  ]
}
```

Cada elemento de `samples[]` contiene exclusivamente:

- `device_id`;
- `sampled_at`;
- `quality`;
- `metrics`.

No se envían dentro de la telemetría:

- driver;
- protocolo;
- puerto físico;
- Unit ID;
- registros;
- escalas;
- endianess.

Esos detalles pertenecen al plano local de adquisición del Gateway Agent. Core recibe telemetría semántica normalizada.

## Heartbeat

El simulador también publica el heartbeat V1 del gateway, incluyendo:

- uptime;
- buffer;
- disponibilidad de red;
- salud básica del sistema;
- estado ONLINE de los dispositivos simulados;
- última lectura exitosa.

Esto permite que el Front muestre conectividad y estado de dispositivos de forma coherente con un gateway real.

## Validación previa al envío

Antes de publicar la primera muestra, el simulador ejecuta:

```text
GET /api/v1/gateway/config
```

y comprueba:

1. que la credencial sea válida;
2. que el código del gateway coincida;
3. que los dispositivos solicitados estén habilitados para ese gateway.

Si alguna condición falla, se detiene sin generar telemetría.

## Qué valida realmente

Al usar un gateway y dispositivos provisionados en el ambiente de pruebas, el simulador comprueba el circuito completo:

- autenticación Bearer;
- configuración Cloud → Gateway;
- asociación gateway ↔ dispositivo;
- contrato Gateway → Core;
- catálogo de métricas;
- tipos de datos;
- idempotencia por `message_id`;
- estado del gateway;
- estado del dispositivo;
- latest readings;
- histórico;
- motores de condición;
- alarmas y recuperaciones;
- tendencias;
- reportes;
- vistas del Front.

## Qué no valida

El simulador no reemplaza las pruebas de hardware y no valida:

- mapa Modbus real del PM5560;
- mapa GenComm/Modbus real del DSE8660;
- recepción BLE física;
- RS-485;
- baud rate;
- direccionamiento;
- registros;
- endianess;
- escalado físico.

Esas responsabilidades pertenecen al Gateway Agent y a los drivers productivos.

## Entorno sugerido para validar el Front

Un conjunto mínimo útil sería:

```text
Cliente Demo
└── Sitio Demo
    ├── Tablero Principal
    │   └── PM5560-01
    │
    ├── ATS Principal
    │   ├── DSE8660-01
    │   └── DSE8660-02
    │
    └── Cámara de Frío 01
        ├── TEMP-01
        └── TEMP-02
```

Ejecutando los tres perfiles en paralelo se obtiene un ambiente con suficiente telemetría para revisar Dashboard, activos, métricas, tendencias, histórico, conectividad, alertas y reportes.

CAM5 puede incorporarse como un cuarto perfil del simulador unificado cuando migremos su generador de datos al contrato V1 del Gateway Agent.

## Precaución

Para Core, la telemetría simulada es telemetría válida. Por lo tanto puede:

- cambiar el estado de un activo;
- abrir alarmas;
- resolver alarmas;
- alimentar tendencias e históricos;
- aparecer en reportes.

Por eso debe utilizarse normalmente en Preview o en un tenant/sitio explícitamente destinado a pruebas.

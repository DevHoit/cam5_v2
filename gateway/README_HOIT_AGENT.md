# HOIT Gateway Agent V1

Base productiva del agente Linux de HOIT. Esta etapa implementa el plano de control y Store & Forward contra el contrato `schema_version: "1.0"`.

## Alcance actual

Implementado:

- identidad por `gateway_id`;
- `boot_id` nuevo por arranque;
- `sequence` monotónico dentro del boot;
- `message_id` UUID por mensaje;
- cache local de configuración;
- fallback a última configuración válida si Cloud no responde;
- cola SQLite durable antes de transmitir;
- WAL + `synchronous=FULL`;
- retransmisión conservando exactamente `message_id`, `boot_id`, `sequence`, timestamp y payload;
- retry de red, HTTP 429 y 5xx;
- dead-letter para errores contractuales 4xx;
- heartbeat V1 con buffer, CPU, memoria y disco;
- detección conservadora de calidad temporal;
- superficie de plug-in para drivers físicos.

No implementado aún:

- adquisición física PM5560;
- adquisición física DSE8660;
- escáner BLE Eddystone TLM;
- watchdog de hardware;
- selección real Ethernet/Wi-Fi/4G y RSSI;
- daemon continuo de polling.

No se incluyen mapas de registros no verificados. El PM5560 necesita el mapa oficial versionado antes del driver productivo. El DSE8660 continúa pendiente de mapa oficial.

## Variables de entorno

```bash
HOIT_API_BASE=https://<portal>/api/v1
HOIT_GATEWAY_TOKEN=cam5gw_<token>
HOIT_GATEWAY_ID=GW-PM01
HOIT_STATE_DB=/var/lib/hoit-agent/agent.db
HOIT_BUFFER_MAX_BYTES=268435456
```

El token no debe almacenarse en Git.

## Prueba del plano de control

Desde la raíz del repositorio:

```bash
python3 -m gateway.hoit_agent
```

La ejecución:

1. obtiene `GET /api/v1/gateway/config`;
2. valida y cachea la configuración;
3. drena mensajes pendientes;
4. envía `POST /api/v1/gateway/heartbeat`.

Si Cloud no está disponible, la configuración cacheada sigue siendo utilizable y la cola de telemetría no se elimina.

## Store & Forward

Cada mensaje se persiste antes del primer envío:

```text
sample
  -> envelope V1
  -> SQLite pending
  -> POST ingest
  -> 2xx: sent
  -> 429 / 5xx / network: pending + backoff
  -> 4xx contractual: dead_letter
```

Un retry reutiliza exactamente el payload original. Reiniciar el proceso no cambia los IDs de mensajes ya almacenados.

## Calidad temporal

El agente solo declara `SYNCED` cuando `timedatectl` confirma `NTPSynchronized=yes`.

- sincronizado: `SYNCED`;
- servicio de tiempo presente pero no sincronizado: `ESTIMATED`;
- estado no verificable: `UNSYNCED`.

Esto evita presentar una hora reconstruida como sincronizada en hardware sin RTC.

## Tests

```bash
python3 -m unittest discover -s gateway/tests -p 'test_*.py'
```

Los tests actuales verifican cache offline, persistencia tras restart, idempotencia del retry, dead-letter y contrato numérico de heartbeat.

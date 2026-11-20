# Ingesta de mediciones (mini gateway BLE ESP32)

HoitLive Core recibe mediciones **ya decodificadas** por el gateway en `POST /api/v2/gateway/ingest`.
El portal no sabe de protocolos: traduce cada clave a un canal según la **plantilla** del equipo
(`register_definitions.source_key`), y aplica escala, unidad, rango válido, alarmas e histórico.

## Autenticación

Credencial del gateway generada en **Gateways › Nueva credencial** (`cam5gw_…`), en cualquiera de:

- `X-HOIT-Token: cam5gw_…` (lo que ya envía el ESP32)
- `Authorization: Bearer cam5gw_…`

El campo `gateway` del cuerpo debe ser el código del gateway registrado en el portal
(el ESP32 usa `HOIT-BLE-XXXXXX`, derivado de su MAC).

## Formato actual del ESP32 (se acepta tal cual)

```json
{
  "gateway": "HOIT-BLE-1A2B3C",
  "sequence": 12,
  "uptime_ms": 86400000,
  "beacons": [
    { "mac": "C3:00:00:1A:2B:3C", "temperature": 3.4, "humidity": 81.4,
      "battery_percent": 95, "battery_mv": null, "rssi": -71, "age_ms": 4200 }
  ]
}
```

- `mac` identifica el equipo (se normaliza a mayúsculas).
- Todo campo numérico distinto de `mac`, `age_ms` y `ts` es una medición; `null` se ignora.
- Hora de la medición: `ts` (ISO 8601) si viene; si no, hora de llegada − `age_ms`.
- `gateway` + `sequence` + `uptime_ms` evitan duplicados si el mismo envío se repite.

## Formato genérico (otros equipos)

```json
{ "gateway": "GW-01", "sequence": 7, "bootId": "a1b2", "health": { "fw": "1.0.3", "wifiRssi": -58 },
  "devices": [ { "id": "SN-77", "ts": "2026-11-20T14:58:00Z", "rssi": -60, "m": { "voltage_l1": 221.4 } } ] }
```

## Respuesta (HTTP 202)

```json
{ "status": "accepted", "devices": 1, "stored": 5, "observed": 5, "duplicates": 0,
  "unknown": ["D1:…"], "ignoredKeys": {}, "alarms": { "opened": 0, "updated": 0, "resolved": 0 } }
```

- `unknown`: equipos que nadie ha asignado. Aparecen en **Gateways › Equipos detectados**; al
  asignarlos a un punto de medición se crean sus canales desde la plantilla.
- `ignoredKeys`: claves que la plantilla del equipo no define (no rompen el envío).
- Se guarda una lectura por canal según el perfil (`ble-beacon-v1`: cada 60 s); las alarmas se
  evalúan en cada envío. Si un beacon deja de reportar 5 min, se abre una alarma de comunicación.

## Plantilla incluida: `BLE-KKM-TH` (KBeacon / KSensor)

| Clave | Canal | Magnitud | Unidad | Escala |
|---|---|---|---|---|
| `temperature` | TEMP | temperature | °C | 1 |
| `humidity` | HR | humidity | %RH | 1 |
| `battery_percent` | BAT | battery | % | 1 |
| `battery_mv` | VBAT | battery_voltage | V | 0,001 |
| `rssi` | RSSI | signal_strength | dBm | 1 |

## Probar sin hardware

```bash
HOIT_TOKEN=cam5gw_… node gateway/tools/esp32_ble_simulator.mjs http://localhost:3003 HOIT-BLE-1A2B3C 2 15
```

## Cambio necesario en el firmware (hoit-ble-gateway/main/main.c)

- `HOIT_INGEST_URL` → `https://core.hoitlive.com/api/v2/gateway/ingest`
- `HOIT_INGEST_TOKEN` (en `hoit_secrets.h`) → la credencial `cam5gw_…` del gateway.

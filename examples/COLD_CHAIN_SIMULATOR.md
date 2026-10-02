# Simulador de cadena de frío

Herramienta de desarrollo para validar HOIT Core antes de disponer del gateway físico.

No representa el software productivo del gateway.

## Requisitos

Debe existir previamente:

- un gateway provisionado con token;
- una o más cámaras `cold_room`;
- sensores BLE creados desde Cadena de frío;
- bindings sensor ↔ gateway;
- catálogo de métricas HOIT inicializado.

## Uso

```bash
export HOIT_BASE_URL="https://<preview>.vercel.app"
export HOIT_GATEWAY_TOKEN="<token>"
export HOIT_GATEWAY_CODE="GW-TEMP-01"
export HOIT_DEVICES="TEMP-01,TEMP-02"
export HOIT_INTERVAL="5"

python3 examples/cold_chain_simulator.py
```

El simulador publica cada sensor por separado usando `schemaVersion: "2.0"` y las métricas:

- `environment.temperature`
- `sensor.battery_voltage`
- `sensor.rssi`
- `sensor.adv_count`

La temperatura incluye variación lenta y ruido leve para que el frontend muestre cambios reales en el tiempo.

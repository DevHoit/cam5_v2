# Simulador de cadena de frío

Herramienta de desarrollo para validar el flujo completo de HOIT Core antes de disponer del gateway físico. No representa el software productivo del gateway.

## Requisitos

Debe existir previamente un gateway provisionado con token, una o más cámaras `cold_room`, sensores BLE creados desde Cadena de frío, bindings sensor ↔ gateway y el catálogo de métricas HOIT inicializado.

## Uso nominal

```bash
export HOIT_BASE_URL="https://<preview>.vercel.app"
export HOIT_GATEWAY_TOKEN="<token>"
export HOIT_GATEWAY_CODE="GW-TEMP-01"
export HOIT_DEVICES="TEMP-01,TEMP-02"
export HOIT_INTERVAL="5"

python3 examples/cold_chain_simulator.py
```

El payload usa exactamente el contrato `schemaVersion: "2.0"` aceptado por `/api/v1/gateway/ingest`, con `qualityFlags`, identidad de gateway/dispositivo y las métricas:

- `environment.temperature`
- `sensor.battery_voltage`
- `sensor.rssi`
- `sensor.adv_count`

## Escenarios

`HOIT_SCENARIO` admite `normal`, `high`, `low`, `battery`, `disagreement` y `demo`.

Para una prueba end-to-end de alarma por temperatura alta:

```bash
export HOIT_SCENARIO="demo"
export HOIT_MIN_C="2"
export HOIT_MAX_C="8"
export HOIT_TARGET_C="5"

# Debe coincidir con la persistencia configurada en la cámara.
export HOIT_ALARM_DELAY="300"

python3 examples/cold_chain_simulator.py
```

`demo` ejecuta automáticamente:

```text
temperatura normal
      ↓
temperatura > máximo
      ↓
permanece fuera de rango durante HOIT_ALARM_DELAY
      ↓
se abre alarma
      ↓
recuperación a rango normal
      ↓
la alarma se resuelve automáticamente
```

Al finalizar conviene verificar en el portal: **Resumen → Histórico → Excursiones → Alarmas → Reportes**.

Para pruebas rápidas en un entorno de desarrollo se puede configurar temporalmente `excursionDelaySeconds = 15` en la cámara y ejecutar:

```bash
export HOIT_SCENARIO="demo"
export HOIT_ALARM_DELAY="15"
export HOIT_INTERVAL="5"
python3 examples/cold_chain_simulator.py
```

No usar una persistencia reducida en producción sólo para acelerar pruebas.

## Otros escenarios

```bash
HOIT_SCENARIO=high python3 examples/cold_chain_simulator.py
HOIT_SCENARIO=low python3 examples/cold_chain_simulator.py
HOIT_SCENARIO=battery python3 examples/cold_chain_simulator.py
HOIT_SCENARIO=disagreement python3 examples/cold_chain_simulator.py
```

`battery` publica 2.95 V. Sólo abrirá una alarma si la cámara tiene configurado un umbral de batería superior a ese valor. `disagreement` requiere al menos dos sensores y genera una diferencia aproximada de 3 °C.

Puede limitarse una ejecución continua con `HOIT_CYCLES`, por ejemplo:

```bash
HOIT_SCENARIO=normal HOIT_CYCLES=12 python3 examples/cold_chain_simulator.py
```

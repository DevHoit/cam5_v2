# Simulador PM5560

Este simulador valida el contrato **Gateway → HOIT Core** del Schneider PowerLogic PM5560 antes de implementar el driver físico Modbus RTU.

No simula registros Modbus. El futuro gateway será responsable de leer y decodificar el mapa oficial del PM5560 y transformar esas lecturas a las métricas normalizadas de HOIT.

## Requisitos

1. Aplicar migraciones hasta `0018_pm5560_metric_catalog.sql`.
2. Crear un punto eléctrico desde **Monitoreo eléctrico**.
3. Asociar un PM5560 al punto y a un gateway RS485.
4. Disponer del token Bearer de ese gateway.

## Ejecución

```bash
export HOIT_BASE_URL="https://<portal>"
export HOIT_GATEWAY_TOKEN="<token>"
export HOIT_GATEWAY_CODE="GW-PM01"
export HOIT_DEVICE_CODE="PM5560-01"
export HOIT_INTERVAL="5"

python3 examples/pm5560_simulator.py
```

## Escenarios

```bash
HOIT_SCENARIO=normal python3 examples/pm5560_simulator.py
HOIT_SCENARIO=undervoltage python3 examples/pm5560_simulator.py
HOIT_SCENARIO=overvoltage python3 examples/pm5560_simulator.py
HOIT_SCENARIO=overcurrent python3 examples/pm5560_simulator.py
HOIT_SCENARIO=low_pf python3 examples/pm5560_simulator.py
HOIT_SCENARIO=demo python3 examples/pm5560_simulator.py
```

`demo` alterna condiciones cada 30 segundos. Estas condiciones todavía sirven para validar telemetría y UI; la apertura de alarmas eléctricas se incorpora en el bloque siguiente.

El payload utiliza `schemaVersion: "2.0"`, driver `schneider_pm5560` y las 17 métricas V1 normalizadas: tensiones fase-neutro y fase-fase, corrientes, potencias, factor de potencia, frecuencia, energía y demanda.

# Simulador DSE8660 MKII / ATS

Este simulador valida el contrato **Gateway → HOIT Core** del módulo ATS antes de implementar el driver físico GenComm/Modbus del Deep Sea Electronics DSE8660 MKII.

No emula registros físicos ni presupone direcciones del mapa DSE. El futuro gateway será responsable de leer la revisión instalada del controlador y convertir las variables verificadas a las métricas normalizadas de HOIT.

## Requisitos

1. Aplicar migraciones hasta `0022_ats_report_template.sql`.
2. Crear un activo **ATS** desde el módulo ATS.
3. Asociar uno o dos controladores DSE8660 MKII al mismo gateway RS485.
4. Cada controlador debe tener un Modbus slave ID distinto.
5. Disponer del token Bearer del gateway.

El simulador usa los códigos de dispositivo configurados en HOIT. Por defecto intenta enviar dos controladores:

```text
DSE8660-01
DSE8660-02
```

## Ejecución

```bash
export HOIT_BASE_URL="https://<portal>"
export HOIT_GATEWAY_TOKEN="<token>"
export HOIT_GATEWAY_CODE="GW-DSE"
export HOIT_DEVICES="DSE8660-01,DSE8660-02"
export HOIT_INTERVAL="5"

python3 examples/dse8660_simulator.py
```

Para una ejecución acotada:

```bash
HOIT_CYCLES=20 python3 examples/dse8660_simulator.py
```

## Escenarios

```bash
HOIT_SCENARIO=normal python3 examples/dse8660_simulator.py
HOIT_SCENARIO=source1_fail python3 examples/dse8660_simulator.py
HOIT_SCENARIO=source2_fail python3 examples/dse8660_simulator.py
HOIT_SCENARIO=transfer_to_source2 python3 examples/dse8660_simulator.py
HOIT_SCENARIO=common_alarm python3 examples/dse8660_simulator.py
HOIT_SCENARIO=demo python3 examples/dse8660_simulator.py
```

### normal

Ambas fuentes disponibles, transferencia en Fuente 1, interruptor de Fuente 1 cerrado y sin alarma común.

### source1_fail

Fuente 1 pasa a no disponible y sus tensiones/frecuencia caen a cero. La posición permanece en Fuente 1 para representar el instante previo o una condición sin transferencia efectiva.

Para que el motor abra una alarma de indisponibilidad, en la configuración del ATS debe estar activado **“Fuente 1 debe estar disponible”**.

### source2_fail

Fuente 2 queda no disponible. Sólo generará alarma de indisponibilidad si está configurada como fuente requerida.

### transfer_to_source2

Fuente 1 no disponible, Fuente 2 disponible, posición ATS en `source2`, interruptor Fuente 1 abierto e interruptor Fuente 2 cerrado.

Si el activo tiene `source1` configurada como posición esperada, el motor también puede registrar la condición de posición inesperada una vez cumplida su persistencia.

### common_alarm

Mantiene alimentación normal, pero activa `ats.common_alarm` y `ats.active_alarm_count = 1`.

### demo

Rota automáticamente por:

```text
normal
→ source1_fail
→ transfer_to_source2
→ common_alarm
→ normal
→ source2_fail
→ ...
```

La duración de cada fase se controla con:

```bash
export HOIT_PHASE_SECONDS="25"
```

Esto permite observar en el portal:

- cambios de disponibilidad de fuentes;
- cambios de posición de transferencia;
- apertura/cierre lógico de interruptores;
- alarmas y recuperaciones;
- histórico continuo de variables;
- histórico de eventos ATS;
- reportes ATS;
- comportamiento simultáneo de dos DSE8660 en un mismo gateway.

## Métricas

El payload usa `schemaVersion: "2.0"`, driver `dse8660_mkii` y el catálogo normalizado V1 del ATS:

- tensiones L-N y L-L de Fuente 1 y Fuente 2;
- frecuencia de ambas fuentes;
- corrientes de carga;
- potencia activa, reactiva y aparente;
- factor de potencia;
- disponibilidad de fuentes;
- estados de interruptores;
- posición de transferencia;
- alarma común;
- cantidad de alarmas activas;
- modo DSE.

## Alcance

Este simulador valida **HOIT Core**, no valida el mapa físico del DSE8660 MKII.

Antes del gateway de terreno todavía se debe confirmar contra la documentación oficial de la revisión instalada:

- protocolo exacto habilitado;
- mapa y direcciones de registros;
- escala y signedness;
- códigos enumerados;
- parámetros seriales reales;
- comportamiento de estados de transferencia y alarmas.

No se debe copiar el comportamiento numérico del simulador como si fuera el mapa Modbus real.

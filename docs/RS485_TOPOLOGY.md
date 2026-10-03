# Topología RS485 de HoitLive Core

V1 identifica una dirección Modbus por la combinación:

```text
gateway + bus físico + slave ID
```

No se considera suficiente `gateway + slave ID`, porque un gateway puede tener más de un puerto o segmento RS485 y el mismo slave ID puede existir legítimamente en buses distintos.

## Ejemplo

```text
GW-01
├── rs485-1
│   ├── PM5560-01   ID 1
│   └── PM5560-02   ID 2
└── rs485-2
    ├── DSE8660-01  ID 1
    └── DSE8660-02  ID 2
```

El ID 1 puede reutilizarse entre `rs485-1` y `rs485-2`, pero nunca dos veces dentro del mismo bus activo.

## Parámetros compartidos

Los equipos de un mismo bus físico deben compartir:

- baud rate;
- paridad;
- bits de datos;
- stop bits.

El intervalo de polling sí puede variar por dispositivo.

La base de datos protege tanto la unicidad `gateway + bus + address` como la consistencia de los parámetros seriales del bus.

## Migración de configuraciones existentes

Las vinculaciones RS485 creadas antes de modelar buses explícitos se migran a `rs485-1`. Esto conserva la semántica histórica: el modelo anterior asumía implícitamente un único bus RS485 por gateway.

Los parámetros seriales se recuperan del JSON histórico sólo cuando tienen formato válido. No se inventan valores ausentes.

## Contrato hacia el gateway físico

El gateway debe tratar `interfaceKey` como el identificador estable del puerto o segmento físico configurado. Ejemplos válidos:

```text
rs485-1
rs485-2
usb-rs485-a
panel-a
```

El nombre lógico no permite deducir una ruta Linux. Para el contrato HOIT V1, el binding guarda además de `interfaceKey` el puerto Linux confirmado durante commissioning, por ejemplo `/dev/ttyS1` o `/dev/ttyUSB0`.

HOIT Core **no inventa** esa ruta: debe ser ingresada explícitamente al configurar el device. Si falta, `GET /api/v1/gateway/config` rechaza la configuración HOIT como incompleta en vez de entregar un contrato ambiguo.

Todos los devices de un mismo `gateway + interfaceKey` deben compartir el mismo puerto Linux y parámetros seriales. El puerto puede cambiar entre buses distintos.

HOIT Core no define ni presupone mapas de registros PM5560 o DSE8660 en esta capa. Esos mapas deben incorporarse únicamente con documentación oficial validada para el equipo instalado.

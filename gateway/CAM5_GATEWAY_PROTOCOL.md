# Contrato de ingestión CAM5 Gateway v1.0

Este contrato es idéntico para una fuente de datos simulada y para un CAM5 físico. El backend no recibe ni necesita una marca que identifique el origen como simulación.

## Conexión

- API productiva: `https://cam5v2.vercel.app/api/v1`
- Configuración: `GET /gateway/config`
- Ingestión: `POST /gateway/ingest`
- Transporte: HTTPS con TLS válido.
- Autenticación: `Authorization: Bearer <token-del-gateway>`.
- Contenido: `Content-Type: application/json`.
- Tamaño máximo por solicitud: 256 KiB.
- Un lote representa una lectura de un rango Modbus de un solo controlador.

El token identifica al gateway y no debe guardarse en el repositorio. Se recomienda almacenarlo como variable de entorno `CAM5_GATEWAY_TOKEN`, con permisos de lectura limitados al servicio.

Para comprobar el circuito completo con el emisor de referencia incluido:

```bash
export CAM5_GATEWAY_TOKEN='token-entregado-fuera-del-repositorio'
CAM5_RUN_ONCE=1 python3 gateway/examples/cam5_gateway_simulator.py
```

Sin `CAM5_RUN_ONCE=1`, el emisor permanece ejecutándose y respeta los intervalos de la configuración remota.

## Frecuencias

| Rango nativo | Contenido | Frecuencia recomendada |
| --- | --- | ---: |
| 418–453 | Temperatura, ambiente y totales UHF | cada 2 segundos |
| 454–490 | Versión y diagnóstico UHF | cada 30 segundos |
| 491–522 | Conteos y tendencias Alpha/Beta/Phi | cada 10 segundos |

No es necesario enviar los 105 registros cada dos segundos. Cada rango se envía como un lote independiente inmediatamente después de leerlo.

Si Modbus no responde, el gateway debe enviar cada 10 segundos un lote con `readings: []` y `poll.error`. Esto demuestra que el gateway está conectado aunque el controlador no responda.

## Formato de ingestión

```json
{
  "schemaVersion": "1.0",
  "batchKey": "550e8400-e29b-41d4-a716-446655440000:fast:1842",
  "sentAt": "2026-09-05T18:42:16.325Z",
  "gateway": {
    "code": "CAM5-GW-01",
    "bootId": "550e8400-e29b-41d4-a716-446655440000",
    "sequence": 1842,
    "uptimeSeconds": 92841
  },
  "device": {
    "code": "CAM5-CTRL-01",
    "unitId": 1,
    "serialNumber": "CAM5-XXXXXXXX",
    "firmwareVersion": "1.6.0",
    "dataVersion": 16
  },
  "poll": {
    "startedAt": "2026-09-05T18:42:16.201Z",
    "completedAt": "2026-09-05T18:42:16.315Z",
    "expectedRegisters": 2,
    "latencyMs": 114
  },
  "readings": [
    {
      "register": 418,
      "rawValue": 684,
      "recordedAt": "2026-09-05T18:42:16.315Z",
      "sequence": 1842,
      "quality": "good",
      "flags": []
    },
    {
      "register": 419,
      "rawValue": 541,
      "recordedAt": "2026-09-05T18:42:16.315Z",
      "sequence": 1842,
      "quality": "good",
      "flags": []
    }
  ]
}
```

El ejemplo muestra dos registros para que sea legible. En operación, `expectedRegisters` y `readings` deben contener el rango completo entregado por `GET /gateway/config` (por ejemplo, 36 elementos para 418–453).

### Campos obligatorios

- `schemaVersion`: siempre `1.0`.
- `batchKey`: identificador único e inmutable del lote, máximo 160 caracteres. Reenviar el mismo lote debe conservar esta clave.
- `sentAt`: hora UTC en que el gateway envía la solicitud.
- `gateway.code`: código configurado en HoitLive Core.
- `gateway.bootId`: UUID nuevo en cada arranque del servicio.
- `gateway.sequence`: contador entero ascendente durante ese arranque.
- `device.code`: código del controlador configurado en el portal.
- `device.unitId`: Unit ID Modbus, inicialmente `1`.
- `poll.startedAt` y `poll.completedAt`: inicio y término de la consulta Modbus en UTC.
- `poll.expectedRegisters`: cantidad de registros que debía entregar ese rango.
- `readings[].register`: dirección nativa CAM5, no la referencia `400xxx`.
- `readings[].rawValue`: palabra Modbus sin escala, entre `0` y `65535`.

`recordedAt` puede omitirse en cada lectura; en ese caso se utiliza `poll.completedAt`. `sequence` también puede omitirse y heredará `gateway.sequence`.

### Calidad

Valores aceptados en `quality`:

- `good`: lectura válida.
- `stale`: lectura recuperada de un buffer o recibida fuera de su ciclo normal.
- `bad`: el gateway sabe que el dato no es confiable.

Banderas aceptadas en `flags`:

- `restart`
- `communication_lost`
- `local_forced`
- `remote_forced`
- `over_range`

El backend reconoce automáticamente `0x8000` y `0xFFFF`, convierte registros `Int16`, aplica la escala del catálogo, valida límites y agrega `over_range` cuando corresponde. Por eso el gateway debe transmitir el valor crudo y no un valor ya escalado.

### Error de Modbus

```json
{
  "schemaVersion": "1.0",
  "batchKey": "550e8400-e29b-41d4-a716-446655440000:error:1843",
  "sentAt": "2026-09-05T18:42:26.325Z",
  "gateway": {
    "code": "CAM5-GW-01",
    "bootId": "550e8400-e29b-41d4-a716-446655440000",
    "sequence": 1843,
    "uptimeSeconds": 92851
  },
  "device": { "code": "CAM5-CTRL-01", "unitId": 1 },
  "poll": {
    "startedAt": "2026-09-05T18:42:23.201Z",
    "completedAt": "2026-09-05T18:42:26.315Z",
    "expectedRegisters": 36,
    "latencyMs": 3114,
    "error": {
      "code": "MODBUS_TIMEOUT",
      "message": "Sin respuesta después de 2 reintentos"
    }
  },
  "readings": []
}
```

## Respuesta

Un lote nuevo responde HTTP `202`:

```json
{
  "status": "accepted",
  "batchId": "55e57c28-fc66-4e54-8d61-54e25d5d4f25",
  "accepted": 36,
  "operationalReadings": 36,
  "success": true,
  "serverTime": "2026-09-05T18:42:16.411Z",
  "nextUploadInMs": 2000
}
```

Reenviar el mismo `batchKey` responde HTTP `200` con `status: "duplicate"`. Esto se considera éxito: el gateway debe retirar ese lote de su cola local.

Errores `400`, `403`, `404`, `413` o `422` indican que el lote no debe repetirse sin corregirlo. Errores `429` o `5xx` deben reintentarse con espera exponencial.

## Almacenamiento y reintentos del gateway

- Guardar localmente cada lote antes de enviarlo.
- Eliminarlo solamente después de una respuesta `accepted` o `duplicate`.
- Reintentar fallos de red y respuestas `5xx` después de 2, 5, 15, 30 y 60 segundos.
- Conservar al menos 72 horas; el backend acepta reenvíos de hasta 7 días.
- Mantener el `batchKey`, `recordedAt` y `sequence` originales durante los reintentos.
- No enviar dos solicitudes simultáneas para el mismo controlador.
- Sincronizar el gateway mediante NTP y utilizar siempre UTC.

## Configuración remota

`GET /gateway/config` devuelve los controladores autorizados, host, puerto, Unit ID, rangos, intervalos, tipos, escalas, unidades y códigos de error. El script debe consultar esta ruta al iniciar y luego cada 15 minutos. Si la consulta falla, debe continuar con la última configuración válida almacenada localmente.

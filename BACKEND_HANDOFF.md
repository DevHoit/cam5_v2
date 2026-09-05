# CAM5 CORE — contrato para backend

El frontend queda preparado para una primera instalación con una ubicación, un gateway y un equipo CAM-5 accesible mediante Modbus TCP.

## Cadena de adquisición

```text
Sensores → CAM-5 → CAM5-GW-01 → API CAM5 CORE → Portal
```

- Lectura de campo: Modbus TCP, FC03.
- Rango documentado: registros nativos 418–522.
- Referencia humana mostrada: 400418–400522.
- Unit ID inicial: 1.
- Sondeo inicial: 2 segundos.
- Timeout inicial: 1000 ms, dos reintentos.
- El portal no debe enviar directamente escrituras Modbus al equipo.

El catálogo completo está definido en `app/cam5-model.ts`. Incluye tipo, escala, unidad y código de error de los 105 registros.

## Entradas y señales

Capacidad física:

- 12 sensores de temperatura SAW.
- 4 interfaces UHF.
- 8 sensores ambientales.
- 6 salidas físicas de relé.

Señales operativas del frontend:

- T01–T12: temperatura.
- A01–A08: temperatura ambiente.
- H01–H08: humedad relativa.
- SD1–SD4: descarga superficial total.
- PD1–PD4: descarga parcial total.
- El catálogo también contiene ruido, conteos y tendencias Alpha, Beta y Phi.

## Calidad de dato

Cada lectura debe entregar:

- valor procesado y valor crudo;
- registro nativo;
- timestamp de origen y timestamp de recepción;
- secuencia;
- calidad `good`, `stale`, `bad` o `disabled`;
- banderas `restart`, `communication_lost`, `local_forced`, `remote_forced` y `over_range`.

Los valores `0x8000` y `0xFFFF` deben convertirse en calidad inválida, no en mediciones normales.

## Alarmas

- Advertencia y alarma son niveles diferentes.
- La activación requiere tres lecturas consecutivas por defecto.
- La recuperación requiere persistencia e histéresis.
- Los límites pueden tener una base global y una excepción por canal.
- Toda alarma conserva apertura, reconocimiento, cierre, responsable, notas y orden de trabajo relacionada.
- La matriz de seis relés se configura y audita mediante el backend.

## Endpoints previstos

El cliente tipado está en `app/cam5-api.ts`. Las familias principales son:

- `/health`
- `/gateways/{gatewayId}/devices/discover`
- `/devices/{deviceId}`
- `/devices/{deviceId}/modbus/test`
- `/devices/{deviceId}/registers`
- `/devices/{deviceId}/channels`
- `/devices/{deviceId}/inputs`
- `/devices/{deviceId}/relays`
- `/devices/{deviceId}/commissioning`
- `/devices/{deviceId}/configuration/*`
- `/assets/{assetId}/readings/*`
- `/assets/{assetId}/trends`
- `/alarms/*`
- `/work-orders/*`

## Puesta en marcha

El equipo no se marca productivo hasta completar:

1. Descubrimiento de identidad, modelo, serie, firmware y versión de datos.
2. Lectura FC03 completa del bloque 418–522.
3. Confirmación física de bandas, códigos, antenas e índices ambientales.
4. Sincronización de reloj y zona horaria.
5. Validación de umbrales, persistencia y seis relés.
6. Respaldo inicial de configuración.
7. Verificación de histórico y calidad durante 24 horas.
8. Aceptación operacional.

## Seguridad de operaciones

La carga de `config.xml`, restauración, firmware y reinicio deben ejecutarse a través del gateway con:

- rol Administrador;
- validación previa;
- confirmación explícita;
- registro de auditoría;
- snapshot recuperable antes del cambio.

## Variable de entorno

```text
NEXT_PUBLIC_CAM5_API_URL=https://api.ejemplo.cl/api/v1
```

Mientras no exista esta variable y no se integren los hooks de consulta, el portal conserva fixtures y estado local para demostrar el flujo completo.

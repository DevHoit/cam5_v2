# CAM5 CORE — contrato para backend

El frontend admite varios clientes. Cada cliente contiene uno o más sitios; cada sitio contiene puntos de medición y gateways, y cada equipo CAM-5 relaciona un punto con un gateway del mismo sitio mediante Modbus TCP.

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
- `/auth/login`
- `/auth/logout`
- `/auth/session`
- `/auth/context`
- `/hierarchy`
- `/gateway/config`
- `/gateway/ingest`
- `/history`
- `/me/access`
- `/users`
- `/users/{userId}`
- `/roles`
- `/reading-profiles`
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

## Persistencia y autorización

La base PostgreSQL, sus migraciones y el seed se encuentran en `db/` y `drizzle/`. El diseño incluye datos crudos, última lectura, agregados históricos, perfiles Modbus y control de acceso por rol, cliente, sitio y punto de medición.

Ya están implementadas las sesiones locales con contexto de sitio activo, contraseñas con `scrypt`, cookie `HttpOnly` y `SameSite=Strict`, revocación al cerrar sesión, jerarquía operacional administrable, administración paginada de usuarios con asignación multi-sitio y consulta histórica paginada. La jerarquía permite editar, desactivar/reactivar y eliminar solo elementos sin dependencias; toda mutación se audita. Los endpoints de escritura impiden suspender la cuenta propia y protegen al último administrador activo de cada sitio.

Los perfiles iniciales son Administrador, Ingeniero, Operador y Solo lectura. La autorización se aplica en el backend mediante `db/authorization.ts`; la visibilidad del menú en el frontend es solamente una ayuda visual y no un control de seguridad.

Consultar `DATABASE.md` para el modelo, retención y procedimiento de instalación.

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

## Variables de entorno

```text
NEXT_PUBLIC_CAM5_API_URL=https://api.ejemplo.cl/api/v1
DATABASE_URL=postgresql://usuario:clave@host:5432/cam5
CAM5_ADMIN_EMAIL=administrador@empresa.cl
CAM5_ADMIN_NAME=Nombre del administrador
CAM5_ADMIN_PASSWORD=una-clave-segura-de-al-menos-10-caracteres
```

Sin `DATABASE_URL` el portal no permite iniciar sesión. Las variables `CAM5_ADMIN_*` se usan durante `npm run db:seed`; `NEXT_PUBLIC_CAM5_API_URL` será necesaria cuando se conecte la telemetría proveniente del gateway.

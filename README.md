# HoitLive Core

Portal web multi-cliente de telemetría y gestión de condición para instalaciones IntelliSAW CAM-5.

La estructura operacional admite uno o varios clientes, sitios, puntos de medición y gateways. Cada controlador CAM-5 se asocia a un punto y a uno de los gateways de su mismo sitio mediante Modbus TCP.

## Frontend incluido

- Resumen operacional y mapa de condición.
- Tendencias de temperatura, humedad, ambiente, SD y PD.
- Análisis UHF Total, Alpha, Beta, Phi, ruido y descarga superficial.
- Centro de alarmas conectado a PostgreSQL, con reconocimiento, asignación, notas, atención, cierre y órdenes de trabajo vinculadas.
- Motor automático de reglas por lectura con persistencia, histéresis, muestras consecutivas y detección de pérdida de comunicación.
- Administración paginada de umbrales por canal con autorización y auditoría.
- Histórico, reportes y auditoría.
- Login/logout persistente, usuarios, roles y auditoría conectados a PostgreSQL.
- Búsqueda, filtros y paginación en los listados operativos y administrativos.
- Histórico consultable por rango de fechas, canal y texto.
- Ingestión autenticada e idempotente desde gateways, con valores crudos, calidad y buffer de reenvío.
- Estructura operacional administrable de clientes, sitios, puntos, gateways y controladores, con edición, desactivación reversible y eliminación protegida por dependencias.
- Notificaciones e integraciones.
- Configuración de canales, umbrales, gateway y mapa Modbus.
- Puesta en marcha con identidad, 24 entradas físicas, alarmas, seis relés, red, respaldo y checklist de producción.
- Catálogo CAM-5/IRM-48 completo: 105 registros nativos entre 418 y 522.

## Desarrollo

Requiere Node.js 22.13 o superior.

```bash
npm install
npm run dev
```

Abrir `http://localhost:3000`.

## Base de datos

La capa de persistencia utiliza PostgreSQL y Drizzle ORM. Incluye telemetría, histórico agregado, alarmas, mantenimiento, auditoría, perfiles de adquisición y cuatro perfiles de acceso al portal.

Antes del primer ingreso, configurar `DATABASE_URL`, `CAM5_ADMIN_EMAIL`, `CAM5_ADMIN_NAME` y `CAM5_ADMIN_PASSWORD`. La contraseña debe tener al menos 10 caracteres.

La revisión de comunicaciones está programada cada minuto mediante `vercel.json`. Requiere `CRON_SECRET`, que Vercel envía como `Authorization: Bearer <CRON_SECRET>` al endpoint `GET /api/v1/alarms/evaluate`. Esa frecuencia requiere Vercel Pro; en Hobby debe retirarse la entrada `crons` y utilizarse un programador externo o la evaluación reactiva al recibir telemetría y consultar alarmas.

```bash
npm run db:migrate
npm run db:seed
```

La configuración y el modelo completo están documentados en [`DATABASE.md`](./DATABASE.md).

Validaciones:

```bash
npm run build
npm run lint
npm run test:db
```

## Vercel

El proyecto es Next.js nativo.

- Root Directory: raíz del repositorio (`.`).
- Build Command: `npm run build`.
- Output Directory: dejar vacío; Vercel utiliza `.next` automáticamente.
- Install Command: `npm install`.
- Framework Preset: Next.js.

No usar `npm run build:cloudflare` para Vercel, porque genera una salida vinext diferente de `.next`.

## Integración futura

Configurar:

```text
NEXT_PUBLIC_CAM5_API_URL=https://api.ejemplo.cl/api/v1
```

La autenticación, los usuarios, la jerarquía operacional, el histórico, la última telemetría y el ciclo completo de alarmas utilizan rutas internas `/api/v1` conectadas a PostgreSQL. Las curvas históricas de tendencias, parte de la configuración del equipo, reportes y el tablero general de mantenimiento todavía conservan datos de referencia mientras se implementan sus servicios de backend.

El contrato que debe implementar el gateway está en [`gateway/CAM5_GATEWAY_PROTOCOL.md`](./gateway/CAM5_GATEWAY_PROTOCOL.md). Incluye frecuencias, payload JSON, códigos de calidad, reintentos y un emisor Python de referencia.

`NEXT_PUBLIC_CAM5_API_URL` se reserva para ese servicio de telemetría. El cliente tipado está en `app/cam5-api.ts` y el contrato de implementación se encuentra en `BACKEND_HANDOFF.md`.

## Archivos principales

- `app/page.tsx`: aplicación y módulos operativos.
- `app/cam5-engineering.tsx`: puesta en marcha CAM-5.
- `app/cam5-model.ts`: canales, inventario y catálogo Modbus.
- `app/cam5-api.ts`: contrato de API.
- `app/api/v1/`: login, logout, contexto activo, jerarquía, usuarios, histórico, telemetría, alarmas y reglas PostgreSQL.
- `db/alarm-engine.ts`: evaluación automática de umbrales, calidad y comunicaciones.
- `app/globals.css`: sistema visual y responsive.
- `BACKEND_HANDOFF.md`: guía de conexión del backend.

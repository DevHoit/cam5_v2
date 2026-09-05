# CAM5 CORE

Portal web multi-cliente de telemetría y gestión de condición para instalaciones IntelliSAW CAM-5.

La estructura operacional admite uno o varios clientes, sitios, puntos de medición y gateways. Cada controlador CAM-5 se asocia a un punto y a uno de los gateways de su mismo sitio mediante Modbus TCP.

## Frontend incluido

- Resumen operacional y mapa de condición.
- Tendencias de temperatura, humedad, ambiente, SD y PD.
- Análisis UHF Total, Alpha, Beta, Phi, ruido y descarga superficial.
- Centro de alertas, reconocimiento, cierre y órdenes de trabajo.
- Histórico, reportes y auditoría.
- Login/logout persistente, usuarios, roles y auditoría conectados a PostgreSQL.
- Búsqueda, filtros y paginación en los listados operativos y administrativos.
- Histórico consultable por rango de fechas, canal y texto.
- Estructura operacional de clientes, sitios, puntos, gateways y controladores.
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

La autenticación, los usuarios, la jerarquía operacional y el histórico utilizan rutas internas `/api/v1` conectadas a PostgreSQL. El dashboard, tendencias en vivo, alarmas operativas, configuración, reportes y mantenimiento conservan datos de referencia hasta conectar el servicio del gateway.

`NEXT_PUBLIC_CAM5_API_URL` se reserva para ese servicio de telemetría. El cliente tipado está en `app/cam5-api.ts` y el contrato de implementación se encuentra en `BACKEND_HANDOFF.md`.

## Archivos principales

- `app/page.tsx`: aplicación y módulos operativos.
- `app/cam5-engineering.tsx`: puesta en marcha CAM-5.
- `app/cam5-model.ts`: canales, inventario y catálogo Modbus.
- `app/cam5-api.ts`: contrato de API.
- `app/api/v1/`: login, logout, contexto activo, jerarquía, usuarios e histórico PostgreSQL.
- `app/globals.css`: sistema visual y responsive.
- `BACKEND_HANDOFF.md`: guía de conexión del backend.

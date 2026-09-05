# CAM5 CORE

Portal web de telemetría y gestión de condición para una instalación IntelliSAW CAM-5.

El alcance inicial es una ubicación, un gateway `CAM5-GW-01` y un controlador/equipo CAM-5 mediante Modbus TCP.

## Frontend incluido

- Resumen operacional y mapa de condición.
- Tendencias de temperatura, humedad, ambiente, SD y PD.
- Análisis UHF Total, Alpha, Beta, Phi, ruido y descarga superficial.
- Centro de alertas, reconocimiento, cierre y órdenes de trabajo.
- Histórico, reportes y auditoría.
- Activos, usuarios, roles, notificaciones e integraciones.
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

Validaciones:

```bash
npm run build
npm run lint
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

El cliente tipado está en `app/cam5-api.ts` y el contrato de implementación se encuentra en `BACKEND_HANDOFF.md`.

## Archivos principales

- `app/page.tsx`: aplicación y módulos operativos.
- `app/cam5-engineering.tsx`: puesta en marcha CAM-5.
- `app/cam5-model.ts`: canales, inventario y catálogo Modbus.
- `app/cam5-api.ts`: contrato de API.
- `app/globals.css`: sistema visual y responsive.
- `BACKEND_HANDOFF.md`: guía de conexión del backend.

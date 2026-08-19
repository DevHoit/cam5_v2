# CAM5 CORE — entrega de frontend

Esta carpeta contiene la especificación necesaria para conectar el portal CAM5 CORE con el backend sin rediseñar la interfaz.

## Contenido

- `CAM5-frontend-source.zip`: código fuente completo, generado durante el cierre de la entrega.
- `openapi.yaml`: contrato HTTP propuesto para el backend.
- `BACKEND_INTEGRATION.md`: orden recomendado de implementación.
- `DATA_CONTRACTS.md`: campos, estados y reglas que espera la interfaz.
- `DELIVERY_CHECKLIST.md`: criterio de aceptación entre frontend y backend.

## Estado del frontend

El portal incluye dashboard, mapa de condición, tendencias, alarmas, histórico, activos, reportes, mantenimiento, diagnóstico OT, configuración Modbus, integraciones, usuarios y notificaciones.

También incluye:

- navegación compartible mediante `?view=` y `?channel=`;
- estados operativo, atrasado y desconectado;
- simulación de permisos por rol;
- validaciones y confirmaciones de acciones sensibles;
- consistencia de canales y umbrales entre módulos;
- vista previa imprimible de reportes;
- almacenamiento local temporal mientras se incorpora la API.

## Ejecución

Requisitos: Node.js 22.13 o superior.

```bash
npm install
cp .env.example .env.local
npm run dev
```

El backend debe exponer la URL definida en `NEXT_PUBLIC_CAM5_API_URL`.

## Fuente de verdad

Los datos simulados y `localStorage` son exclusivamente una capa temporal del frontend. Una vez conectada la API, usuarios, configuración, telemetría, alarmas, órdenes e informes deben provenir del backend.

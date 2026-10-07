# Scheduler operacional HoitLive Core

HoitLive Core no depende de Vercel Cron para detectar pérdida de telemetría ni para despachar notificaciones.

El ciclo operacional ejecuta, para cada sitio activo:

1. evaluación de comunicación del motor legado;
2. evaluación de cadena de frío;
3. evaluación eléctrica;
4. evaluación ATS;
5. generación de repeticiones de alarmas;
6. procesamiento de la cola de notificaciones.

## Opción A: ejecutar directamente contra la base de datos

En un host que tenga el repositorio y `DATABASE_URL`:

```bash
npm run ops:cycle
```

Para Linux cron, una ejecución cada minuto puede configurarse, por ejemplo, desde el servicio que aloje el worker:

```text
* * * * * cd /ruta/cam5_v2 && /usr/bin/npm run ops:cycle >> /var/log/hoit-ops.log 2>&1
```

El proceso devuelve código distinto de cero si alguna evaluación o entrega falla.

## Opción B: scheduler HTTP externo

El portal expone:

```text
GET  /api/v1/system/operations
POST /api/v1/system/operations
```

Ambos requieren:

```text
Authorization: Bearer <CRON_SECRET>
```

Ejemplo:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://portal.example.com/api/v1/system/operations
```

El scheduler puede ser systemd timer, cron, GitHub Actions, Cloudflare, un VPS u otra infraestructura capaz de realizar una llamada HTTPS. El endpoint no depende de APIs específicas de Vercel.

## Frecuencia

Para V1 se recomienda un ciclo cada 60 segundos. Los umbrales de `staleAfterSeconds` continúan perteneciendo a cada dominio; el scheduler sólo garantiza que la evaluación siga ocurriendo aunque deje de llegar telemetría.

## Seguridad

- `CRON_SECRET` debe ser aleatorio y mantenerse fuera del repositorio.
- No debe reutilizar tokens de gateway.
- La ruta no acepta una sesión normal del portal como sustituto.
- Si `CRON_SECRET` no existe, la ruta responde 503.
- Si el Bearer token no coincide, responde 401.

## Mantenimiento

El dispatcher vuelve a comprobar el estado del activo inmediatamente antes de una entrega asociada a alarma. Si el activo entró en mantenimiento después de encolar la notificación, la entrega queda con estado terminal `suppressed` y no se contacta al proveedor.

## Respaldo durante la consulta del portal

El NOC, las alarmas y el resumen eléctrico evalúan los puntos eléctricos del sitio autenticado antes de responder. Esto permite detectar un PM5560 conectado mediante `gateway_device_bindings`, aunque su `devices.gateway_id` sea nulo, y actualizar su estado operativo al vencer el plazo configurado. Las lecturas genéricas de métricas y el NOC calculan también la vigencia con ese mismo plazo eléctrico; ya no usan 180 segundos o un plazo derivado del polling para esos puntos.

Este respaldo depende de que alguien consulte el portal. No sustituye el scheduler externo cada 60 segundos para detectar pérdidas y procesar escalamiento sin usuarios conectados. Estas rutas no ejecutan el dispatcher de notificaciones. La existencia y funcionamiento del scheduler externo deben verificarse por separado en cada entorno antes del corte de producción.

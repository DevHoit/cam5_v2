# HoitLive Core — Production Cutover

**URL productiva canónica:** https://core.hoitlive.com  
**Rama candidata:** `feature/hoit-core-v1`  
**Rama productiva:** `main`

## Estado previo al corte

- CI de la rama candidata debe finalizar en verde.
- Preview Vercel debe estar `READY`.
- `APP_URL=https://core.hoitlive.com` debe existir en Vercel Production.
- El proyecto Vercel debe ejecutar Node 22.x, alineado con CI y `package.json`.
- `core.hoitlive.com` debe permanecer verificado y asociado al proyecto `cam5_v2`.
- El PR de promoción se mantiene en Draft hasta completar el E2E físico.

## Gate E2E obligatorio

Desde un gateway MDM9607 real, enviar telemetría simulada por HTTPS y verificar:

1. heartbeat y estado ONLINE;
2. ingest de métricas normalizadas;
3. persistencia en históricos y latest readings;
4. Dashboard y Resumen de activo;
5. Tendencias e Históricos;
6. NOC y Centro de Alertas;
7. transición NORMAL -> WARNING -> CRITICAL;
8. ACK;
9. RECOVERY y resolución;
10. pérdida de comunicación OFFLINE y recuperación ONLINE;
11. escalamiento/notificación cuando el entorno externo esté habilitado.

No se requiere CAM5 físico para este gate: el objetivo es validar Gateway -> Core -> Frontend.

## Base de datos

Actualmente Preview y Production comparten la integración Neon. Esto no bloquea el corte actual porque las migraciones de la rama candidata ya han sido ejercitadas por los previews y son compatibles, pero no es el estado objetivo.

Acción posterior obligatoria:

- Production -> Neon PROD;
- Preview/Development -> Neon DEV/STAGING.

Antes de promover a `main`, crear snapshot/backup de la base productiva.

## Promoción

Cuando el gate E2E esté aprobado:

1. convertir el PR de promoción desde Draft a Ready;
2. confirmar CI verde y rama mergeable;
3. merge a `main`;
4. esperar deployment Vercel `target=production` en estado `READY`;
5. verificar que `https://core.hoitlive.com` resuelva al nuevo deployment;
6. ejecutar smoke test post-deploy.

## Smoke test post-deploy

Validar como mínimo:

- login;
- cambio Cliente -> Sitio -> Activo;
- Dashboard;
- Resumen de activo;
- Tendencias;
- Históricos;
- Centro de Alertas;
- NOC;
- `/api/v1/gateway/config`;
- `/api/v1/gateway/heartbeat`;
- `/api/v1/gateway/ingest`.

## Rollback

Si aparece una regresión severa:

1. detener nuevos cambios;
2. promover el deployment productivo anterior en Vercel;
3. no revertir migraciones automáticamente;
4. evaluar compatibilidad de esquema antes de cualquier rollback de DB;
5. conservar logs y payloads que reproduzcan la falla.

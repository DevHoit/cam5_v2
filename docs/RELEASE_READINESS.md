# HoitLive Core V1 — continuidad del paso a producción

Actualizado: 2026-10-07 (Santiago). Rama: `feature/hoit-core-v1`. PR candidato: #2, Draft. No promover a `main` mientras los gates sigan pendientes.

## Comprobaciones de esta revisión

- Vercel conserva Node 22.x. APP_URL de Preview apunta a `https://cam5v2-git-feature-hoit-core-v1-hoit1.vercel.app`; Production conserva `https://core.hoitlive.com`.
- `staging.hoitlive.com` está asociado como alias en Vercel, pero su DNS no está configurado. No tratarlo como entorno disponible.
- La salud del preview fue comprobada por el conector autorizado: HTTP 200, database=ok, environment=preview y revisión `3ada734eb2e7b0c569bcd25f07ad9fd3d4fbcef4`.
- El CI remoto de `3ada734` terminó aprobado. El deployment `dpl_GV9AgFXhyoQnsxuXZsU8VWqVYdzS` está READY y sus logs confirman migraciones aplicadas correctamente.
- La rama Preview `feature/hoit-core-v1` tiene overrides de conexión a Neon `hoit-core-staging`, endpoint `ep-raspy-mouse-acliv67r`. Production conserva sus variables originales. Development y otros Preview todavía heredan la integración original; el aislamiento no se extiende a ellos.
- `HOIT_ALLOW_NONPROD_MIGRATIONS=1` existe exclusivamente en el Preview de esta rama, para migrar su base aislada.
- Se creó en el portal de staging el sitio `E2E-STAGING` de `ClienteDemo`, los activos `E2E-COLD-01` y `E2E-ELEC-01`, el gateway `GW-E2E-STAGING` y la plantilla `E2E-PM5560` con 17 métricas. La prueba desplegada necesita una credencial de gateway y transporte autorizado por Deployment Protection.
- Cinco pruebas locales de integración pasaron: PM5560, ATS, cadena de frío, rechazo entre sitios y fallas/recuperación simultáneas. No sustituyen el E2E HTTPS desplegado ni el gateway físico.
- La ingestión V1 ahora revierte el mensaje completo cuando una muestra posterior es inválida, incluyendo lecturas, lotes y efectos de alarmas anteriores del mismo mensaje.
- Los reenvíos históricos conservan el `lastReadAt` más reciente y no reemplazan lecturas latest con muestras antiguas.
- Las alarmas genéricas de una sola métrica incluyen `context.metricKey`, utilizado por Centro de Alertas/Histórico para abrir la tendencia de origen. Las compuestas conservan `metricKeys` sin elegir una métrica arbitraria.
- Se incorpora `npm run release:preflight`: comprobación de salud, revisión, entorno Preview y destinos PostgreSQL distintos, sin escrituras ni secretos en la salida. Sus regresiones se ejecutan en CI.

## Gates pendientes

1. Mantener el aislamiento del Preview de esta rama; extenderlo a Development y otros Preview antes de simular allí. Revisar/rotar las credenciales compartidas durante la configuración sin interrumpir Production.
2. E2E desde gateway MDM9607: heartbeat, ingest V1, históricos/latest, NORMAL → WARNING → CRITICAL → RECOVERY, ACK, escalamiento, OFFLINE → ONLINE.
3. Recorrido del portal con datos del E2E: Dashboard, Resumen, Tendencias, Histórico, Alertas y NOC; reportes y permisos por rol.
4. Completar la revisión autenticada móvil/tablet. Las pruebas backend y el build no sustituyen esa revisión.
5. Snapshot/backup de PROD y comprobación de recuperación antes del merge.
6. Merge y smoke test productivo sólo después de los gates anteriores.

Seguimientos existentes: #3 (aislamiento Neon), #4 (`TimeoutNegativeWarning` en runtime). Runbook: `docs/PRODUCTION_CUTOVER.md`. `docs/FRONTEND_STATUS.md` conserva el historial del desarrollo visual y no debe interpretarse como aprobación actual de todos los gates.

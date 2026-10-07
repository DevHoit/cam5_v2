# HoitLive Core V1 — continuidad del paso a producción

Actualizado: 2026-10-06 (Santiago). Rama: `feature/hoit-core-v1`. PR candidato: #2, Draft. No promover a `main` mientras los gates sigan pendientes.

## Comprobaciones de esta revisión

- Vercel conserva Node 22.x. APP_URL de Preview apunta a `https://cam5v2-git-feature-hoit-core-v1-hoit1.vercel.app`; Production conserva `https://core.hoitlive.com`.
- `staging.hoitlive.com` está asociado como alias en Vercel, pero su DNS no está configurado. No tratarlo como entorno disponible.
- La salud del preview de rama fue comprobada por el conector autorizado: HTTP 200, database=ok, environment=preview y revisión `d0d48ba9f3de43a500194f68262a67df711e315a`.
- El CI remoto de `d0d48ba` terminó aprobado y su deployment está READY.
- La integración `cam5-db` sigue conectada a Production, Preview y Development. La separación de bases **no está completada**.
- La ingestión V1 ahora revierte el mensaje completo cuando una muestra posterior es inválida, incluyendo lecturas, lotes y efectos de alarmas anteriores del mismo mensaje.
- Los reenvíos históricos conservan el `lastReadAt` más reciente y no reemplazan lecturas latest con muestras antiguas.
- Las alarmas genéricas de una sola métrica incluyen `context.metricKey`, utilizado por Centro de Alertas/Histórico para abrir la tendencia de origen. Las compuestas conservan `metricKeys` sin elegir una métrica arbitraria.
- Se incorpora `npm run release:preflight`: comprobación de salud, revisión, entorno Preview y destinos PostgreSQL distintos, sin escrituras ni secretos en la salida. Sus regresiones se ejecutan en CI.

## Gates pendientes

1. Separar Neon STAGING de PROD y comprobar las credenciales efectivas de cada deployment. No ejecutar simulación sobre la base compartida.
2. E2E desde gateway MDM9607: heartbeat, ingest V1, históricos/latest, NORMAL → WARNING → CRITICAL → RECOVERY, ACK, escalamiento, OFFLINE → ONLINE.
3. Recorrido del portal con datos del E2E: Dashboard, Resumen, Tendencias, Histórico, Alertas y NOC; reportes y permisos por rol.
4. Completar la revisión autenticada móvil/tablet. Las pruebas backend y el build no sustituyen esa revisión.
5. Snapshot/backup de PROD y comprobación de recuperación antes del merge.
6. Merge y smoke test productivo sólo después de los gates anteriores.

Seguimientos existentes: #3 (aislamiento Neon), #4 (`TimeoutNegativeWarning` en runtime). Runbook: `docs/PRODUCTION_CUTOVER.md`. `docs/FRONTEND_STATUS.md` conserva el historial del desarrollo visual y no debe interpretarse como aprobación actual de todos los gates.

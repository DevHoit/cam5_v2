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

## E2E HTTPS desplegado — 2026-10-07, 00:29–00:32 Santiago

- Preview comprobado en revisión `bf3e715663a8929758e9857d698a26253ca432b8`: HTTP 200, database=ok, environment=preview.
- La credencial temporal de 30 días de `GW-E2E-STAGING` autenticó correctamente. No se registra ningún token en este documento.
- El dispositivo genérico `PM5560-E2E-01` no tenía binding de adquisición y config respondió 409. Se creó por el flujo eléctrico especializado el punto `E2E-PM-02` y el medidor `PM5560-E2E-02`, con binding RS485 de laboratorio. La ruta `/dev/ttyS1` es configuración de prueba y no valida el puerto físico del MDM9607.
- El simulador existente se ejecutó en una sesión efímera de Vercel, con acceso temporal autorizado a Deployment Protection, sin desactivarla. No se escribió directamente a Neon.
- Config V1 aprobado; seis lotes de una muestra aceptados HTTP 202: normal (2), subtensión (2), recuperación normal (2). Tres heartbeats aceptados HTTP 202.
- Se configuró únicamente en `E2E-PM-02`: voltaje L-N mínimo 210 V, máximo 250 V, histéresis 2 V, pérdida de telemetría 120 s, persistencia de umbral 0 s.
- Subtensión creó tres alarmas críticas L1/L2/L3 (aprox. 180–185 V). ACK de L2 verificado con estado Reconocida y actividad «Evento reconocido».
- Tras las muestras normales: Resumen mostró Operativo, condición Normal, 0 alertas activas, 1/1 dispositivos operativos y 17/17 métricas vigentes.
- Histórico mostró 102 mediciones (6 muestras × 17 métricas), con timestamps y calidad Válida.
- El selector global de activos requirió recarga para incorporar el punto recién creado; queda pendiente revisar su invalidación después de altas desde el módulo eléctrico.
- Este avance valida el circuito simulador HTTPS → Core → portal para PM5560 y CRITICAL → RECOVERY + ACK. No valida gateway físico, WARNING, antirrebote con persistencia, escalamiento, entregas mail/WhatsApp, OFFLINE/ONLINE completo, móvil ni permisos por rol. Los gates productivos siguen abiertos.

## Pruebas adicionales — 2026-10-07, 00:36–00:42 Santiago

- Reconexión HTTPS aprobada: al reanudar ingest + heartbeat, Resumen pasó de Sin telemetría a Operativo/Normal y 17/17 métricas vigentes.
- Desconexión NO aprobada: tras más de 5 minutos sin datos, Resumen reconoció 17 métricas atrasadas, pero mantuvo el dispositivo Operativo y el contador 1/1. NOC mostró el PM5560 como Operativo pese a última lectura hace 5 minutos; no había alarma de comunicación para el medidor especializado.
- Causa a revisar: el GET de alarmas ejecuta sólo el evaluador legado; éste une devices.gateway_id, mientras el PM5560 especializado usa gateway_device_bindings. El evaluador eléctrico requiere un ciclo operacional independiente. El repositorio sólo declara Cron de agregación de tendencias; no se confirmó un scheduler externo activo. Además, NOC reutiliza estados persistidos sin derivar frescura del dispositivo.
- Persistencia aprobada en el Preview: se configuró thresholdDelaySeconds=60 exclusivamente en E2E-PM-02. Una muestra de subtensión a 03:38:39 UTC seguida de normal a 03:38:49 UTC no reabrió alarmas. Cinco muestras sostenidas entre 03:39:19 y 03:41:00 UTC reabrieron las tres críticas; la trazabilidad registró recurrencia a las 00:40 Santiago.
- Recuperación posterior enviada: muestra normal + heartbeat HTTP 202 a 03:41:42 UTC. Simulador detenido al terminar; no supone telemetría continua.
- 27 pruebas locales aprobadas, sin contacto real con proveedores: operations-cycle (1), escalation-engine (6), access-scope (7), area-scope (2), pm5560-e2e (1), escalation-notification (3), on-call-engine (4), gateway-heartbeat-spec-v1 (3). Validan alcance administrativo, aislamiento, destinatarios, cancelación por ACK y heartbeat; no sustituyen el recorrido autenticado desplegado con otras cuentas.
- Escalamiento desplegado pendiente: ClienteDemo no tiene políticas ni guardias. No se crearon destinatarios ficticios ni se realizaron entregas reales mail/WhatsApp.
- Móvil pendiente: la emulación por atajos del navegador no alteró el viewport (1363×936). No se considera prueba móvil ni tablet.
- Mantener bloqueo de producción hasta resolver desconexión/scheduler, validar escalamiento desplegado, móvil, otras cuentas, hardware y backup.

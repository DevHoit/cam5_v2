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

## Corrección de conectividad eléctrica — 2026-10-07

La corrección conserva los estados de comisionamiento y mantenimiento; actualiza dispositivos activos/offline según métricas buenas y vigentes; descarta métricas vencidas de la evaluación de umbrales; unifica el plazo eléctrico entre alarmas, NOC y resúmenes. El NOC reconoce `active` como saludable y revisa los puntos eléctricos del sitio antes de leer alarmas. Las consultas no despachan mensajes.

Validación local: 22 pruebas pasaron (PM5560 con desconexión/reconexión, repetición sin duplicados, aumento de severidad, datos malos recientes, mantenimiento y aislamiento por sitio; ciclo operacional; acceso y áreas; ingest/heartbeat SPEC; ATS y cadena de frío). TypeScript y ESLint de archivos modificados aprobados. Pendiente verificar el nuevo preview y confirmar un scheduler externo periódico; no se habilitó un ciclo global que pueda contactar destinatarios heredados de la base clonada. Continúan pendientes pruebas móviles y de roles con sesiones reales.


### Verificación del preview de conectividad

Preview `323007c3740f51e527d3ee1b134306beb2d53db7`: `/api/v1/health` 200, entorno preview y base ok. En el NOC, PM5560-E2E-02 dejó de figurar operativo tras 15 minutos sin muestras y abrió `Sin telemetría`, crítica. El simulador envió una muestra normal a las 03:57:00.991 UTC (00:57 Santiago), ingest 202 accepted=true y heartbeat 202; el NOC mostró el medidor operativo y su alarma dejó de estar activa. Se corrigió además el contador del frontend para reconocer `active` como saludable, igual que la API. Build Next.js completo, TypeScript y lint aprobados. No se modificó main ni se promovió producción.


## Scheduler de Preview — 2026-10-07

Se incorpora evaluación operacional aislada por sitio, con token propio del Preview y despacho bloqueado por el servidor. El ciclo limita también los targets de reglas de alcance tenant; no procesa escalamiento/entregas globales. Se incorpora worker HTTPS de tres ciclos a intervalos de 60 s, con health y comprobación de modo/alcance. Las alarmas y sus colas pueden cambiar dentro del sitio, sin contactar proveedores. El endpoint productivo conserva CRON_SECRET y su ciclo completo.

Pruebas locales: ciclo completo existente, aislamiento de dos sitios con regla tenant, pérdida de medidor sin binding legado, entregas de otro sitio intactas/cero llamadas al proveedor, rechazo de sitio inexistente, rechazo de despacho con scope parcial y política de autenticación Preview/Production. La instalación de un scheduler permanente continúa pendiente hasta confirmar host, acceso y supervisión; el ensayo periódico acotado no equivale a esa instalación.

## Evidencia 2026-10-07: ciclo periódico aislado de Preview

Verificación realizada el 7 de octubre de 2026, después del cierre inicial de este registro.

### Implementación y alcance

- Commit de código desplegado: `a5e673bde48d134acf5fa33c37a7a61d91e08837` en `feature/hoit-core-v1`.
- Deployment Preview READY: `dpl_7D4HRCGwFgc534fHbR4mL6qeoft8`.
- El endpoint de operaciones exige un token independiente y un código de sitio configurados exclusivamente para el Preview de esta rama.
- El servidor fuerza `evaluate_only` para entornos Vercel no productivos. Configuración faltante o sitio ambiguo/inactivo falla cerrado; no hereda el secreto productivo.
- Se evalúa sólo `E2E-STAGING`, incluidas reglas de alcance cliente: sus targets se filtran antes de modificar estados y alarmas.
- Se omiten los procesadores de escalamiento y despacho. La evaluación puede abrir/resolver alarmas y encolar entregas/trabajos según políticas del sitio; esas colas no se despachan durante este modo.
- Se añadió `scripts/poll-preview-operations.py`: worker HTTPS limitado a la URL de esta rama, intervalo mínimo 60 s, tres ciclos por defecto y validación de health/entorno/alcance en cada ciclo.
- El acceso temporal a Deployment Protection se usa mediante cookies; la protección permanece habilitada. No se incluyen credenciales en este documento.

### Validación local y desplegada

Diez pruebas seleccionadas pasaron, además de TypeScript, ESLint, compilación del worker y build de Next.js. El caso local con dos sitios verificó desconexión del medidor del laboratorio, aislamiento de una regla de cliente, preservación de entregas del otro sitio y cero llamadas a proveedores.

En HTTPS real, un token inválido recibió HTTP 401. Los tres ciclos válidos acreditaron la revisión indicada, base sana, exactamente un sitio, cinco evaluaciones por ciclo, cero fallos y `dispatchSkipped=true`; el worker comprobó cero trabajos de notificación y escalamiento procesados.

| Ciclo | Inicio UTC | Fin UTC | Evaluaciones | Fallos |
| --- | --- | --- | --- | --- |
| 1 | 14:54:43.958 | 14:54:52.393 | 5 | 0 |
| 2 | 14:55:43.857 | 14:55:52.220 | 5 | 0 |
| 3 | 14:56:43.819 | 14:56:51.826 | 5 | 0 |

Los intervalos entre inicios fueron 59.899 s y 59.962 s; el worker programa cada 60 s desde su inicio local de ciclo. Se solicitó la detención del recurso temporal tras recuperar la evidencia. No se modificó `main` ni se promovió producción.

### Estado para continuidad

La evaluación periódica aislada quedó desplegada y probada. **No hay un servicio permanente instalado por este avance.** Sigue pendiente definir un host supervisado con credenciales/acceso renovables y verificar continuidad. Tampoco se ha validado despacho/escalamiento real a destinatarios: requiere revisión previa de políticas y destinatarios del laboratorio. Mantener pendientes las pruebas de roles, móvil, hardware físico, respaldo/restauración y gates de producción anteriores.

## Evidencia 2026-10-07: scheduler administrado de Preview instalado y activo

Actualización del 7 de octubre de 2026, posterior al ensayo HTTPS de la sección 17. El usuario indicó que no dispone de un host propio; se implementó la continuidad con Vercel Workflow 5.1.0 dentro del Preview existente.

### Implementación

- Código desplegado: `7504c7800eb2d92260715484889db86bb8533e4f`.
- Deployment READY: `dpl_BZnVdCKRvgvFMjj6KnNRVhvehgk2`.
- Nuevo endpoint de control `/api/v1/system/scheduler`: POST inicia, GET consulta y DELETE detiene. Bearer independiente del laboratorio; token rotado sólo en el Preview de `feature/hoit-core-v1`.
- Sólo funciona en Preview configurado y exclusivamente en `evaluate_only`; producción y desarrollo se rechazan. Cada paso revalida el sitio activo.
- Migración `0032_preview_operational_scheduler`: control singleton persistido, generación, run, contador, recibo del paso y tiempos/resultado. Aplicada en la base aislada del Preview durante su build.
- El lock de fila y las escrituras de alarma/recibo comparten transacción. Un paso reentregado no duplica el ciclo; una generación nueva bloquea ejecuciones antiguas.
- Workflow conserva el estado y se suspende hasta el próximo ciclo. No necesita un equipo del usuario encendido ni el cliente externo que consultó la prueba.
- Tras los reintentos acotados de un paso fallido, espera 60 s y vuelve a intentar. Cada 300 iteraciones continúa en un run nuevo para acotar el replay.
- GET informa `healthy`, edad del último ciclo y estado del run; requiere último resultado correcto, run ejecutándose y ciclo de menos de 180 s.
- No se desactivó Deployment Protection. Las invocaciones internas del workflow usan el runtime administrado; el enlace temporal sólo permitió iniciar/consultar el control durante el ensayo.

### Pruebas y evidencia real

Pasaron 21 pruebas seleccionadas: scheduler, operaciones, política de entornos, reglas, PM5560 y escalamiento local. ESLint de los archivos nuevos/modificados y build de Next.js, incluido TypeScript y compilador Workflow, aprobados.

El primer ensayo de activación terminó con `HTTPError`; no se capturó el detalle suficiente para atribuir su causa. El intento posterior inició correctamente el run y permitió completar la prueba. Los errores/timeout del transporte al recuperar logs no implicaron pérdida del proceso remoto; se recuperó la evidencia al terminar.

| Ciclo inicial | Inicio UTC | Fin UTC | Resultado |
| --- | --- | --- | --- |
| 1 | 2026-10-07T15:29:38.235Z | 2026-10-07T15:29:49.258Z | Correcto; saludable |
| 2 | 2026-10-07T15:30:41.890Z | 2026-10-07T15:30:52.881Z | Correcto; saludable |
| 3 | 2026-10-07T15:31:44.839Z | 2026-10-07T15:31:55.573Z | Correcto; saludable |

El intervalo programado es 60 s desde el inicio del ciclo. Los intervalos observados entre estos inicios fueron 63.655 s y 62.949 s; la entrega de la cola introduce variación, por lo que no se promete exactitud de reloj.

- Un token inválido recibió HTTP 401.
- Repetir POST conservó el mismo run/generación, sin duplicarlo.
- DELETE dejó el contador en 3. Tras esperar 70 s permaneció en 3 y el run terminó como `completed`.
- El reinicio creó una generación y un run distintos.
- Se comprobaron dos ciclos correctos tras reiniciar, con estado saludable.
- Run activo al cierre: `wrun_41M4BFYKRK0GT8JKSFT2KX3VJC`.
- Último ciclo verificado: inicio `2026-10-07T15:34:17.991Z`, fin `2026-10-07T15:34:28.921Z`.
- El cliente de prueba envió **cero llamadas para ejecutar ciclos**: sólo health, inicio, consulta y parada del scheduler. Los ciclos los ejecutó Vercel.
- Se solicitó la detención del recurso temporal de prueba; el workflow administrado se dejó habilitado.
- Las evaluaciones no ejecutan los procesadores de escalamiento ni notificaciones. No se enviaron mensajes a destinatarios de la base clonada.

### Límites y continuidad

Esta sección reemplaza el pendiente de instalación permanente de la sección 17: ahora existe un scheduler administrado activado. La verificación desplegada cubre cinco ciclos y parada/reinicio; todavía falta observar continuidad prolongada y el relevo real después de 300 iteraciones. No se ha ensayado un corte de la plataforma Vercel.

El run queda ligado al deployment que lo inició. Al cambiar código, detener y reiniciar explícitamente desde el nuevo Preview. Un fallo terminal debe detectarse por estado/edad del ciclo y recuperarse con DELETE/POST; no se configuraron avisos externos de salud del scheduler. El consumo de Workflow, datos, colas y Functions se factura según Vercel y requiere seguimiento.

Siguiente bloque: revisar políticas/destinatarios del laboratorio y verificar escalamiento/notificaciones desplegados con destinos de prueba identificados. Permanecen pendientes roles con sesiones reales, móvil, hardware físico, respaldo/restauración y corte productivo. No se modificó `main` ni se promovió producción.

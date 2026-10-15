# Revisión de rendimiento del portal — 13-10-2026

## Alcance y evidencia

Revisión de navegación, arranque, cambio de cliente/sitio/activo, transporte HTTP de los módulos, sondeo de telemetría, autenticación, jerarquía, histórico y aislamiento. Base: commit f134e0b, solo feature/hoit-core-v1 / Preview.

Los hallazgos provienen del código y las pruebas locales. No se dispone aún de una traza autenticada de navegación en Preview ni de EXPLAIN ANALYZE sobre la base remota. Las cifras siguientes son conteos de operaciones o resultados de pruebas deterministas; no son mejoras medidas en segundos ni p95 de usuarios reales.

## Hallazgos y cambios aplicados

| Área | Antes | Después | Evidencia / límite |
| --- | --- | --- | --- |
| Arranque | GET sesión, luego GET jerarquía; validación de sesión repetida | GET auth/bootstrap devuelve sesión y jerarquía con una validación | 2 viajes HTTP → 1 para este tramo; telemetría sigue siendo independiente |
| Cambio de sitio | PATCH contexto, luego GET jerarquía | PATCH contexto incluye jerarquía del nuevo sitio | 2 viajes → 1; se reutilizan los ámbitos recién autorizados dentro de la misma petición |
| Cambios rápidos | Posibles PATCH simultáneos y respuestas fuera de orden | Bloqueo de cambios concurrentes, panel de carga y descarte de lecturas del contexto anterior | No se realiza cambio optimista de permisos ni se muestran datos del sitio anterior |
| Repetición de GET | Cada componente emite su propio fetch | Transporte común comparte peticiones idénticas en curso | Prueba: 20 consumidores simultáneos → 1 llamada de red; respuestas independientes |
| Datos poco variables | Configuración eléctrica/ATS consultada cada ciclo de 5 s | Caché de 15 s para esas configuraciones y jerarquía | Máximo 40 entradas de menos de 1 MB; memoria de la pestaña, sin almacenamiento persistente |
| Métricas actuales | Nueva petición por consumidor | Caché de 2 s para latest normalizado | No se extiende la vigencia del sensor ni se cambia staleAfterSeconds |
| Telemetría heredada | Consulta global cada 2 s incluso en administración y activos genéricos | Solo para activos switchgear_cabinet y vistas que la consumen | Elimina ese tráfico en otros módulos; adquisición del gateway y evaluación de alarmas no cambian |
| Sondeo periódico | setInterval puede solapar peticiones lentas | Sondeo serial, pausa al ocultar pestaña y reanudación al volver | Aplicado a telemetría/alarma global, eléctrico, ATS, frío y diagnóstico; disparadores de tendencias/NOC se pausan ocultos |
| Sesión | UPDATE lastSeenAt en cada petición autorizada | Actualización condicional cuando han pasado 60 s | La sesión, revocación, rol y ámbitos se siguen consultando; no hay caché de autorización |
| Jerarquía | Dos grupos consecutivos de consultas independientes | Nueve consultas en un único Promise.all | Elimina una barrera de espera; no reduce el número de consultas SQL |
| Observabilidad | Difícil separar sesión y datos | Server-Timing en bootstrap, jerarquía, latest normalizado e histórico tabular | Duración de autorización y carga de datos, visible en herramientas de red |
| Catálogo de modelos | Actualización síncrona de estado al entrar en un efecto | Carga asíncrona con descarte tras desmontaje | Corrige la incidencia de ESLint detectada en el módulo tocado |

## Seguridad, frescura y compatibilidad

- La caché solo conserva respuestas GET correctas de la lista explícita de endpoints. Autenticación, errores, exportaciones y mutaciones no se almacenan.
- Cambiar usuario/sitio, salir, mutar configuración, volver al foco o abandonar página invalida lecturas. Una respuesta tardía no entra al nuevo contexto.
- Las peticiones del portal declaran el sitio esperado mediante X-Hoit-Site. El servidor lo compara con la sesión; si otra pestaña cambió el sitio, devuelve 409 y pide actualizar. El encabezado no concede permisos ni selecciona sitios.
- Las respuestas compartidas conservan bytes, incluyendo archivos binarios. Cancelar un consumidor no cancela a los demás.
- El registro local de tiempos está limitado a 100 muestras y solo contiene ruta sin query, duración, estado HTTP y origen (red/caché/compartida). No contiene cuerpos, IDs de activos, tokens ni destinatarios.
- Al cambiar activo se remonta el contenido del módulo: se evita conservar formularios/selecciones del activo anterior. Puede reiniciar filtros del módulo; es una decisión de aislamiento.
- La caché tiene TTL breve y no implementa aún renderizado de snapshots antiguos mientras se revalida. Tampoco se conserva el estado de cada módulo al salir de él.
- No hay cambios de regiones, conexiones, límites de Neon, índices, esquema, scheduler, dispatcher ni configuración de correos.

## Verificación

Pruebas nuevas cubren deduplicación, TTL, invalidación por escritura, cambio de contexto con respuesta tardía, encabezado de sitio, aborto por consumidor, ausencia de caché para auth/errores/exportaciones, bytes de descargas y pausa/serialización/limpieza del sondeo. Prueba SQL adicional verifica reducción de heartbeat, revocación inmediata, vínculo usuario-sesión al cambiar sitio y jerarquía del sitio correcto. Se ejecutan además las suites de ámbitos, sensores/histórico y motor de reglas.

## Mediciones y trabajo pendiente para cerrar rendimiento real

1. Con sesión autorizada de Preview: registrar arranque frío/caliente, Dashboard → Supervisión → Tendencias → Histórico → Configuración, regreso a cada módulo, cambio de activo y cambio de sitio/cliente. Usar la misma cuenta, datos y red en cada comparación; al menos 20 repeticiones por caso para una estimación inicial de p50/p95.
2. Separar respuesta visual al clic, primer dato útil, número de solicitudes, bytes y Server-Timing. Las metas de 100 ms visual / 300 ms al volver / ~1 s para nuevo contexto son objetivos, no resultados certificados.
3. Si domina `auth`, perfilar consultas de ámbitos/permisos antes de introducir caché de autorización. Si domina `data`, identificar la consulta concreta y ejecutar EXPLAIN ANALYZE de forma controlada.
4. Confirmar región real de Neon y su latencia desde las funciones (Preview observado en iad1). No mover regiones sin comparar costes, disponibilidad y datos. El pooler ya existe; aumentar conexiones sin medir puede empeorar la contención.
5. Jerarquía sigue devolviendo contadores multisitio y catálogo completo. Si su peso domina, separar menú/contexto mínimo de inventario administrativo y cargar conteos/modelos a demanda.
6. Histórico tabular agrupa datos crudos antes de paginar. Con volumen representativo, medir agrupación, exportación y offset alto; valorar cursor estable, agregados persistidos e índices a partir del plan SQL. No agregar índices especulativos.
7. Revisar bundle inicial y renderizado con perfil de navegador. page.tsx concentra numerosos módulos importados estáticamente; evaluar división de código y precarga por intención solo si parseo/render o transferencia dominan. Esta entrega no modifica el empaquetado.
8. Tendencias cambia el rango temporal periódicamente y no reutiliza resultados de rangos diferentes. NOC/tendencias pausan sus disparadores ocultos; queda por medir y unificar el ciclo completo de consulta si se observan series lentas superpuestas.
9. Revisar varios usuarios/pestañas y permisos revocados; completar la comprobación visual autenticada. Las pruebas locales no sustituyen este recorrido remoto.

La primera optimización elimina trabajo redundante probado y deja instrumentación para la siguiente medición. No se declara resuelto todo el tiempo de respuesta hasta completar el perfilado autenticado con datos reales.

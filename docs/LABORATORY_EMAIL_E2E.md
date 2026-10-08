# Ensayo aislado de correo y escalamiento

Disponible sólo en Vercel Preview de `feature/hoit-core-v1`, para Administrador HOIT con permiso `notifications.write`, sitio activo `E2E-STAGING` y dispositivo `PM5560-E2E-02`. Producción y otras ramas reciben 404. No cambia el scheduler: mantiene `evaluate_only`.

Abrir `/laboratory/email` con la sesión del portal. El API es `/api/v1/laboratory/email` y acepta POST con `action` (`prepare`, `preflight`, `activate`, `process`, `close`) y `runId` salvo al preparar. GET hace exclusivamente preflight. No acepta reloj, vencimientos, IDs de entregas ni destinatarios arbitrarios del cliente.

## Preparación

1. Usar `pruebas@hoitlive.com`. Alternativa autorizada: `emer.cl+3@gmail.com`. Debe existir exactamente un canal email habilitado y verificado en el sitio, con un único destinatario igual al elegido. El ensayo no modifica canales existentes para cambiar su destino.
2. Pulsar **Preparar sin enviar**. Crea una regla genérica para L1-N <210 V con persistencia de 60 s, política 0/300/300 s y recuperación sin repetición. Las tres quedan inactivas. Se guarda un manifiesto inmutable en auditoría, con ventana de 30 minutos.
3. El responsable es un contacto específico de laboratorio: no se crean contraseña, identidad de login ni asignaciones de cliente/plataforma. Sólo se asigna viewer al sitio con vencimiento de 30 minutos. Un usuario existente ajeno al laboratorio nunca se reutiliza.
4. Copiar el identificador del ensayo para poder recuperarlo después de recargar. El panel no mantiene credenciales ni inicia ciclos automáticos.
5. **Revisar alcance** es de sólo lectura: no evalúa alarmas, no encola trabajos, no contacta proveedores ni recupera entregas interrumpidas.

## Ejecución

Mantener ingestión y heartbeat HTTPS cada 20–30 segundos. Antes de **Activar regla del ensayo**, debe existir una lectura L1-N normal, buena y de menos de 120 s. La activación falla si ya existe una alarma de ese ensayo.

- Subtensión durante al menos 60 s: abre una alarma genérica nueva.
- Revisar alcance y pulsar **Procesar sólo este ensayo**: envía la atención inicial del nivel 1. No hay una política adicional de correo de apertura, para evitar duplicación.
- Hasta 299 s desde la apertura, el nivel 2 sigue pendiente. Desde 300 s, repetir el procesamiento envía el segundo correo. El API siempre usa el reloj del servidor y no adelanta jobs.
- Reconocer esa alarma en el Centro de alertas. Mantener la condición física hasta el minuto 10 para verificar que el nivel 3 se cancela por ACK.
- Enviar lecturas normales: resolución automática. Procesar el ensayo envía el correo de recuperación una sola vez.
- Pulsar **Cerrar ensayo**, incluso ante error o vencimiento: deshabilita sólo sus reglas/políticas, cancela sus jobs pendientes y suprime sus entregas pendientes, sin borrar evidencia.

## Aislamiento y límites

El procesamiento selecciona exclusivamente los IDs de jobs asociados a la alarma de la regla nueva. No llama al ciclo global ni a `processNotificationQueue`. Las entregas exigen el mismo alarmId, endpointId, destino email y ventana; se vuelve a revisar el alcance antes de cada proveedor. Un endpoint adicional, cambio de correo/política, reapertura, entrega ajena, falta de telemetría o vencimiento impide continuar.

Sólo se intentan entregas `queued` con cero intentos: no se reintentan automáticamente fallos del proveedor ni envíos aceptados. Los locks de claim existentes evitan duplicar cada job/entrega. El nivel 3 previsto es a T0+600 s porque los retrasos son acumulativos.

La expiración bloquea envíos; no sustituye el cierre: hasta cerrarlas, las reglas activadas pueden seguir evaluándose y encolando filas sin despacho. El contacto no tiene credenciales; su asignación viewer vence por separado. No se ha probado un webhook de entrega de Resend ni ACK desde correo. Tres estados `sent` prueban aceptación, no recepción: ésta se confirma en la casilla. El flujo HTTPS real se registra por separado de los tests con proveedor simulado.

## Validación

`node --import tsx --test tests/laboratory-email.test.ts tests/notification-engine.test.ts tests/escalation-engine.test.ts tests/escalation-notification.test.ts tests/operations-policy.test.ts`

Verifica preparación/dry run sin efectos de entrega, guardas de entorno, 0/299/300/600 s, ACK, recuperación, repetición idempotente, destinatarios cambiados, entregas futuras y colas heredadas intactas. Los tests usan PostgreSQL efímero y Resend simulado.

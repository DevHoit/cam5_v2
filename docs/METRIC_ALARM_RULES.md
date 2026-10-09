# Reglas por dispositivo y métrica

Centro de alertas → Reglas muestra las métricas semánticas registradas del activo
seleccionado, agrupadas por dispositivo, con filtros y estado de evaluación.
Los canales anteriores conservan su editor en una sección desplegable.

## Configuración

Cada métrica puede tener varias reglas: límite alto/bajo, advertencia/crítica o
igualdad/desigualdad para estados booleanos, texto y enumeraciones. Las reglas
nuevas se crean deshabilitadas en el formulario; no se inventan umbrales ni se
activan configuraciones por detectar un dispositivo.

Campos: nombre, condición, valor, severidad, persistencia de activación en
segundos, vigencia máxima del dato, recuperación opcional con un segundo límite,
persistencia de recuperación y habilitación. El segundo límite debe ser menor
que un límite alto o mayor que un límite bajo. Sin él, recupera al dejar de
cumplirse la condición. Los tiempos cero significan la primera lectura válida.

GET /api/v1/metric-rules?assetId=UUID requiere alarms.read; POST y PATCH /:id
requieren settings.write. Se valida sitio activo, alcance del usuario sobre el
activo y pertenencia exacta de la métrica al dispositivo. PATCH requiere updatedAt
para evitar sobrescribir una edición concurrente. No admite mover reglas entre
métricas. Las reglas de laboratorio y configuraciones de otros módulos se ven
como sólo lectura. Este editor crea reglas sin política de escalamiento asociada;
la vinculación de responsables/escalamiento desde este formulario queda pendiente.

Guardar una edición reinicia la evaluación, atiende la ocurrencia abierta de esa
regla y cancela sus trabajos y entregas pendientes, conservando historia y auditoría.
No despacha mensajes. La UI informa este efecto antes de guardar. Los correos se
rigen por las políticas de Notificaciones existentes; crear una regla no activa
el dispatcher ni crea destinatarios.

## Contrato del motor

Se reutiliza rules con scopeType=device y expresión escalar sobre la métrica.
El campo hysteresis contiene un contrato explícito:

```json
{"kind":"device_metric","version":1,"deviceMetricId":"UUID","recoveryThreshold":70,"recoverySeconds":40,"staleAfterSeconds":120}
```

La evaluación comprueba la identidad de la métrica, calidad GOOD y fecha dentro
de la vigencia configurada, sin admitir fechas futuras. La persistencia avanza
con timestamps de muestras, no con repetidas consultas de una lectura guardada.
Un intervalo entre muestras superior a la vigencia reinicia la persistencia.
Datos inválidos no normalizan una alarma abierta y reinician tiempos pendientes.
El acuse se conserva mientras persiste la condición. La recuperación cancela
escalamientos mediante el motor existente.

Las ediciones y evaluaciones de este contrato se serializan por regla mediante
bloqueo de fila, evitando aperturas duplicadas o evaluaciones con configuración
anterior. Los contratos anteriores mantienen su comportamiento; los formatos de
histéresis desconocidos siguen sin evaluarse. No se requiere una migración.

## Prueba CAM5 de laboratorio

Configurar una regla exclusiva T01 ≥75 °C, persistencia 60 s, recuperación ≤70 °C
por 20 s, vigencia 120 s. Mantener normal antes de habilitar; luego enviar
high_temperature cada 20 s. Tras cuatro muestras que cubran 60 s debe abrir una
alarma T01 sin abrir la de T02. Volver a normal y comprobar recuperación tras
20 s de nuevas lecturas. El caso está cubierto localmente pasando por el handler
real del contrato SPEC 1.0, con 36 métricas y sin enviar correo.

No activar reglas de ensayo de correo fuera de su panel ni activar el dispatcher
global durante esta validación. Los umbrales anteriores son sólo de laboratorio.

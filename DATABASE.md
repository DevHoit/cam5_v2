# Base de datos HoitLive Core

La base está diseñada para PostgreSQL 15 o superior y soporta una estructura multi-cliente y multi-sitio. Cada sitio puede contener varios puntos de medición y gateways; cada equipo CAM5 enlaza un punto con un gateway del mismo sitio.

## Componentes incluidos

Las migraciones crean 44 tablas agrupadas de esta forma:

- Identidad y acceso: usuarios, identidades, sesiones, invitaciones, perfiles, permisos y alcances por cliente, sitio y punto.
- Inventario OT: clientes, sitios, puntos de medición, gateways, modelos CAM5, equipos, entradas físicas y señales operativas.
- Adquisición: perfiles de lectura, rangos Modbus, lotes de ingestión y catálogo de 105 registros.
- Telemetría: histórico crudo, última lectura por señal y agregados temporales.
- Condición: reglas, estado persistente del motor, alarmas, eventos de alarma y configuración de seis relés.
- Operación: puesta en marcha, respaldos, órdenes de trabajo, reportes, notificaciones, integraciones y auditoría.

```text
Cliente
└── Sitio
    ├── Punto de medición MCC-01
    │   └── CAM5-CTRL-01
    │       ├── 24 entradas físicas
    │       ├── 36 señales operativas
    │       ├── 105 registros documentados
    │       ├── reglas de alarma
    │       └── 6 relés
    ├── uno o varios gateways
    └── usuarios → perfil → alcance por sitio
```

## Perfiles de acceso al portal

| Perfil | Lectura | Alarmas | Mantenimiento | Configuración | Usuarios |
| --- | --- | --- | --- | --- | --- |
| Administrador | Completa | Gestiona | Gestiona | Modifica y despliega | Administra |
| Ingeniero | Completa | Gestiona | Gestiona | Modifica y comisiona | Solo consulta |
| Operador | Completa | Reconoce | Gestiona | Solo consulta | Solo consulta |
| Solo lectura | Completa | Solo consulta | Solo consulta | Solo consulta | Solo consulta |

El perfil `viewer` no puede reconocer o cerrar alarmas, exportar históricos, generar reportes, ejecutar diagnósticos ni realizar cambios. Las asignaciones se limitan por cliente y sitio y, opcionalmente, por una lista de puntos de medición.

El backend debe usar `resolvePortalAccess` o `requirePortalPermission` de `db/authorization.ts` antes de responder cada endpoint protegido. Ocultar botones en el frontend no reemplaza esta validación.

## Perfil de lectura Modbus inicial

| Grupo | Registros nativos | FC | Intervalo |
| --- | ---: | ---: | ---: |
| Temperatura y ambiente | 418–445 | 03 | 2 s |
| Totales UHF | 446–453 | 03 | 2 s |
| Sistema y diagnóstico UHF | 454–490 | 03 | 30 s |
| Conteos y tendencias | 491–522 | 03 | 10 s |

Una lectura se considera atrasada después de 30 segundos. El perfil guarda datos crudos durante 30 días y agregados de 1 minuto, 5 minutos, 1 hora o 1 día hasta por cinco años.

`latest_readings` mantiene solo la lectura más reciente de cada señal para que el dashboard no consulte el histórico completo. `reading_aggregates` alimenta las vistas de 7 días, 30 días y periodos mayores; el portal agrupa dinámicamente la ventana cruda y combina ambos orígenes cuando el rango cruza la retención.

## Preparación

Copiar las variables necesarias a un archivo `.env.local` o configurarlas en el entorno del backend. Los comandos de base cargan automáticamente `.env.local` y, como alternativa, `.env`:

```text
DATABASE_URL=postgresql://usuario:clave@servidor:5432/cam5
CAM5_ADMIN_EMAIL=administrador@empresa.cl
CAM5_ADMIN_NAME=Nombre del administrador
CAM5_ADMIN_PASSWORD=una-clave-segura-de-al-menos-10-caracteres
```

`DATABASE_URL` es un secreto del backend y nunca debe llevar el prefijo `NEXT_PUBLIC_`.

Aplicar la base:

```bash
npm run db:migrate
npm run db:seed
```

El seed es repetible y crea únicamente los registros iniciales que todavía no existen:

- Cliente principal, Subestación Norte y MCC-01.
- CAM5-GW-01 y CAM5-CTRL-01 en estado de puesta en marcha.
- 24 entradas, 36 señales y 105 registros.
- Perfil Modbus equilibrado, reglas de alarma, seis relés y checklist.
- 30 permisos y cuatro perfiles de portal.
- Tres plantillas de informe.
- El administrador inicial, solamente si `CAM5_ADMIN_EMAIL` está definido. Su acceso local se habilita cuando también se define `CAM5_ADMIN_PASSWORD`.

Una nueva ejecución no reemplaza nombres, direcciones, canales, umbrales, relés, retención ni contraseñas que ya fueron administrados. El catálogo oficial, los permisos y las descripciones de sistema sí pueden actualizarse de forma idempotente.

El host `192.168.10.42` del seed es provisional. Debe reemplazarse por la dirección real del CAM5 durante la puesta en marcha.

## Operación y retención

- La API debe insertar un `ingestion_batch` por ciclo para hacer la ingestión idempotente.
- Cada lote conserva identificador de arranque, secuencia y uptime del gateway; horas de envío/recepción; latencia Modbus; y contadores `good`, `stale` y `bad` para diagnosticar 24 horas sin recorrer millones de muestras.
- Cada lote admite una sola lectura por señal.
- Los códigos `0x8000` y `0xFFFF` se almacenan como valor crudo, con valor procesado nulo y calidad `bad`.
- El backend actualiza `latest_readings` en la misma transacción que el histórico.
- Después de aceptar cada lote, el motor evalúa umbrales, calidad e histéresis; su progreso por regla se conserva en `alarm_rule_states`.
- Los eventos de apertura, escalamiento, reapertura y recuperación generan entregas según las políticas activas; cada entrega queda deduplicada y conserva contenido, destino, intentos y respuesta del proveedor.
- Las alarmas de comunicación se revisan al recibir telemetría, al consultar el centro de alarmas y mediante el endpoint protegido `/api/v1/alarms/evaluate` para un programador externo.
- La cola de notificaciones se procesa mediante `/api/v1/notifications/process`, protegido con `CRON_SECRET`; los fallos se reintentan con espera exponencial hasta cuatro veces y también pueden reintentarse de forma auditada desde el portal.
- Cada cinco minutos, el proceso programado genera agregados de 1 minuto, 5 minutos, 1 hora y 1 día, y elimina datos crudos o agregados vencidos según el perfil asignado al controlador.
- Las acciones de configuración, usuarios, alarmas y relés generan un registro inmutable en `audit_logs`.
- Contraseñas, tokens y secretos externos se almacenan como hashes o referencias a un gestor de secretos; nunca como texto plano.

## Acceso implementado

- Login local validado contra `auth_identities`.
- Contraseñas derivadas con `scrypt` y sal aleatoria.
- Sesiones de 12 horas almacenadas en `auth_sessions`, con sitio activo persistido; el navegador recibe solo un token aleatorio en una cookie `HttpOnly`, `SameSite=Strict` y `Secure` en producción.
- Logout con revocación inmediata de la sesión.
- Administración de usuarios protegida por `users.manage`, con acceso multi-sitio, búsqueda y paginación del lado del servidor.
- API de jerarquía para crear, editar, desactivar, reactivar y eliminar de forma segura clientes, sitios, puntos de medición, gateways y controladores, con validación de pertenencia, dependencias y auditoría.
- Histórico protegido, paginado y exportable con filtros `assetId`, `from`, `to`, `q` y `channel`.
- Tendencias reales con resolución automática o explícita, hasta cuatro canales compatibles, umbrales, calidad, tramos faltantes y CSV; los rangos largos utilizan `reading_aggregates`.
- Diagnóstico protegido por `diagnostics.read` y `diagnostics.execute`, con frescura de las cuatro etapas, estadísticas de lotes, latencia promedio/P95, calidad agregada, ciclos paginados y recalculo auditado.
- Alarmas persistentes con búsqueda, filtros, paginación, asignación, notas, reconocimiento, atención, cierre y órdenes de trabajo vinculadas.
- Reglas de alarma editables por canal, con histéresis, muestras de activación/recuperación, tiempo de dato atrasado y auditoría.
- Canales de notificación administrables para correo, Microsoft Teams y webhook HTTPS; reglas por severidad y tipo, demora, repetición, recuperación, prueba de conexión, historial paginado, filtros por fecha y reintento manual.
- Configuración técnica por punto protegida por `settings.read` y `settings.write`: controlador, gateway asignado, red Modbus, perfil y rangos de lectura, retención, canales y umbrales. Cada cambio genera auditoría y una versión con checksum SHA-256 en `configuration_snapshots`.
- Los perfiles de lectura se separan automáticamente antes de editarse cuando son compartidos por varios controladores, evitando cambios cruzados entre puntos.
- El catálogo de 105 registros se expone como referencia oficial de solo lectura; las direcciones, escalas y tipos del fabricante no se modifican desde la operación diaria.
- Auditoría de inicio de sesión, creación, edición y eliminación de usuarios.

## Archivos

- `db/schema.ts`: modelo Drizzle.
- `db/access-control.ts`: permisos y perfiles del portal.
- `db/auth.ts`: contraseñas, sesiones y resolución del usuario autenticado.
- `db/authorization.ts`: resolución de acceso para el backend.
- `db/index.ts`: conexión PostgreSQL mediante `DATABASE_URL`.
- `db/migrate.ts`: ejecutor de migraciones.
- `db/seed.ts`: datos iniciales idempotentes.
- `drizzle/0000_cam5_initial_schema.sql`: migración SQL inicial.
- `drizzle/0001_eager_blockbuster.sql`: clientes, sitio activo y consistencia de la cadena OT.
- `drizzle/0002_sparkling_wallow.sql`: membresías de usuario por cliente.
- `drizzle/0003_rich_charles_xavier.sql`: credenciales del gateway y muestras de los 105 registros CAM5.
- `drizzle/0004_windy_gauntlet.sql`: estado activo reversible para puntos, gateways y controladores.
- `drizzle/0005_milky_caretaker.sql`: flujo de alarmas atendidas, responsable y estado persistente del motor.
- `drizzle/0006_smiling_frightful_four.sql`: contenido, programación, deduplicación y reintentos de entregas de notificación.
- `db/notification-engine.ts`: motor de políticas, adaptadores de proveedor y cola de entrega.
- `app/api/v1/configuration/route.ts`: lectura, validación, actualización y versionado de la configuración técnica.
- `tests/database-schema.test.mjs`: prueba en PostgreSQL embebido.

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

`latest_readings` mantiene solo la lectura más reciente de cada señal para que el dashboard no consulte el histórico completo. `reading_aggregates` alimentará las vistas de 7 días, 30 días y periodos mayores.

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

El seed es repetible y crea:

- Cliente principal, Subestación Norte y MCC-01.
- CAM5-GW-01 y CAM5-CTRL-01 en estado de puesta en marcha.
- 24 entradas, 36 señales y 105 registros.
- Perfil Modbus equilibrado, reglas de alarma, seis relés y checklist.
- 30 permisos y cuatro perfiles de portal.
- Tres plantillas de informe.
- El administrador inicial, solamente si `CAM5_ADMIN_EMAIL` está definido. Su acceso local se habilita cuando también se define `CAM5_ADMIN_PASSWORD`.

El host `192.168.10.42` del seed es provisional. Debe reemplazarse por la dirección real del CAM5 durante la puesta en marcha.

## Operación y retención

- La API debe insertar un `ingestion_batch` por ciclo para hacer la ingestión idempotente.
- Cada lote admite una sola lectura por señal.
- Los códigos `0x8000` y `0xFFFF` se almacenan como valor crudo, con valor procesado nulo y calidad `bad`.
- El backend actualiza `latest_readings` en la misma transacción que el histórico.
- Después de aceptar cada lote, el motor evalúa umbrales, calidad e histéresis; su progreso por regla se conserva en `alarm_rule_states`.
- Las alarmas de comunicación se revisan al recibir telemetría, al consultar el centro de alarmas y mediante el endpoint protegido `/api/v1/alarms/evaluate` para un programador externo.
- Un proceso programado genera agregados y elimina datos crudos vencidos según el perfil.
- Las acciones de configuración, usuarios, alarmas y relés generan un registro inmutable en `audit_logs`.
- Contraseñas, tokens y secretos externos se almacenan como hashes o referencias a un gestor de secretos; nunca como texto plano.

## Acceso implementado

- Login local validado contra `auth_identities`.
- Contraseñas derivadas con `scrypt` y sal aleatoria.
- Sesiones de 12 horas almacenadas en `auth_sessions`, con sitio activo persistido; el navegador recibe solo un token aleatorio en una cookie `HttpOnly`, `SameSite=Strict` y `Secure` en producción.
- Logout con revocación inmediata de la sesión.
- Administración de usuarios protegida por `users.manage`, con acceso multi-sitio, búsqueda y paginación del lado del servidor.
- API de jerarquía para crear, editar, desactivar, reactivar y eliminar de forma segura clientes, sitios, puntos de medición, gateways y controladores, con validación de pertenencia, dependencias y auditoría.
- Histórico protegido y paginado con filtros `from`, `to`, `q` y `channel`.
- Alarmas persistentes con búsqueda, filtros, paginación, asignación, notas, reconocimiento, atención, cierre y órdenes de trabajo vinculadas.
- Reglas de alarma editables por canal, con histéresis, muestras de activación/recuperación, tiempo de dato atrasado y auditoría.
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
- `tests/database-schema.test.mjs`: prueba en PostgreSQL embebido.

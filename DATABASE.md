# Base de datos CAM5 CORE

La base está diseñada para PostgreSQL 15 o superior y para el alcance inicial de una ubicación, un gateway y un equipo CAM5. El modelo puede crecer a más ubicaciones sin cambiar la estructura principal.

## Componentes incluidos

La migración inicial crea 39 tablas agrupadas de esta forma:

- Identidad y acceso: usuarios, identidades, sesiones, invitaciones, perfiles, permisos y alcances por ubicación/activo.
- Inventario OT: ubicación, activo, gateway, modelo CAM5, equipo, entradas físicas y señales operativas.
- Adquisición: perfiles de lectura, rangos Modbus, lotes de ingestión y catálogo de 105 registros.
- Telemetría: histórico crudo, última lectura por señal y agregados temporales.
- Condición: reglas, alarmas, eventos de alarma y configuración de seis relés.
- Operación: puesta en marcha, respaldos, órdenes de trabajo, reportes, notificaciones, integraciones y auditoría.

```text
Sitio
├── Activo MCC-01
│   └── CAM5-CTRL-01
│       ├── 24 entradas físicas
│       ├── 36 señales operativas
│       ├── 105 registros documentados
│       ├── reglas de alarma
│       └── 6 relés
├── Gateway CAM5-GW-01
└── usuarios → perfiles → permisos → alcance
```

## Perfiles de acceso al portal

| Perfil | Lectura | Alarmas | Mantenimiento | Configuración | Usuarios |
| --- | --- | --- | --- | --- | --- |
| Administrador | Completa | Gestiona | Gestiona | Modifica y despliega | Administra |
| Ingeniero | Completa | Gestiona | Gestiona | Modifica y comisiona | Solo consulta |
| Operador | Completa | Reconoce | Gestiona | Solo consulta | Solo consulta |
| Solo lectura | Completa | Solo consulta | Solo consulta | Solo consulta | Solo consulta |

El perfil `viewer` no puede reconocer o cerrar alarmas, exportar históricos, generar reportes, ejecutar diagnósticos ni realizar cambios. Las asignaciones se limitan por ubicación y, opcionalmente, por una lista de activos.

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
```

`DATABASE_URL` es un secreto del backend y nunca debe llevar el prefijo `NEXT_PUBLIC_`.

Aplicar la base:

```bash
npm run db:migrate
npm run db:seed
```

El seed es repetible y crea:

- Subestación Norte y MCC-01.
- CAM5-GW-01 y CAM5-CTRL-01 en estado de puesta en marcha.
- 24 entradas, 36 señales y 105 registros.
- Perfil Modbus equilibrado, reglas de alarma, seis relés y checklist.
- 30 permisos y cuatro perfiles de portal.
- Tres plantillas de informe.
- El administrador inicial, solamente si `CAM5_ADMIN_EMAIL` está definido.

El host `192.168.10.42` del seed es provisional. Debe reemplazarse por la dirección real del CAM5 durante la puesta en marcha.

## Operación y retención

- La API debe insertar un `ingestion_batch` por ciclo para hacer la ingestión idempotente.
- Cada lote admite una sola lectura por señal.
- Los códigos `0x8000` y `0xFFFF` se almacenan como valor crudo, con valor procesado nulo y calidad `bad`.
- El backend actualiza `latest_readings` en la misma transacción que el histórico.
- Un proceso programado genera agregados y elimina datos crudos vencidos según el perfil.
- Las acciones de configuración, usuarios, alarmas y relés generan un registro inmutable en `audit_logs`.
- Contraseñas, tokens y secretos externos se almacenan como hashes o referencias a un gestor de secretos; nunca como texto plano.

## Archivos

- `db/schema.ts`: modelo Drizzle.
- `db/access-control.ts`: permisos y perfiles del portal.
- `db/authorization.ts`: resolución de acceso para el backend.
- `db/index.ts`: conexión PostgreSQL mediante `DATABASE_URL`.
- `db/migrate.ts`: ejecutor de migraciones.
- `db/seed.ts`: datos iniciales idempotentes.
- `drizzle/0000_cam5_initial_schema.sql`: migración SQL inicial.
- `tests/database-schema.test.mjs`: prueba en PostgreSQL embebido.

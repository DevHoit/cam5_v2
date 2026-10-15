# Integración revisada de mejoras — HoitLive Core

Fecha: 15 de octubre de 2026.
Repositorio: DevHoit/cam5_v2.
Destino: `feature/hoit-core-v1`.
Base de destino: `08e12465d813eaf80284d7039df1e8d416d24e94`.
Origen: `feature/hoit-core-analysis-and-fixes-225352031111328187`, commit `0278f3d2c9c08a5e321de2954e118aa2ce7a04b2` (6 commits por delante, sin divergencias).

## Cambios incorporados

- Correcciones de ESLint y unificación de `cam5Api` con `portalFetch`.
- Carga dinámica de 11 módulos secundarios, con indicador de carga, y del buscador global.
- Menú lateral colapsable con `aria-expanded`.
- Centro de alertas con opción predeterminada «Todos los activos del sitio» y filtros rápidos.
- Búsqueda global de activos, módulos autorizados y alertas críticas activas del sitio. Consulta al servidor, debounce de 250 ms, cancelación y protección contra respuestas antiguas. Hasta 20 alertas por búsqueda, con total para orientar el refinamiento.
- Al seleccionar una alerta en la búsqueda se consulta su identificador exacto; al abrir su tendencia se selecciona el activo correspondiente.
- Modal de búsqueda con etiqueta accesible, Escape, navegación de foco y restauración del foco.
- Resumen independiente de alarmas del sitio: las páginas y el activo seleccionado no limitan los contadores. El banner muestra únicamente críticas abiertas sin reconocer, dentro del alcance autorizado.
- Nuevos endpoints de búsqueda y resumen con permiso `alarms.read`, sesión, contexto de sitio y restricciones por activo; consultas sin efectos de evaluación de alarmas.
- Corrección de la consulta de conteo de alarmas para incluir el join de dispositivos utilizado por el filtro de texto.
- Verificación de mantenimiento por lotes: número constante de consultas (hasta tres), en lugar de consultas por cada objetivo. Rechaza activos inexistentes o de otro sitio.
- Límite compartido en PostgreSQL: 120 solicitudes en ventana deslizante de 60 segundos por gateway y operación. Ingesta y heartbeat tienen presupuestos independientes. Un upsert atómico coordina instancias y entrega HTTP 429 con `Retry-After`.
- Simulador: reintentos acotados conservando el lote y `message_id`; respeta `Retry-After`. Si agota los intentos, termina sin avanzar al lote siguiente. No incorpora una cola persistente en disco.
- Reparación del lockfile para que `npm ci` pueda resolver el árbol existente.

## SSE aplazado

Se excluye el endpoint SSE experimental de la rama de origen. Su autorización y alcance por activo no estaban completos y no se había demostrado una reducción del trabajo de consultas. Se mantiene la actualización periódica existente, pausada cuando la página no es visible. Incorporar streaming requiere una implementación autorizada por sitio/activo y validación de recursos y rendimiento.

## Base de datos y despliegue

Nueva migración: `0033_gateway_rate_limits.sql`. Crea una tabla acotada a dos filas por gateway, con un máximo de 120 marcas temporales por fila y eliminación en cascada al eliminar el gateway.

Se verificó que `DATABASE_URL` específico de esta rama corresponde al entorno Preview y a un host diferente de producción. `HOIT_ALLOW_NONPROD_MIGRATIONS=1` ya estaba habilitado para esa rama. La migración se aplica por el proceso de build de Preview. No se modifica `main` ni se promueve a producción.

## Validación local

- Node 22.20.0, correspondiente a la familia 22.x exigida por el proyecto.
- 35 pruebas TypeScript aprobadas: integración revisada, transporte/rendimiento, mantenimiento, notificaciones, alcance de acceso, ingesta y heartbeat.
- Suite histórica `tests/*.test.mjs`: 6 aprobadas y 4 fallos preexistentes, reproducidos también en el commit base de destino. Son expectativas obsoletas del título del login, una coincidencia textual de `Date.now()` y dos lecturas de `app/cam5-engineering.tsx`, archivo retirado previamente. No se alteraron estas pruebas para ocultar el resultado.
- 2 pruebas Python aprobadas: reintentos con el mismo lote y límite de intentos/errores no recuperables.
- Cuota: 140 solicitudes concurrentes admiten exactamente 120 y rechazan 20; heartbeat independiente; expiración a los 60 segundos; `Retry-After` válido.
- Mantenimiento: equivalencia con comprobaciones individuales, límites temporales y aislamiento de sitio.
- Búsqueda y resumen: aislamiento de sitio/activos, estados reconocidos y búsqueda literal de comodines.
- `npm ci --dry-run --ignore-scripts --no-audit --no-fund`: aprobado. Se ejecutó con Node 24 del host y emitió la advertencia esperada de versión; las pruebas y la compilación se ejecutaron con Node 22.
- ESLint sin errores; dos advertencias de directivas innecesarias en archivos generados por Workflow.
- Compilación optimizada y comprobación TypeScript aprobadas.

## Medición de carga inicial

Comparación de los scripts iniciales en el HTML generado de `/`, con builds locales y dependencias compartidas:

| Medida | Base de destino | Integración |
| --- | ---: | ---: |
| JavaScript sin comprimir | 1.086.721 bytes | 871.566 bytes |
| JavaScript comprimido con gzip | 285.902 bytes | 243.104 bytes |

Reducción aproximada: 19,8% sin comprimir y 15,0% con gzip. Esta medición corresponde a tamaño de descarga, no a una medición de latencia de navegación con sesión.

## Verificación posterior

Integración publicada en `feature/hoit-core-v1`, commit `1e7abb1780cf41a618997fbdb246a3bef2de651b`.

- Vercel: despliegue `dpl_71uppiQnsSEnCi9DJdxtRytxadgX`, estado READY, alias de la rama actualizado.
- Build remoto: «Migraciones HoitLive Core aplicadas correctamente». No se modificaron privilegios de plataforma.
- Health check: HTTP 200, `status=ok`, `database=ok`, entorno `preview` y revisión exacta `1e7abb1780cf41a618997fbdb246a3bef2de651b`.
- Endpoint SSE excluido: HTTP 404 confirmado.
- Sesión iniciada mediante formulario seguro; ninguna credencial se incluyó en el código o este documento.
- Dashboard: 3 críticas sin reconocer, coincidentes con el resumen y la búsqueda del sitio de laboratorio.
- Buscador: muestra alertas de tres activos diferentes. Seleccionar la alerta de PM5560 abre su identificador exacto y selecciona Banco de pruebas PM5560.
- Entrada normal al Centro de alertas: «Todos los activos del sitio» predeterminado y 7 eventos visibles de varios activos.
- Filtro «Sin reconocer»: 3 eventos abiertos de tres activos distintos.
- Ctrl+K abre el modal; Escape lo cierra y devuelve el foco al botón anterior.
- Menú Administración: colapsa y refleja el estado accesible.
- Se inspeccionó visualmente el Centro de alertas desplegado. Esta revisión cubre los flujos modificados; no reemplaza una revisión completa de todos los módulos, perfiles y tamaños móviles.

Preview: https://cam5v2-git-feature-hoit-core-v1-hoit1.vercel.app/

Pendientes antes de producción: resolver las cuatro pruebas históricas obsoletas, completar validación móvil y perfiles de usuario, y validar operación con datos de gateway reales. SSE sigue aplazado.


## Actualización: título y rango de tendencias

Se aplicaron las dos correcciones aprobadas posteriormente:

- Título y prueba del HTML generado: `HoitLive Core · Industrial IoT Platform`.
- El cálculo de la ventana de tendencias se extrajo a `app/lib/trend-range.ts`, utilizado por la navegación real desde histórico y alarmas.
- La prueba ejecuta el cálculo con hora fija y verifica rangos pasados, final futuro, rango completamente futuro, rango invertido y límite igual a la hora actual. En todos los casos, el final no supera la hora actual y el inicio queda al menos un minuto antes del final.
- La comprobación del estilo de umbrales conserva su prueba independiente.
- Compilación con Node 22 y ESLint de los archivos modificados: aprobados.
- Suite histórica: 9 pruebas aprobadas y 2 fallos pendientes vinculados al archivo retirado `app/cam5-engineering.tsx`. Los fallos de título y rango ya están resueltos.

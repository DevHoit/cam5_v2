# HOIT Frontend — Estado de continuidad

**Actualizado:** 2026-10-04  
**Repositorio:** DevHoit/cam5_v2  
**Rama de trabajo:** `feature/hoit-core-v1`  
**Objetivo vigente:** dejar el Front completamente operativo antes de retomar Gateway/CAM5 físico.

## Regla de arquitectura vigente

La UX se organiza por operación y activos, no por fabricantes/equipos.

Jerarquía de producto:

`Cliente → Sitio → Activo → Dispositivo → Métrica`

Los detalles de protocolo, registros, Modbus y adquisición pertenecen a **Ingeniería**. PM5560, DSE8660 y CAM-5 son implementaciones/capacidades del activo y no deben dominar la navegación principal.

## Estado actual del Front

### Completado / consolidado

- Navegación principal: Dashboard, Supervisión, Operación, Administración e Ingeniería.
- Dashboard global por cliente.
- Contexto Cliente / Sitio / Activo según la vista.
- Resumen universal de activo para activos con modelo normalizado.
- Renderer especializado CAM-5 conservado donde aporta valor.
- Ingeniería como workspace separado.
- Lenguaje de producto normalizado: Activo, Dispositivo y Métrica.
- NOC, mantenimiento, turnos, on-call, asignaciones y escalamiento.
- Reglas de entrega y políticas de escalamiento diferenciadas.
- Organización: clientes, sitios, activos, gateways y dispositivos.
- Alta administrativa de Cliente y Sitio completada en el Front.
- Responsive UX 2.0 para Dashboard, Ingeniería y ficha universal.
- SPEC v0.10 mantiene esta arquitectura como regla de producto.

## Bloque cerrado en esta sesión: Tendencias + Histórico genéricos

### Tendencias

Ya existía `app/generic-trends-view.tsx` consumiendo:

`GET /api/v1/telemetry/metrics/history`

La vista trabaja sobre:

`Activo → Dispositivo → Métrica → Histórico`

Incluye períodos, comparación de métricas compatibles, calidad, mínimo/máximo/promedio, exportación CSV y agregación automática del backend.

Cambio de esta sesión:

- La vista genérica ahora acepta una `metricKey` proveniente del contexto del portal.
- Histórico puede abrir Tendencias apuntando a la métrica normalizada seleccionada.
- Se mantiene la vista legacy de CAM-5 mientras ese activo dependa del modelo de canales.

### Histórico

Se eliminó la decisión rígida basada en:

`assetType ∈ [electrical_point, ats, cold_room]`

Ahora el backend decide usar el modelo normalizado si el activo **realmente posee dispositivos con métricas habilitadas**. Esto prepara la evolución a capabilities sin acoplar Histórico a una taxonomía única de activo.

Para activos normalizados:

- filtro por métrica;
- búsqueda por dispositivo/métrica;
- soporte number, boolean, string y enum;
- calidad y flags;
- recepción y secuencia;
- exportación CSV;
- navegación a Tendencias sólo para métricas numéricas.

Para CAM-5 legacy se conserva el histórico por canales como fallback compatible.

## Commits de este bloque

- `b6c94038` — refactor(history): select normalized metrics by capability data
- `f1870796` — feat(history): expose normalized metric filters in portal
- `ddf03650` — fix(history): expose normalized metric data type
- `804b492f` — feat(trends): open normalized metric from portal context
- `5b632e4a` — feat(frontend): connect normalized history to generic trends
- `9f9abdca` — fix(frontend): avoid synchronous state reset in history effect

Commit administrativo inmediatamente anterior:

- `d7d5dafb` — feat(frontend): complete client and site creation forms

## Qué NO hacer ahora

- No rediseñar nuevamente la navegación.
- No volver a organizar el producto alrededor de PM5560/DSE8660/CAM-5.
- No mover detalles Modbus/registros fuera de Ingeniería.
- No bloquear V1 esperando el modelo definitivo de capabilities.
- No priorizar todavía Gateway físico sobre el cierre del Front.

## Bloque cerrado en esta sesión: Centro de alertas genérico

El Centro de alertas dejó de depender visualmente del canal CAM-5 como único origen.

Cambios:

- la API de alarmas expone ahora `deviceId`, dispositivo y `context` además del canal legacy;
- la búsqueda incluye activo, dispositivo y canal/origen;
- cuando una alarma normalizada contiene `context.metricKey`, la UI la usa como origen principal;
- la fila de alarma muestra `Activo → Dispositivo → Métrica` cuando esos datos existen;
- se mantiene `channelCode` como fallback para CAM-5;
- el detalle incorpora acceso directo **Ver activo**;
- **Ver tendencia de origen** usa `metricKey` para alarmas normalizadas y canal para legacy;
- la pestaña Alarmas del Histórico aplica la misma resolución de origen;
- el CSV de histórico de alarmas diferencia dispositivo y origen.

No fue necesaria una migración de base de datos: los motores normalizados ya almacenaban `deviceId` y/o `metricKey` en el contexto de la alarma.

Commits del bloque:

- `880a97ac` — feat(alarms): expose normalized device and metric context
- `3a4c641f` — feat(alarms): make asset and normalized metric primary in alert center
- `96135470` — feat(history): expose normalized alarm origin
- `b6bbb6a0` — feat(frontend): open normalized alarm metrics from history

## Bloque cerrado en esta sesión: Reportes por activo y capability

El constructor de reportes queda alineado con:

`Activo + período + tipo de reporte`

Cambios:

- el selector se presenta como **Tipo de reporte**, no como una plantilla técnica;
- la API de plantillas inspecciona las métricas habilitadas del activo;
- los reportes especializados se ofrecen por capacidades observables:
  - `environment.temperature` → cadena de frío;
  - `electrical.*` → reporte eléctrico;
  - `ats.* / dse.*` → transferencia automática;
- el motor vuelve a validar esas capacidades al generar el reporte, evitando depender sólo de `assetType`;
- un activo puede exponer más de un reporte especializado si posee varias capabilities;
- CAM-5 y activos legacy sin métricas normalizadas conservan sus reportes generales;
- lenguaje visible actualizado de “punto” a “activo” y de “variables” a “métricas” donde corresponde;
- los reportes especializados existentes y sus snapshots inmutables se conservan.

Commits del bloque:

- `42aab084` — feat(reports): select templates from normalized asset capabilities
- `b4fc51c9` — refactor(reports): generate specialized reports by capability metrics
- `5dfc4225` — feat(reports): align builder language with asset metric model

### P1 — Preview / E2E visual completo

Recorrer el Preview real con al menos:

- Administrador HOIT.
- Administrador de cliente.
- Administrador de sitio.
- Operador/Viewer cuando corresponda.

Revisar:

- Dashboard → Sitio → Activo.
- tamaños y densidad;
- estados vacíos/error/loading;
- tablas y scroll;
- modales;
- desktop/tablet/móvil;
- creación Cliente → Sitio → usuario;
- permisos y navegación por rol.

### P2 — Ingeniería por capability

Mantener por ahora Diagnóstico CAM-5 y Commissioning CAM-5. Evolucionarlos después a motores según capability/dispositivo.

### P2 — Capabilities explícitas

Hoy parte de la selección de renderer sigue apoyándose en `assetType`. La dirección definitiva es que un activo pueda declarar varias capabilities simultáneas, por ejemplo:

- temperature
- humidity
- partial_discharge
- electrical
- vibration
- ats / transfer

No bloquear el cierre V1 por esta evolución.

## Estimación actual

- Arquitectura UX: 90–95%
- Dashboard global: ~90%
- Resumen universal de activo: 85–90%
- Operación/NOC: ~90%
- Centro de alertas: ~90%; arquitectura genérica cerrada, pendiente validación visual/E2E con datos reales
- Administración: ~90%
- Ingeniería: 75–80%
- Tendencias/Histórico genérico: ~85–90% a nivel arquitectura/implementación; falta validación visual E2E con datos reales.
- Reportes: ~90%; contrato genérico cerrado, pendiente validación E2E con datos reales
- Hardening transversal de permisos/navegación: ~90%; pendiente E2E autenticado
- Pulido visual/E2E completo: ~80%; pendiente recorrido autenticado y responsive sobre Preview

## Próximo paso recomendado

**Preview/E2E visual completo** sobre Dashboard → Sitio → Activo y los módulos Tendencias, Histórico, Alertas, Reportes, Administración e Ingeniería. Los bloques genéricos principales ya no requieren otro rediseño antes de esta validación.

El CI del HEAD funcional `9f9abdca` quedó disparado tras corregir el lint detectado en un commit intermedio. Confirmar su resultado verde y probar en Preview con al menos un activo eléctrico/PM, ATS, cold-chain y CAM-5.

## Nota para un nuevo chat

Si esta conversación se pierde, comenzar leyendo este archivo y `docs/HOIT_SPEC.md`. Trabajar sobre `feature/hoit-core-v1`. El objetivo sigue siendo **cerrar Front + Backend funcional antes de abordar Gateway físico**.


## Iteración actual — Cierre Frontend V1 / hardening transversal

Esta iteración agrupa revisión transversal en vez de cambios aislados.

### Cambios aplicados

- endurecimiento de navegación por permisos:
  - módulos sensibles se filtran en menú;
  - los deep links `?view=...` ya no permiten abrir una vista no autorizada;
  - la navegación interna también valida permisos;
  - acciones cruzadas como el acceso global a Alertas respetan permisos;
- Histórico, Reportes y Centro de alertas quedan condicionados por sus permisos funcionales;
- Ingeniería, Configuración, Diagnóstico, Commissioning y Provisionamiento quedan bajo permisos técnicos;
- lenguaje operacional restante corregido:
  - “Sin punto seleccionado” → “Sin activo seleccionado”;
  - exportación general usa “métrica” y archivo `hoit-telemetria.csv`;
- corregido el formateo de tipos de activo desconocidos en Ingeniería;
- Vercel Preview de la base anterior `76ab853c` confirmado en estado READY antes de iniciar este hardening.

Commits funcionales de esta iteración:

- `bdd2db3a` — feat(frontend): harden V1 permissions navigation and operational language
- `a37893ac` — fix(frontend): polish engineering asset type labels
- `1f05c717` — fix(frontend): enforce role access on deep links and cross module actions

### Validación pendiente de esta misma iteración

- CI de los commits de hardening;
- despliegue Preview del HEAD;
- recorrido autenticado por roles en Preview. Esta parte requiere una sesión/credenciales válidas; no se debe marcar como E2E cerrado sólo por compilar.

### Próximo bloque de trabajo

Una vez verde el HEAD, ejecutar validación visual/autenticada en Preview para:

1. Administrador HOIT: crear cliente → sitio → usuario Administrador de cliente.
2. Administrador de cliente: herencia de sitios y creación/administración dentro de su cliente.
3. Administrador de sitio: alcance limitado al sitio.
4. Operador/Viewer: comprobar que no aparecen ni abren módulos administrativos/técnicos sin permiso.
5. Desktop/tablet/móvil y estados loading/vacío/error/sin permisos.



## Resultado CI del hardening transversal

El hardening encontró dos problemas de calidad durante CI y ambos fueron corregidos antes de considerarlo cerrado:

- React purity lint por uso de tiempo impuro dentro de acciones del componente;
- narrowing TypeScript de `sessionUser` en validación de permisos para rutas/navegación.

Correcciones:
- `27654c72` — fix(frontend): satisfy React purity lint in portal actions
- `1ebd8d19` — fix(frontend): narrow authenticated session before permission checks

Validación final del commit `1ebd8d19`:
- lint: PASS
- simuladores Python: PASS
- Gateway Agent: PASS
- tests DB/integración: PASS (92/92)
- Next.js production build + TypeScript: PASS
- Vercel Preview: READY y alias de branch actualizado al commit `1ebd8d19`

### Gate E2E autenticado

El código y el Preview están listos para el recorrido por roles. El recorrido autenticado completo no debe marcarse como PASS hasta ejecutarlo con sesiones válidas de Administrador HOIT / cliente / sitio / operador-viewer. No se crean ni inventan credenciales desde la automatización de validación.


## Bloque cerrado: alta operacional Cliente → Sitio → Activo → Gateway → Dispositivo

Se auditó el flujo completo de provisionamiento desde Administración.

Hallazgo principal:
- el alta visible como “Dispositivo” todavía estaba acoplada internamente a CAM-5;
- el backend buscaba obligatoriamente `CAM5-TPH-XDCW` y `cam5-balanced-v1`, por lo que un cliente nuevo no podía incorporar de forma limpia otro modelo desde el portal.

Cambios:
- `GET /api/v1/hierarchy` expone el catálogo de modelos de dispositivo;
- el formulario de alta exige seleccionar el modelo;
- `POST /api/v1/hierarchy` valida el modelo seleccionado;
- CAM-5 conserva automáticamente su perfil especializado cuando corresponde;
- otros modelos se crean con driver genérico y sin heredar configuración CAM-5;
- mensajes backend restantes cambiados de punto/controlador a activo/dispositivo;
- placeholders de alta dejan de sugerir CAM-5 como dispositivo universal.

Commits:
- `c85574de` — feat(provisioning): make device onboarding model driven
- `87de8afa` — feat(provisioning): expose device model selection in operational onboarding

Validación:
- lint: PASS
- simuladores Python: PASS
- Gateway Agent: PASS
- tests DB/integración: PASS
- build Next.js + TypeScript: PASS
- Vercel Preview: READY en `87de8afa`

### Límite V1 identificado

El catálogo de modelos debe existir antes de provisionar un dispositivo. Esto es correcto como separación de responsabilidades, pero el siguiente bloque de Ingeniería debe permitir administrar/registrar modelos y su mapping de métricas sin depender de seeds para incorporar hardware nuevo.


## Bloque cerrado: catálogo técnico de modelos en Ingeniería

Se eliminó la dependencia funcional de seeds para incorporar un modelo nuevo al flujo de provisionamiento.

### Implementado

- API de Ingeniería para listar, crear, editar y eliminar modelos de dispositivo.
- Validación de código único, fabricante, versión de mapa, driver y protocolo.
- Selección de métricas desde el catálogo normalizado existente.
- Plantilla de capacidades por modelo.
- Protección de borrado cuando el modelo ya está asociado a dispositivos.
- Auditoría de altas, cambios y eliminaciones.
- Workspace visual dentro de Ingeniería para mantener modelos y plantillas.
- Al crear un dispositivo desde Organización y activos:
  - se toma el driver/protocolo definidos en su modelo;
  - se materializan las capacidades en `device_capabilities`;
  - se materializan las métricas seleccionadas en `device_metrics`;
  - CAM-5 mantiene su perfil especializado sin convertirlo en modelo universal.

Commits principales:
- `bb89bf66` — refactor(models): support generic capability and metric templates
- `e62a58f9` — feat(engineering): add managed device model catalog API
- `3f349f72` — feat(provisioning): materialize model metric templates on device creation
- `972a1b1b` — feat(engineering): add model and metric template workspace
- `747e9919` — feat(engineering): surface managed model catalog in engineering hub
- `f0e571bf` — feat(engineering): connect model catalog feedback to portal

Validación de `f0e571bf`:
- lint: PASS
- simuladores Python: PASS
- Gateway Agent: PASS
- tests DB/integración: PASS
- build Next.js + TypeScript: PASS
- Vercel Preview: READY

### Siguiente límite técnico

La plantilla ya define qué métricas existen para un modelo, pero todavía no configura desde UI el mapa físico de adquisición por métrica (registro Modbus, función, tipo de dato, escala/endian). Ese mapping debe ser el siguiente bloque de Ingeniería para que un modelo Modbus completamente nuevo pueda configurarse sin tocar código.


## Frontera Core / Gateway Agent — saneamiento arquitectónico (2026-10-04)

Revisión realizada antes de modificar el modelo persistente:

- El Gateway Agent es responsable de protocolos, buses, registros, drivers, escalas y decodificación física.
- El contrato de telemetría V1 hacia Core acepta identidad + métricas semánticas normalizadas y rechaza detalles de adquisición.
- `driver`, `protocol`, mapas de registros, perfiles de lectura y topología física pueden permanecer temporalmente en Core como **plano de control/configuración** para el Gateway y como compatibilidad CAM-5; no forman parte del modelo operativo genérico.
- El fallback de configuración por registros de `/api/v1/gateway/config` quedó limitado explícitamente a dispositivos CAM-5 legacy.
- El workspace `/api/v1/configuration` basado en host/puerto/Unit ID/rangos/registros quedó limitado explícitamente a CAM-5 legacy.
- El commissioning basado en mapa FC03 418–522 quedó limitado explícitamente a CAM-5 legacy.
- No se eliminan todavía `readingProfiles`, `readingProfileRanges`, `registerDefinitions`, `deviceRegisterSamples` ni campos técnicos de `devices`: siguen teniendo dependencias reales de compatibilidad y configuración. Su retiro requiere una migración separada del plano de control al Gateway Agent.
- Regla V1: nuevos dispositivos normalizados no deben depender de esas estructuras para ingestión, histórico, alarmas, tendencias ni reportes.


## Corrección arquitectónica: CAM5 es un dispositivo más (2026-10-04)

Se elimina la excepción conceptual CAM5 del flujo V1.

- El alta de dispositivos en Core ya no selecciona perfiles CAM5 ni recibe host/puerto/Unit ID.
- Todos los dispositivos nuevos se provisionan bajo el contrato `normalized_json`.
- Organización y activos ya no muestra ni edita direccionamiento de transporte del dispositivo.
- Ingeniería expone Diagnóstico y Puesta en marcha para cualquier dispositivo, sin clasificación `cam5Like`.
- El commissioning automático se reescribió sobre evidencia genérica:
  - identidad del dispositivo;
  - salud del gateway;
  - métricas normalizadas configuradas y recibidas;
  - calidad de telemetría;
  - evidencia física de terreno.
- Las pruebas del motor de commissioning ya no contienen mapa 418–522, FC03, relés CAM5 ni estabilidad específica del equipo.
- Las estructuras históricas de registros permanecen temporalmente en el esquema para permitir una migración de datos segura, pero dejan de ser requisito para provisionar o comisionar dispositivos V1.

Pendiente del siguiente saneamiento:
- reescribir el módulo visual/API de Diagnóstico que aún consume `ingestion_batches` legacy;
- retirar o archivar `configuration` y el fallback legacy de `gateway/config` cuando el Gateway Agent tenga cubierto el plano de configuración genérico;
- migración posterior de tablas legacy, sin borrado destructivo anticipado.


## Saneamiento de frontera Gateway/Core (2026-10-04)

Bloque cerrado sobre la rama feature/hoit-core-v1.

- Diagnóstico del Core usa telemetría normalizada y métricas semánticas.
- Configuración del Core ya no edita direccionamiento ni parámetros del protocolo físico.
- Se eliminó del endpoint gateway/config el fallback de configuración basado en registros.
- Se eliminó del endpoint gateway/ingest la ingesta legacy de registros crudos.
- Core acepta únicamente los contratos de telemetría semántica normalizada soportados.
- La adquisición física, drivers, buses, direcciones, registros, escalado y decodificación permanecen en Gateway Agent.
- CAM5 no constituye una excepción arquitectónica: es un dispositivo gestionado por el Gateway igual que cualquier otro modelo.

Estado de validación del último cambio funcional:
- Lint HOIT Core: PASS.
- Simuladores Python: PASS.
- HOIT Gateway Agent: PASS.
- Tests DB/integración: PASS.
- Build Next.js/TypeScript: PASS.

Deuda técnica restante:
- El esquema conserva tablas y columnas legacy para migración/compatibilidad histórica. No forman parte del contrato funcional nuevo.
- Antes de borrarlas físicamente se debe confirmar que seeds, migraciones históricas y procesos de transición no las requieran.


## Bloque cerrado: provisionamiento Core protocol-agnostic (2026-10-04)

Se completó el saneamiento del flujo Cliente → Sitio → Activo → Gateway → Dispositivo.

- Jerarquía ya no expone host, puerto, protocolo ni Unit ID del dispositivo.
- La edición de dispositivos desde Core ya no permite modificar direccionamiento físico.
- Al crear un dispositivo, Core ya no genera valores ficticios de host/puerto/Unit ID.
- El vínculo operativo almacenado por Core es lógico: activo, gateway, modelo, capacidades y métricas.
- El catálogo de modelos presenta una “versión de definición” semántica en lugar de una “versión de mapa” físico. La columna histórica se conserva internamente hasta una migración de esquema posterior.
- Las plantillas de credenciales del Gateway usan variables HOIT_* en lugar de CAM5_*.
- CAM5 permanece como un modelo/dispositivo compatible, sin tratamiento especial en el flujo genérico nuevo.

Validación del bloque:
- Lint HOIT Core: PASS.
- Simuladores Python: PASS.
- HOIT Gateway Agent: PASS.
- Tests DB/integración: PASS.
- Build Next.js/TypeScript: PASS.

Siguiente foco recomendado:
- sanear el control plane para que la configuración física se origine/gestione explícitamente del lado Gateway sin reintroducirla como configuración de producto en Core;
- revisar nombres legacy CAM5 restantes y clasificarlos entre compatibilidad histórica y dependencias activas;
- después realizar E2E autenticado de roles y onboarding completo.


## Punto de corte antes de revisión visual (2026-10-04)

Se cerró el saneamiento inmediato del control plane antes de continuar con cambios visuales de frontend.

- Las capacidades de `device_models` quedan tipadas únicamente como capacidades/métricas semánticas; driver y protocolo ya no forman parte de la plantilla de producto.
- El generador de configuración del Gateway dejó de leer `devices.protocol`; el protocolo físico se resuelve desde el binding de adquisición.
- El archivo de entorno descargable usa exclusivamente variables `HOIT_*` e incluye explícitamente `HOIT_GATEWAY_ID`, consistente con el runtime actual del Gateway Agent.
- El Gateway Agent sigue siendo el único componente que interpreta driver, transporte y polling para producir telemetría normalizada.
- Las columnas legacy de `devices` y la persistencia de bindings se conservan por ahora como deuda de migración/control plane; no se exponen como configuración del producto Core.

CI del punto de corte: PASS completo.

Decisión de trabajo: detener aquí nuevas expansiones visuales/funcionales y realizar una revisión visual del Preview pantalla por pantalla antes de seguir modificando el frontend.


## Dashboard operacional v3 (2026-10-05)

Rediseño visual/UX acordado tras revisión del Preview.

- Se elimina el hero redundante Inicio/Dashboard/Vista cliente y la explicación de independencia de protocolo.
- Cabecera compacta: estado de operación, cliente, estado online, hora de actualización y refresh.
- KPI consolidados en una franja única: alertas, salud de activos, conectividad y sitios monitoreados.
- Un entorno sin activos/equipos devuelve “— / Sin monitoreo”; nunca 100% saludable por ausencia de datos.
- “Adquisición” se reemplaza visualmente por “Conectividad”.
- Operación por sitio comunica estado, cobertura, conectividad, alertas y acción explícita Ver sitio/Configurar.
- Atención operacional y actividad reciente reemplazan paneles vacíos sobredimensionados.
- Se agrega vista temporal de 24 h usando exclusivamente eventos disponibles; no se inventan métricas históricas.
- Menos uppercase/eyebrows, menor radio, densidad mayor y uso de color reservado para significado operacional.
- Responsive actualizado para desktop/tablet/mobile.

Validación: lint, simuladores, Gateway Agent, tests DB y build PASS.

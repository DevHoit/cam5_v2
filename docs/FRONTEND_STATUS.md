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


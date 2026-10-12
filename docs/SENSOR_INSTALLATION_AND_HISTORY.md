# Sensores instalados e histórico tabular

## Operación

1. Seleccionar el activo CAM5 y abrir **Configuración** (también disponible en **Activos**).
2. En **Sensores instalados**, desplegar el equipo, marcar los sensores físicamente instalados y asignar nombres. Guardar por equipo.
3. Volver a supervisión, tendencias o Centro de alarmas → Reglas: solo aparecen los sensores instalados.
4. Abrir **Histórico → Mediciones**. Para telemetría normalizada se muestra una tabla por equipo/lote/hora. Seleccionar rango, equipo y columnas; ordenar las columnas con las flechas.
5. Exportar CSV para Excel conserva el rango, modo y orden de columnas, exportando todas las páginas hasta un límite explícito de 10.000 filas. UTF-8 BOM, separador punto y coma y fechas UTC. No genera XLSX nativo.

## Contrato y compatibilidad

- `device_metrics.metadata.installation`: `installed` o `excluded`. Alias en `sensorAlias`.
- `devices.metadata.sensorConfiguration=1` confirma la configuración. Métricas nuevas sin clasificación quedan pendientes y ocultas de las vistas operacionales tras esta confirmación.
- Antes de la primera confirmación se mantiene la visibilidad existente; el configurador etiqueta las métricas como pendientes de confirmar. No se migran instalaciones remotas automáticamente.
- No se modifica `enabled`, la adquisición ni el catálogo del gateway. Los paquetes completos de CAM5 siguen siendo aceptables aunque se muestren solo 5–7 sensores. Valores cero no prueban instalación.
- El catálogo muestra si se recibió alguna lectura y su fecha. Un sensor confirmado sigue visible sin datos recientes; la API latest conserva su calidad stale/offline.
- Alias y selección aplican a las vistas que consumen métricas normalizadas. Los módulos especializados con canales heredados mantienen su representación anterior.
- No se crean definiciones arbitrarias a partir de paquetes: siguen vigentes las validaciones del protocolo. Una nueva métrica registrada aparecerá pendiente.
- Guardado transaccional, permiso settings.write, ámbito de sitio/activo, revisión optimista por updatedAt, auditoría. La exclusión con reglas habilitadas se bloquea; no resuelve alarmas ni cancela notificaciones silenciosamente. El motor rechaza lecturas de sensores excluidos.
- Las reglas específicas de laboratorio siguen administradas por su flujo original.

## Histórico

- API `/api/v1/history/table`: permiso history.read y ámbito activo. Exportar requiere además history.export.
- Una fila cruda = dispositivo + recordedAt + batchId; dos lotes a la misma hora no se fusionan. Las celdas ausentes son nulas/vacías, sin fill-forward. Cero y false se conservan.
- Paginación de 100 filas completas, orden estable descendente por hora, equipo y lote; no se pagina por lecturas individuales.
- Columnas por sensor/dispositivo (ID estable) con nombre y unidad; al consultar varios equipos las columnas ajenas quedan vacías. Filtros por equipo y columnas y reordenamiento explícito.
- Agrupación opcional minuto/hora/día UTC: promedio, mínimo, máximo o último válido para números; último válido para texto/booleanos. Solo lecturas good participan en el valor agrupado. Se marca calidad parcial si hay muestras inválidas.
- Calidad cruda visible con advertencia; tooltip informa calidad/conteo. CSV exporta valores, no el tooltip de calidad.
- Consulta y agrupación usan lecturas crudas; rango máximo 31 días y retención cruda existente de 30 días. No se reconstruyen lotes a partir de agregados históricos. Agregados multianuales y XLSX nativo quedan como ampliación posterior.
- Los históricos de alarmas/auditoría y canales anteriores se mantienen.

## Verificación

`tests/sensor-history.test.ts`: PostgreSQL embebido con migraciones, persistencia, guardas de edición concurrente, ingestión habilitada pese a exclusión, nuevas métricas pendientes, separación de lotes, huecos/0/false, agregación ignorando inválidos, orden de columnas, CSV seguro, aislamiento sitio/activo, permisos exportación, paginación por filas y bloqueo de exclusión con regla activa.

Complementar con pruebas existentes de motor de reglas, ingestión SPEC/v2 y laboratorio. Sin envíos externos, activación de dispatcher, reinicio de scheduler ni cambios de producción.

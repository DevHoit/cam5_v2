# Cobertura PostgreSQL de HoitLive Core

Esta matriz documenta la fuente de verdad de cada módulo visible. El frontend no mantiene telemetría, alarmas, usuarios ni configuración en `localStorage`, arreglos de demostración o estados persistentes del navegador.

| Módulo | API utilizada | Fuente principal en PostgreSQL |
| --- | --- | --- |
| Acceso y contexto activo | `/api/v1/auth/login`, `/auth/session`, `/auth/logout`, `/auth/context` | `users`, `auth_identities`, `auth_sessions`, `user_client_assignments`, `user_role_assignments` |
| Resumen operativo | `/api/v1/telemetry/latest`, `/api/v1/alarms`, `/api/v1/trends` | `latest_readings`, `readings`, `channels`, `alarm_rules`, `alarms`, `gateways`, `devices` |
| Mapa de condición | `/api/v1/telemetry/latest` | `latest_readings`, `channels`, `physical_inputs`, `register_definitions`, `alarm_rules` |
| Diagnóstico | `/api/v1/diagnostics` | `ingestion_batches`, `gateways`, `devices`, `reading_profiles`, `audit_logs` |
| Puesta en marcha | `/api/v1/commissioning` | `commissioning_items`, `devices`, `physical_inputs`, `relay_configurations`, `configuration_snapshots`, `ingestion_batches` |
| Tendencias | `/api/v1/trends`, `/api/v1/trends/aggregate` | `readings`, `reading_aggregates`, `channels`, `alarm_rules` |
| Centro de alertas | `/api/v1/alarms`, `/api/v1/alarm-rules` | `alarms`, `alarm_events`, `alarm_rules`, `alarm_rule_states`, `users` |
| Histórico | `/api/v1/history` | `readings`, `alarms`, `alarm_events`, `audit_logs` |
| Estructura operacional | `/api/v1/hierarchy` | `clients`, `sites`, `assets`, `gateways`, `devices` y asignaciones de acceso |
| Reportes | `/api/v1/reports`, `/api/v1/report-schedules` | `report_templates`, `report_runs`, `report_schedules`, más snapshots de telemetría y alarmas |
| Configuración | `/api/v1/configuration` | `devices`, `reading_profiles`, `reading_profile_ranges`, `physical_inputs`, `channels`, `alarm_rules`, `relay_configurations`, `configuration_snapshots` |
| Provisionamiento | `/api/v1/gateway-credentials` | `gateway_api_credentials`, `gateways`, `audit_logs` |
| Usuarios | `/api/v1/users` | `users`, `auth_identities`, `roles`, `user_client_assignments`, `user_role_assignments` |
| Notificaciones | `/api/v1/notification-*`, `/api/v1/notifications/*` | `notification_endpoints`, `notification_policies`, `notification_deliveries`, `alarms` |
| Mi cuenta | `/api/v1/account` | `users`, `auth_identities`, `auth_sessions`, `audit_logs` |

## Flujo de telemetría

```text
CAM-5 → gateway → POST /api/v1/gateway/ingest
                    ├── ingestion_batches / device_register_samples
                    ├── readings / latest_readings
                    ├── alarm_rules / alarm_rule_states / alarms
                    └── APIs del portal → frontend
```

Los nombres de cliente, sitio, punto, gateway y controlador que aparecen en pantalla se obtienen de la jerarquía almacenada. Los valores de medición visibles se obtienen de `latest_readings` o `readings`; cuando todavía no existen muestras, el portal muestra un estado vacío o sin comunicación.

El catálogo Modbus, las capacidades físicas, el checklist y los valores iniciales de configuración son definiciones del producto usadas únicamente al crear una instalación nueva. El seed no inserta lecturas y no vuelve a sobrescribir una configuración operacional ya existente.

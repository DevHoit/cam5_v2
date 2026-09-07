export const PORTAL_PERMISSIONS = [
  { code: "overview.read", module: "overview", action: "read", description: "Ver resumen operacional" },
  { code: "condition.read", module: "condition", action: "read", description: "Ver mapa de condición" },
  { code: "diagnostics.read", module: "diagnostics", action: "read", description: "Ver diagnóstico de comunicación" },
  { code: "diagnostics.execute", module: "diagnostics", action: "execute", description: "Ejecutar diagnóstico de comunicación" },
  { code: "trends.read", module: "trends", action: "read", description: "Ver tendencias" },
  { code: "history.read", module: "history", action: "read", description: "Consultar histórico" },
  { code: "history.export", module: "history", action: "export", description: "Exportar histórico" },
  { code: "alarms.read", module: "alarms", action: "read", description: "Ver alarmas" },
  { code: "alarms.acknowledge", module: "alarms", action: "acknowledge", description: "Reconocer alarmas" },
  { code: "alarms.close", module: "alarms", action: "close", description: "Cerrar alarmas" },
  { code: "assets.read", module: "assets", action: "read", description: "Ver activos" },
  { code: "assets.write", module: "assets", action: "write", description: "Editar activos" },
  { code: "reports.read", module: "reports", action: "read", description: "Ver reportes" },
  { code: "reports.generate", module: "reports", action: "generate", description: "Generar reportes" },
  { code: "reports.schedule", module: "reports", action: "schedule", description: "Programar reportes" },
  { code: "settings.read", module: "settings", action: "read", description: "Ver configuración" },
  { code: "settings.write", module: "settings", action: "write", description: "Modificar configuración" },
  { code: "commissioning.read", module: "commissioning", action: "read", description: "Ver puesta en marcha" },
  { code: "commissioning.execute", module: "commissioning", action: "execute", description: "Ejecutar puesta en marcha" },
  { code: "relays.read", module: "relays", action: "read", description: "Ver matriz de relés" },
  { code: "relays.write", module: "relays", action: "write", description: "Modificar matriz de relés" },
  { code: "integrations.read", module: "integrations", action: "read", description: "Ver integraciones" },
  { code: "integrations.write", module: "integrations", action: "write", description: "Modificar integraciones" },
  { code: "users.read", module: "users", action: "read", description: "Ver usuarios y perfiles" },
  { code: "users.manage", module: "users", action: "manage", description: "Administrar usuarios y perfiles" },
  { code: "notifications.read", module: "notifications", action: "read", description: "Ver notificaciones" },
  { code: "notifications.write", module: "notifications", action: "write", description: "Configurar notificaciones" },
  { code: "audit.read", module: "audit", action: "read", description: "Consultar auditoría" },
] as const;

export type PortalPermission = (typeof PORTAL_PERMISSIONS)[number]["code"];

const READ_ONLY_PERMISSIONS = PORTAL_PERMISSIONS
  .filter((permission) => permission.action === "read")
  .map((permission) => permission.code);

export const PORTAL_ROLES: ReadonlyArray<{
  key: "administrator" | "engineer" | "operator" | "viewer";
  name: string;
  description: string;
  permissions: readonly PortalPermission[];
}> = [
  {
    key: "administrator",
    name: "Administrador",
    description: "Control total del portal, seguridad, configuración y puesta en marcha.",
    permissions: PORTAL_PERMISSIONS.map((permission) => permission.code),
  },
  {
    key: "engineer",
    name: "Ingeniero",
    description: "Diagnóstico, configuración técnica, tendencias, alarmas y puesta en marcha.",
    permissions: PORTAL_PERMISSIONS
      .filter((permission) => permission.code !== "users.manage")
      .map((permission) => permission.code),
  },
  {
    key: "operator",
    name: "Operador",
    description: "Supervisión diaria, reconocimiento de alarmas y consulta de reportes.",
    permissions: [
      ...READ_ONLY_PERMISSIONS,
      "diagnostics.execute",
      "alarms.acknowledge",
      "reports.generate",
    ],
  },
  {
    key: "viewer",
    name: "Solo lectura",
    description: "Consulta del portal sin cambios, reconocimientos, exportaciones ni acciones de campo.",
    permissions: READ_ONLY_PERMISSIONS,
  },
];

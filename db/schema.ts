import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", ["invited", "active", "suspended"]);
export const identityProviderEnum = pgEnum("identity_provider", ["local", "chatgpt", "oidc"]);
export const assetStateEnum = pgEnum("asset_state", ["normal", "warning", "critical", "offline", "maintenance"]);
export const gatewayStateEnum = pgEnum("gateway_state", ["pending", "online", "degraded", "offline"]);
export const deviceStateEnum = pgEnum("device_state", ["draft", "commissioning", "active", "offline", "maintenance", "decommissioned"]);
export const inputKindEnum = pgEnum("input_kind", ["temperature_saw", "uhf", "humidity"]);
export const channelMetricEnum = pgEnum("channel_metric", [
  "temperature",
  "ambient_temperature",
  "humidity",
  "partial_discharge",
  "surface_discharge",
  "noise",
  "event_count",
  "alpha",
  "beta",
  "phi",
  "system",
]);
export const registerDataTypeEnum = pgEnum("register_data_type", ["int16", "uint16"]);
export const dataQualityEnum = pgEnum("data_quality", ["good", "stale", "bad", "disabled"]);
export const severityEnum = pgEnum("severity", ["normal", "warning", "critical"]);
export const alarmStatusEnum = pgEnum("alarm_status", ["open", "acknowledged", "closed"]);
export const workOrderStatusEnum = pgEnum("work_order_status", ["pending", "in_progress", "completed", "cancelled"]);
export const workOrderPriorityEnum = pgEnum("work_order_priority", ["normal", "high", "critical"]);
export const commissioningStatusEnum = pgEnum("commissioning_status", ["pending", "passed", "failed", "not_applicable"]);
export const reportRunStatusEnum = pgEnum("report_run_status", ["queued", "running", "completed", "failed"]);
export const notificationKindEnum = pgEnum("notification_kind", ["email", "teams", "webhook"]);
export const integrationKindEnum = pgEnum("integration_kind", ["webhook", "rest_api", "email", "teams", "cmms"]);
export const auditOutcomeEnum = pgEnum("audit_outcome", ["success", "denied", "failed"]);
export const configurationKindEnum = pgEnum("configuration_kind", ["baseline", "manual", "pre_deploy", "backup", "restore"]);

export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 60 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  legalName: varchar("legal_name", { length: 220 }),
  taxId: varchar("tax_id", { length: 40 }),
  contactEmail: varchar("contact_email", { length: 320 }),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("clients_code_uidx").on(table.code),
  index("clients_active_idx").on(table.active),
]);

export const sites = pgTable("sites", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 40 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  timezone: varchar("timezone", { length: 80 }).default("America/Santiago").notNull(),
  description: text("description"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sites_client_code_uidx").on(table.clientId, table.code),
  index("sites_client_active_idx").on(table.clientId, table.active),
]);

export const assets = pgTable("assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 60 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  area: varchar("area", { length: 160 }),
  assetType: varchar("asset_type", { length: 80 }).default("switchgear_cabinet").notNull(),
  nominalVoltageKv: numeric("nominal_voltage_kv", { precision: 8, scale: 3 }),
  state: assetStateEnum("state").default("offline").notNull(),
  active: boolean("active").default(true).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("assets_site_code_uidx").on(table.siteId, table.code),
  index("assets_site_state_idx").on(table.siteId, table.state),
]);

export const gateways = pgTable("gateways", {
  id: uuid("id").defaultRandom().primaryKey(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 60 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  serialNumber: varchar("serial_number", { length: 120 }),
  softwareVersion: varchar("software_version", { length: 80 }),
  state: gatewayStateEnum("state").default("pending").notNull(),
  active: boolean("active").default(true).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  ipAddress: varchar("ip_address", { length: 64 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("gateways_site_code_uidx").on(table.siteId, table.code),
  index("gateways_site_state_idx").on(table.siteId, table.state),
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  displayName: varchar("display_name", { length: 160 }).notNull(),
  status: userStatusEnum("status").default("invited").notNull(),
  locale: varchar("locale", { length: 16 }).default("es-CL").notNull(),
  timezone: varchar("timezone", { length: 80 }).default("America/Santiago").notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("users_email_lower_uidx").on(sql`lower(${table.email})`),
  index("users_status_idx").on(table.status),
]);

export const authIdentities = pgTable("auth_identities", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: identityProviderEnum("provider").notNull(),
  providerSubject: varchar("provider_subject", { length: 320 }).notNull(),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("auth_identities_provider_subject_uidx").on(table.provider, table.providerSubject),
  index("auth_identities_user_idx").on(table.userId),
  check("auth_identities_password_chk", sql`(${table.provider} = 'local' AND ${table.passwordHash} IS NOT NULL) OR (${table.provider} <> 'local' AND ${table.passwordHash} IS NULL)`),
]);

export const gatewayApiCredentials = pgTable("gateway_api_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  gatewayId: uuid("gateway_id").notNull().references(() => gateways.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  tokenPrefix: varchar("token_prefix", { length: 24 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("gateway_api_credentials_token_hash_uidx").on(table.tokenHash),
  index("gateway_api_credentials_gateway_idx").on(table.gatewayId, table.revokedAt),
]);

export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: varchar("key", { length: 60 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  isSystem: boolean("is_system").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("roles_key_uidx").on(table.key)]);

export const permissions = pgTable("permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 100 }).notNull(),
  module: varchar("module", { length: 60 }).notNull(),
  action: varchar("action", { length: 40 }).notNull(),
  description: text("description"),
}, (table) => [
  uniqueIndex("permissions_code_uidx").on(table.code),
  index("permissions_module_idx").on(table.module),
]);

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })]);

export const userClientAssignments = pgTable("user_client_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
  grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("user_client_assignments_scope_uidx").on(table.userId, table.clientId),
  index("user_client_assignments_client_idx").on(table.clientId, table.userId),
]);

export const userRoleAssignments = pgTable("user_role_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
  grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => [
  unique("user_role_scope_uidx").on(table.userId, table.roleId, table.siteId).nullsNotDistinct(),
  index("user_role_site_idx").on(table.siteId, table.userId),
]);

export const userAssetScopes = pgTable("user_asset_scopes", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.assetId] })]);

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  activeSiteId: uuid("active_site_id").references(() => sites.id, { onDelete: "set null" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("auth_sessions_token_hash_uidx").on(table.tokenHash),
  index("auth_sessions_user_expiry_idx").on(table.userId, table.expiresAt),
  index("auth_sessions_active_site_idx").on(table.activeSiteId),
  check("auth_sessions_expiry_chk", sql`${table.expiresAt} > ${table.createdAt}`),
]);

export const userInvitations = pgTable("user_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("user_invitations_token_hash_uidx").on(table.tokenHash),
  index("user_invitations_site_email_idx").on(table.siteId, table.email),
  check("user_invitations_expiry_chk", sql`${table.expiresAt} > ${table.createdAt}`),
]);

export const readingProfiles = pgTable("reading_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: varchar("key", { length: 60 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  staleAfterSeconds: integer("stale_after_seconds").default(30).notNull(),
  rawRetentionDays: integer("raw_retention_days").default(30).notNull(),
  aggregateRetentionDays: integer("aggregate_retention_days").default(1825).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("reading_profiles_key_uidx").on(table.key),
  check("reading_profiles_stale_positive_chk", sql`${table.staleAfterSeconds} > 0`),
  check("reading_profiles_retention_positive_chk", sql`${table.rawRetentionDays} > 0 AND ${table.aggregateRetentionDays} >= ${table.rawRetentionDays}`),
]);

export const readingProfileRanges = pgTable("reading_profile_ranges", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: uuid("profile_id").notNull().references(() => readingProfiles.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  startRegister: integer("start_register").notNull(),
  endRegister: integer("end_register").notNull(),
  functionCode: smallint("function_code").default(3).notNull(),
  intervalMs: integer("interval_ms").notNull(),
  priority: smallint("priority").default(100).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
}, (table) => [
  uniqueIndex("reading_profile_range_name_uidx").on(table.profileId, table.name),
  index("reading_profile_range_priority_idx").on(table.profileId, table.priority),
  check("reading_profile_ranges_bounds_chk", sql`${table.startRegister} >= 0 AND ${table.endRegister} >= ${table.startRegister}`),
  check("reading_profile_ranges_interval_chk", sql`${table.intervalMs} >= 500`),
  check("reading_profile_ranges_function_chk", sql`${table.functionCode} IN (3, 4)`),
]);

export const deviceModels = pgTable("device_models", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 80 }).notNull(),
  manufacturer: varchar("manufacturer", { length: 100 }).default("IntelliSAW").notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  registerMapVersion: varchar("register_map_version", { length: 40 }).notNull(),
  capabilities: jsonb("capabilities").$type<{
    temperatureInputs: number;
    uhfInputs: number;
    humidityInputs: number;
    relayOutputs: number;
  }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("device_models_code_uidx").on(table.code)]);

export const devices = pgTable("devices", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  gatewayId: uuid("gateway_id").notNull().references(() => gateways.id, { onDelete: "restrict" }),
  modelId: uuid("model_id").notNull().references(() => deviceModels.id, { onDelete: "restrict" }),
  readingProfileId: uuid("reading_profile_id").references(() => readingProfiles.id, { onDelete: "set null" }),
  code: varchar("code", { length: 60 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  serialNumber: varchar("serial_number", { length: 120 }),
  firmwareVersion: varchar("firmware_version", { length: 80 }),
  dataVersion: integer("data_version"),
  state: deviceStateEnum("state").default("draft").notNull(),
  active: boolean("active").default(true).notNull(),
  protocol: varchar("protocol", { length: 24 }).default("modbus_tcp").notNull(),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").default(502).notNull(),
  unitId: smallint("unit_id").default(1).notNull(),
  timeoutMs: integer("timeout_ms").default(1000).notNull(),
  retries: smallint("retries").default(2).notNull(),
  registerConvention: varchar("register_convention", { length: 32 }).default("native_and_400xxx").notNull(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  clockOffsetMs: integer("clock_offset_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("devices_gateway_unit_uidx").on(table.gatewayId, table.unitId),
  uniqueIndex("devices_asset_code_uidx").on(table.assetId, table.code),
  index("devices_gateway_state_idx").on(table.gatewayId, table.state),
  check("devices_port_chk", sql`${table.port} BETWEEN 1 AND 65535`),
  check("devices_unit_id_chk", sql`${table.unitId} BETWEEN 0 AND 247`),
  check("devices_timeout_chk", sql`${table.timeoutMs} > 0`),
  check("devices_retries_chk", sql`${table.retries} BETWEEN 0 AND 10`),
]);

export const registerDefinitions = pgTable("register_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  modelId: uuid("model_id").notNull().references(() => deviceModels.id, { onDelete: "cascade" }),
  nativeRegister: integer("native_register").notNull(),
  humanReference: varchar("human_reference", { length: 20 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  registerGroup: varchar("register_group", { length: 60 }).notNull(),
  metric: channelMetricEnum("metric").notNull(),
  dataType: registerDataTypeEnum("data_type").notNull(),
  scaleFactor: numeric("scale_factor", { precision: 16, scale: 6 }).default("1").notNull(),
  scaleNote: varchar("scale_note", { length: 80 }),
  unit: varchar("unit", { length: 40 }).notNull(),
  errorRawValue: integer("error_raw_value"),
  minimumValue: numeric("minimum_value", { precision: 18, scale: 6 }),
  maximumValue: numeric("maximum_value", { precision: 18, scale: 6 }),
  writable: boolean("writable").default(false).notNull(),
}, (table) => [
  uniqueIndex("register_model_native_uidx").on(table.modelId, table.nativeRegister),
  index("register_model_group_idx").on(table.modelId, table.registerGroup),
  check("register_native_nonnegative_chk", sql`${table.nativeRegister} >= 0`),
]);

export const physicalInputs = pgTable("physical_inputs", {
  id: uuid("id").defaultRandom().primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 40 }).notNull(),
  kind: inputKindEnum("kind").notNull(),
  portNumber: smallint("port_number").notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  assignment: varchar("assignment", { length: 180 }),
  zone: varchar("zone", { length: 160 }),
  calibrationCode: varchar("calibration_code", { length: 120 }),
  frequencyBand: varchar("frequency_band", { length: 80 }),
  antennaPort: varchar("antenna_port", { length: 80 }),
  signalStrength: numeric("signal_strength", { precision: 12, scale: 3 }),
  humidityIndex: numeric("humidity_index", { precision: 12, scale: 3 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("physical_inputs_device_code_uidx").on(table.deviceId, table.code),
  uniqueIndex("physical_inputs_device_kind_port_uidx").on(table.deviceId, table.kind, table.portNumber),
  check("physical_inputs_port_positive_chk", sql`${table.portNumber} > 0`),
]);

export const channels = pgTable("channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  physicalInputId: uuid("physical_input_id").references(() => physicalInputs.id, { onDelete: "set null" }),
  registerDefinitionId: uuid("register_definition_id").notNull().references(() => registerDefinitions.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 40 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  zone: varchar("zone", { length: 160 }),
  metric: channelMetricEnum("metric").notNull(),
  unit: varchar("unit", { length: 40 }).notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  displayOrder: integer("display_order").default(0).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("channels_device_code_uidx").on(table.deviceId, table.code),
  uniqueIndex("channels_device_register_uidx").on(table.deviceId, table.registerDefinitionId),
  index("channels_asset_enabled_idx").on(table.assetId, table.enabled),
  index("channels_input_idx").on(table.physicalInputId),
  check("channels_display_order_nonnegative_chk", sql`${table.displayOrder} >= 0`),
]);

export const alarmRules = pgTable("alarm_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").default(true).notNull(),
  warningThreshold: numeric("warning_threshold", { precision: 18, scale: 6 }),
  criticalThreshold: numeric("critical_threshold", { precision: 18, scale: 6 }),
  hysteresis: numeric("hysteresis", { precision: 18, scale: 6 }).default("0").notNull(),
  activationSamples: smallint("activation_samples").default(3).notNull(),
  recoverySamples: smallint("recovery_samples").default(3).notNull(),
  staleAfterSeconds: integer("stale_after_seconds").default(30).notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("alarm_rules_channel_uidx").on(table.channelId),
  check("alarm_rules_threshold_order_chk", sql`${table.warningThreshold} IS NULL OR ${table.criticalThreshold} IS NULL OR ${table.warningThreshold} < ${table.criticalThreshold}`),
  check("alarm_rules_hysteresis_chk", sql`${table.hysteresis} >= 0`),
  check("alarm_rules_samples_chk", sql`${table.activationSamples} > 0 AND ${table.recoverySamples} > 0`),
  check("alarm_rules_stale_positive_chk", sql`${table.staleAfterSeconds} > 0`),
]);

export const ingestionBatches = pgTable("ingestion_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  gatewayId: uuid("gateway_id").notNull().references(() => gateways.id, { onDelete: "restrict" }),
  deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "restrict" }),
  batchKey: varchar("batch_key", { length: 160 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expectedRegisters: integer("expected_registers").notNull(),
  receivedRegisters: integer("received_registers").default(0).notNull(),
  latencyMs: integer("latency_ms"),
  success: boolean("success").default(false).notNull(),
  errorMessage: text("error_message"),
}, (table) => [
  uniqueIndex("ingestion_batches_gateway_key_uidx").on(table.gatewayId, table.batchKey),
  index("ingestion_batches_device_started_idx").on(table.deviceId, table.startedAt),
  check("ingestion_batches_counts_chk", sql`${table.expectedRegisters} > 0 AND ${table.receivedRegisters} >= 0 AND ${table.receivedRegisters} <= ${table.expectedRegisters}`),
]);

export const deviceRegisterSamples = pgTable("device_register_samples", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  batchId: uuid("batch_id").notNull().references(() => ingestionBatches.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "restrict" }),
  registerDefinitionId: uuid("register_definition_id").notNull().references(() => registerDefinitions.id, { onDelete: "restrict" }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  rawValue: integer("raw_value"),
  value: numeric("value", { precision: 18, scale: 6 }),
  quality: dataQualityEnum("quality").notNull(),
  qualityFlags: jsonb("quality_flags").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  sequence: bigint("sequence", { mode: "number" }),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("device_register_samples_batch_register_uidx").on(table.batchId, table.registerDefinitionId),
  index("device_register_samples_device_time_idx").on(table.deviceId, table.recordedAt),
  index("device_register_samples_register_time_idx").on(table.registerDefinitionId, table.recordedAt),
]);

export const readings = pgTable("readings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => ingestionBatches.id, { onDelete: "set null" }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  rawValue: integer("raw_value"),
  value: numeric("value", { precision: 18, scale: 6 }),
  quality: dataQualityEnum("quality").notNull(),
  qualityFlags: jsonb("quality_flags").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  sequence: bigint("sequence", { mode: "number" }),
}, (table) => [
  index("readings_channel_recorded_idx").on(table.channelId, table.recordedAt),
  index("readings_recorded_idx").on(table.recordedAt),
  index("readings_quality_recorded_idx").on(table.quality, table.recordedAt),
  uniqueIndex("readings_channel_time_sequence_uidx").on(table.channelId, table.recordedAt, table.sequence),
  uniqueIndex("readings_batch_channel_uidx").on(table.batchId, table.channelId),
]);

export const latestReadings = pgTable("latest_readings", {
  channelId: uuid("channel_id").primaryKey().references(() => channels.id, { onDelete: "cascade" }),
  readingId: bigint("reading_id", { mode: "number" }).notNull().references(() => readings.id, { onDelete: "restrict" }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  rawValue: integer("raw_value"),
  value: numeric("value", { precision: 18, scale: 6 }),
  quality: dataQualityEnum("quality").notNull(),
  qualityFlags: jsonb("quality_flags").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  sequence: bigint("sequence", { mode: "number" }),
}, (table) => [index("latest_readings_quality_idx").on(table.quality)]);

export const readingAggregates = pgTable("reading_aggregates", {
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
  bucketSeconds: integer("bucket_seconds").notNull(),
  sampleCount: integer("sample_count").notNull(),
  invalidSampleCount: integer("invalid_sample_count").default(0).notNull(),
  minimumValue: numeric("minimum_value", { precision: 18, scale: 6 }),
  maximumValue: numeric("maximum_value", { precision: 18, scale: 6 }),
  averageValue: numeric("average_value", { precision: 18, scale: 6 }),
  firstValue: numeric("first_value", { precision: 18, scale: 6 }),
  lastValue: numeric("last_value", { precision: 18, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.bucketStart, table.bucketSeconds] }),
  index("reading_aggregates_bucket_idx").on(table.bucketSeconds, table.bucketStart),
  check("reading_aggregates_bucket_chk", sql`${table.bucketSeconds} IN (60, 300, 3600, 86400)`),
  check("reading_aggregates_samples_chk", sql`${table.sampleCount} > 0 AND ${table.invalidSampleCount} >= 0 AND ${table.invalidSampleCount} <= ${table.sampleCount}`),
]);

export const relayConfigurations = pgTable("relay_configurations", {
  id: uuid("id").defaultRandom().primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  relayNumber: smallint("relay_number").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  sourceExpression: text("source_expression").notNull(),
  severity: severityEnum("severity").default("critical").notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  failsafe: boolean("failsafe").default(true).notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("relay_device_number_uidx").on(table.deviceId, table.relayNumber),
  check("relay_number_chk", sql`${table.relayNumber} BETWEEN 1 AND 6`),
]);

export const alarms = pgTable("alarms", {
  id: uuid("id").defaultRandom().primaryKey(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "restrict" }),
  assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
  ruleId: uuid("rule_id").references(() => alarmRules.id, { onDelete: "set null" }),
  code: varchar("code", { length: 80 }).notNull(),
  severity: severityEnum("severity").notNull(),
  status: alarmStatusEnum("status").default("open").notNull(),
  title: varchar("title", { length: 220 }).notNull(),
  detail: text("detail"),
  triggerValue: numeric("trigger_value", { precision: 18, scale: 6 }),
  thresholdValue: numeric("threshold_value", { precision: 18, scale: 6 }),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
  occurrenceCount: integer("occurrence_count").default(1).notNull(),
  context: jsonb("context").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
}, (table) => [
  uniqueIndex("alarms_code_uidx").on(table.code),
  index("alarms_site_status_severity_idx").on(table.siteId, table.status, table.severity),
  index("alarms_asset_opened_idx").on(table.assetId, table.openedAt),
  index("alarms_channel_opened_idx").on(table.channelId, table.openedAt),
  check("alarms_occurrence_positive_chk", sql`${table.occurrenceCount} > 0`),
  check("alarms_observation_time_chk", sql`${table.lastObservedAt} >= ${table.openedAt}`),
]);

export const alarmEvents = pgTable("alarm_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  alarmId: uuid("alarm_id").notNull().references(() => alarms.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 60 }).notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
  payload: jsonb("payload").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("alarm_events_alarm_created_idx").on(table.alarmId, table.createdAt)]);

export const workOrders = pgTable("work_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "restrict" }),
  assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 80 }).notNull(),
  title: varchar("title", { length: 220 }).notNull(),
  description: text("description"),
  priority: workOrderPriorityEnum("priority").default("normal").notNull(),
  status: workOrderStatusEnum("status").default("pending").notNull(),
  assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("work_orders_code_uidx").on(table.code),
  index("work_orders_site_status_idx").on(table.siteId, table.status),
  index("work_orders_assignee_status_idx").on(table.assignedTo, table.status),
]);

export const workOrderAlarms = pgTable("work_order_alarms", {
  workOrderId: uuid("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  alarmId: uuid("alarm_id").notNull().references(() => alarms.id, { onDelete: "restrict" }),
}, (table) => [primaryKey({ columns: [table.workOrderId, table.alarmId] })]);

export const commissioningItems = pgTable("commissioning_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  itemKey: varchar("item_key", { length: 80 }).notNull(),
  label: varchar("label", { length: 220 }).notNull(),
  status: commissioningStatusEnum("status").default("pending").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  checkedBy: uuid("checked_by").references(() => users.id, { onDelete: "set null" }),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  note: text("note"),
}, (table) => [
  uniqueIndex("commissioning_device_item_uidx").on(table.deviceId, table.itemKey),
  index("commissioning_device_status_idx").on(table.deviceId, table.status),
]);

export const configurationSnapshots = pgTable("configuration_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "restrict" }),
  kind: configurationKindEnum("kind").notNull(),
  version: integer("version").notNull(),
  checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
  storageKey: text("storage_key").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("configuration_device_version_uidx").on(table.deviceId, table.version),
  index("configuration_device_created_idx").on(table.deviceId, table.createdAt),
  check("configuration_version_positive_chk", sql`${table.version} > 0`),
]);

export const reportTemplates = pgTable("report_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 80 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  description: text("description"),
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("report_template_site_key_uidx").on(table.siteId, table.key).nullsNotDistinct()]);

export const reportSchedules = pgTable("report_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  templateId: uuid("template_id").notNull().references(() => reportTemplates.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }),
  cronExpression: varchar("cron_expression", { length: 120 }).notNull(),
  timezone: varchar("timezone", { length: 80 }).default("America/Santiago").notNull(),
  recipients: jsonb("recipients").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  active: boolean("active").default(true).notNull(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => [index("report_schedules_next_run_idx").on(table.active, table.nextRunAt)]);

export const reportRuns = pgTable("report_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  templateId: uuid("template_id").notNull().references(() => reportTemplates.id, { onDelete: "restrict" }),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
  status: reportRunStatusEnum("status").default("queued").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  storageKey: text("storage_key"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("report_runs_status_created_idx").on(table.status, table.createdAt),
  check("report_runs_period_chk", sql`${table.periodEnd} > ${table.periodStart}`),
]);

export const notificationEndpoints = pgTable("notification_endpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  kind: notificationKindEnum("kind").notNull(),
  configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull(),
  secretReference: text("secret_reference"),
  enabled: boolean("enabled").default(true).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("notification_endpoint_site_name_uidx").on(table.siteId, table.name)]);

export const notificationPolicies = pgTable("notification_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  endpointId: uuid("endpoint_id").notNull().references(() => notificationEndpoints.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  minimumSeverity: severityEnum("minimum_severity").default("warning").notNull(),
  escalationDelayMinutes: integer("escalation_delay_minutes").default(0).notNull(),
  repeatIntervalMinutes: integer("repeat_interval_minutes"),
  active: boolean("active").default(true).notNull(),
  filters: jsonb("filters").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
}, (table) => [
  index("notification_policy_site_active_idx").on(table.siteId, table.active),
  check("notification_policy_delays_chk", sql`${table.escalationDelayMinutes} >= 0 AND (${table.repeatIntervalMinutes} IS NULL OR ${table.repeatIntervalMinutes} > 0)`),
]);

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  endpointId: uuid("endpoint_id").notNull().references(() => notificationEndpoints.id, { onDelete: "restrict" }),
  alarmId: uuid("alarm_id").references(() => alarms.id, { onDelete: "set null" }),
  recipient: varchar("recipient", { length: 320 }),
  status: varchar("status", { length: 32 }).default("queued").notNull(),
  attemptCount: smallint("attempt_count").default(0).notNull(),
  providerMessageId: varchar("provider_message_id", { length: 180 }),
  errorMessage: text("error_message"),
  queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (table) => [
  index("notification_deliveries_status_queued_idx").on(table.status, table.queuedAt),
  index("notification_deliveries_alarm_idx").on(table.alarmId),
  check("notification_deliveries_attempt_chk", sql`${table.attemptCount} >= 0`),
  check("notification_deliveries_status_chk", sql`${table.status} IN ('queued', 'sending', 'delivered', 'failed')`),
]);

export const integrations = pgTable("integrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  kind: integrationKindEnum("kind").notNull(),
  baseUrl: text("base_url"),
  configuration: jsonb("configuration").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  secretReference: text("secret_reference"),
  enabled: boolean("enabled").default(false).notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("integrations_site_name_uidx").on(table.siteId, table.name)]);

export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 120 }).notNull(),
  resourceType: varchar("resource_type", { length: 80 }).notNull(),
  resourceId: varchar("resource_id", { length: 160 }),
  outcome: auditOutcomeEnum("outcome").default("success").notNull(),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: text("user_agent"),
  requestId: varchar("request_id", { length: 120 }),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("audit_site_created_idx").on(table.siteId, table.createdAt),
  index("audit_actor_created_idx").on(table.actorUserId, table.createdAt),
  index("audit_resource_idx").on(table.resourceType, table.resourceId),
]);

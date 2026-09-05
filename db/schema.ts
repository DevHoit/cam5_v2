import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull(),
  model: text("model").notNull(),
  serialNumber: text("serial_number").notNull(),
  firmwareVersion: text("firmware_version").notNull(),
  dataVersion: integer("data_version").notNull(),
  capabilities: text("capabilities").notNull(), // JSON
  connection: text("connection").notNull(), // JSON
  network: text("network").notNull(), // JSON
  lastSeenAt: text("last_seen_at"),
});

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  sourceId: text("source_id").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  label: text("label").notNull(),
  location: text("location").notNull(),
  metric: text("metric").notNull(),
  nativeRegister: integer("native_register").notNull(),
  warningThreshold: real("warning_threshold"),
  alarmThreshold: real("alarm_threshold"),
  recoveryDeadband: real("recovery_deadband"),
  activationSamples: integer("activation_samples").notNull().default(3),
  recoverySamples: integer("recovery_samples").notNull().default(3),
  staleAfterSeconds: integer("stale_after_seconds").notNull().default(30),
});

export const inputAssignments = sqliteTable("input_assignments", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  type: text("type").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  location: text("location").notNull(),
  band: integer("band"),
  calibrationCode: text("calibration_code"),
  antennaPort: integer("antenna_port"),
  humidityIndex: integer("humidity_index"),
  mainsFrequencyHz: integer("mains_frequency_hz"),
  signalQuality: text("signal_quality"),
});

export const registerCatalog = sqliteTable("register_catalog", {
  nativeRegister: integer("native_register").primaryKey(),
  humanReference: text("human_reference").notNull(),
  description: text("description").notNull(),
  functionCode: integer("function_code").notNull(),
  dataType: text("data_type").notNull(),
  scale: real("scale").notNull(),
  unit: text("unit").notNull(),
  errorCode: integer("error_code").notNull(),
});

export const telemetryReadings = sqliteTable("telemetry_readings", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  channelId: text("channel_id").notNull(),
  sourceId: text("source_id").notNull(),
  assetId: text("asset_id").notNull(),
  nativeRegister: integer("native_register").notNull(),
  value: real("value"),
  rawValue: real("raw_value"),
  unit: text("unit").notNull(),
  severity: text("severity").notNull(),
  quality: text("quality").notNull(),
  qualityFlags: text("quality_flags").notNull(), // JSON array
  sourceTimestamp: text("source_timestamp").notNull(),
  receivedAt: text("received_at").notNull(),
  sequence: integer("sequence").notNull(),
});

export const alarms = sqliteTable("alarms", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull(),
  channelId: text("channel_id").notNull(),
  title: text("title").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull(),
  triggerValue: real("trigger_value").notNull(),
  threshold: real("threshold"),
  consecutiveSamples: integer("consecutive_samples").notNull(),
  openedAt: text("opened_at").notNull(),
  acknowledgedAt: text("acknowledged_at"),
  acknowledgedBy: text("acknowledged_by"),
  closedAt: text("closed_at"),
  note: text("note"),
});

export const relays = sqliteTable("relays", {
  relay: integer("relay").primaryKey(),
  deviceId: text("device_id").notNull(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  sources: text("sources").notNull(), // JSON array
  triggerLevel: text("trigger_level").notNull(),
  energized: integer("energized", { mode: "boolean" }).notNull(),
});

export const workOrders = sqliteTable("work_orders", {
  id: text("id").primaryKey(),
  sourceAlarmId: text("source_alarm_id"),
  title: text("title").notNull(),
  priority: text("priority").notNull(),
  status: text("status").notNull(),
  assigneeId: text("assignee_id").notNull(),
  dueAt: text("due_at"),
});

export const commissioning = sqliteTable("commissioning", {
  deviceId: text("device_id").primaryKey(),
  deviceDiscovered: integer("device_discovered", { mode: "boolean" }).notNull(),
  registerMapVerified: integer("register_map_verified", { mode: "boolean" }).notNull(),
  inputsVerified: integer("inputs_verified", { mode: "boolean" }).notNull(),
  clockSynchronized: integer("clock_synchronized", { mode: "boolean" }).notNull(),
  alarmsAndRelaysVerified: integer("alarms_and_relays_verified", { mode: "boolean" }).notNull(),
  initialBackupCreated: integer("initial_backup_created", { mode: "boolean" }).notNull(),
  historyVerified: integer("history_verified", { mode: "boolean" }).notNull(),
  acceptedForProduction: integer("accepted_for_production", { mode: "boolean" }).notNull(),
  checks: text("checks").notNull(), // JSON array
});

export const configurationSnapshots = sqliteTable("configuration_snapshots", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
  checksum: text("checksum"),
  payload: text("payload"), // JSON
});

export const logFiles = sqliteTable("log_files", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  createdAt: text("created_at").notNull(),
});

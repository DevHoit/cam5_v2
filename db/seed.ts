import { getDb } from "./index";
import * as schema from "./schema";
import { eq } from "drizzle-orm";
import { cam5RegisterCatalog, cam5OperationalChannels, cam5InputInventory, cam5RelayDefaults } from "../app/cam5-model";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export async function ensureDatabaseSeeded() {
  const dbDir = path.resolve(process.cwd(), ".db");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = path.join(dbDir, "cam5.db");
  const sqlite = new Database(dbPath);

  // Initialize table structure directly if needed
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      model TEXT NOT NULL,
      serial_number TEXT NOT NULL,
      firmware_version TEXT NOT NULL,
      data_version INTEGER NOT NULL,
      capabilities TEXT NOT NULL,
      connection TEXT NOT NULL,
      network TEXT NOT NULL,
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      label TEXT NOT NULL,
      location TEXT NOT NULL,
      metric TEXT NOT NULL,
      native_register INTEGER NOT NULL,
      warning_threshold REAL,
      alarm_threshold REAL,
      recovery_deadband REAL,
      activation_samples INTEGER NOT NULL DEFAULT 3,
      recovery_samples INTEGER NOT NULL DEFAULT 3,
      stale_after_seconds INTEGER NOT NULL DEFAULT 30
    );

    CREATE TABLE IF NOT EXISTS input_assignments (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      location TEXT NOT NULL,
      band INTEGER,
      calibration_code TEXT,
      antenna_port INTEGER,
      humidity_index INTEGER,
      mains_frequency_hz INTEGER,
      signal_quality TEXT
    );

    CREATE TABLE IF NOT EXISTS register_catalog (
      native_register INTEGER PRIMARY KEY,
      human_reference TEXT NOT NULL,
      description TEXT NOT NULL,
      function_code INTEGER NOT NULL,
      data_type TEXT NOT NULL,
      scale REAL NOT NULL,
      unit TEXT NOT NULL,
      error_code INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telemetry_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      native_register INTEGER NOT NULL,
      value REAL,
      raw_value REAL,
      unit TEXT NOT NULL,
      severity TEXT NOT NULL,
      quality TEXT NOT NULL,
      quality_flags TEXT NOT NULL,
      source_timestamp TEXT NOT NULL,
      received_at TEXT NOT NULL,
      sequence INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alarms (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger_value REAL NOT NULL,
      threshold REAL,
      consecutive_samples INTEGER NOT NULL,
      opened_at TEXT NOT NULL,
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      closed_at TEXT,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS relays (
      relay INTEGER PRIMARY KEY,
      device_id TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      sources TEXT NOT NULL,
      trigger_level TEXT NOT NULL,
      energized INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      source_alarm_id TEXT,
      title TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      assignee_id TEXT NOT NULL,
      due_at TEXT
    );

    CREATE TABLE IF NOT EXISTS commissioning (
      device_id TEXT PRIMARY KEY,
      device_discovered INTEGER NOT NULL,
      register_map_verified INTEGER NOT NULL,
      inputs_verified INTEGER NOT NULL,
      clock_synchronized INTEGER NOT NULL,
      alarms_and_relays_verified INTEGER NOT NULL,
      initial_backup_created INTEGER NOT NULL,
      history_verified INTEGER NOT NULL,
      accepted_for_production INTEGER NOT NULL,
      checks TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS configuration_snapshots (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      checksum TEXT,
      payload TEXT
    );

    CREATE TABLE IF NOT EXISTS log_files (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  sqlite.close();

  const db = getDb();

  // Check if device CAM5-01 is seeded
  const existingDevice = await db.select().from(schema.devices).where(eq(schema.devices.id, "CAM5-01")).get();
  if (!existingDevice) {
    await db.insert(schema.devices).values({
      id: "CAM5-01",
      assetId: "MCC-01",
      model: "IntelliSAW CAM-5",
      serialNumber: "CAM5-2026-0811",
      firmwareVersion: "2.4.1",
      dataVersion: 1,
      capabilities: JSON.stringify({
        temperatureInputs: 12,
        partialDischargeInputs: 4,
        humidityInputs: 8,
        relayOutputs: 6,
      }),
      connection: JSON.stringify({
        protocol: "modbus_tcp",
        host: "192.168.10.42",
        port: 502,
        unitId: 1,
        pollIntervalMs: 2000,
        timeoutMs: 1000,
        retries: 2,
        registerConvention: "native",
      }),
      network: JSON.stringify({
        address: "192.168.10.40",
        subnet: "255.255.255.0",
        gateway: "192.168.10.1",
        dns: "8.8.8.8",
        mac: "00:1B:44:11:3A:B7",
        link: "up",
      }),
      lastSeenAt: new Date().toISOString(),
    }).run();
  }

  // Seed registerCatalog
  const registerCount = await db.select().from(schema.registerCatalog).all();
  if (registerCount.length === 0) {
    for (const reg of cam5RegisterCatalog) {
      const scaleNum = parseFloat(reg.scale.replace("×", "").replace(" approx.", "")) || 1;
      const errCode = reg.errorCode === "0x8000" ? 0x8000 : 0xffff;
      await db.insert(schema.registerCatalog).values({
        nativeRegister: reg.register,
        humanReference: reg.reference,
        description: reg.description,
        functionCode: 3,
        dataType: reg.dataType === "Int16" ? "int16" : "uint16",
        scale: scaleNum,
        unit: reg.unit,
        errorCode: errCode,
      }).run();
    }
  }

  // Seed channels
  const channelCount = await db.select().from(schema.channels).all();
  if (channelCount.length === 0) {
    for (const ch of cam5OperationalChannels) {
      await db.insert(schema.channels).values({
        id: ch.id,
        deviceId: "CAM5-01",
        sourceId: ch.sourceId,
        enabled: ch.configured,
        label: ch.label,
        location: ch.zone,
        metric: ch.metric,
        nativeRegister: ch.nativeRegister,
        warningThreshold: ch.warningDefault,
        alarmThreshold: ch.criticalDefault,
        recoveryDeadband: 2.0,
        activationSamples: 3,
        recoverySamples: 3,
        staleAfterSeconds: 30,
      }).run();
    }
  }

  // Seed inputAssignments
  const inputCount = await db.select().from(schema.inputAssignments).all();
  if (inputCount.length === 0) {
    for (const inp of cam5InputInventory) {
      const type = inp.kind === "Temperatura SAW" ? "saw_temperature" : inp.kind === "Interfaz UHF" ? "uhf" : "humidity";
      await db.insert(schema.inputAssignments).values({
        id: inp.id,
        deviceId: "CAM5-01",
        type,
        enabled: inp.enabled,
        location: inp.location,
        calibrationCode: inp.calibration,
        signalQuality: inp.signal.includes("Buena") || inp.signal.includes("línea") ? "good" : inp.signal.includes("Media") ? "marginal" : "unknown",
      }).run();
    }
  }

  // Seed relays
  const relayCount = await db.select().from(schema.relays).all();
  if (relayCount.length === 0) {
    for (const r of cam5RelayDefaults) {
      await db.insert(schema.relays).values({
        relay: r.id,
        deviceId: "CAM5-01",
        name: r.name,
        enabled: true,
        sources: JSON.stringify([r.source]),
        triggerLevel: r.level === "Alarma" ? "critical" : "warning",
        energized: r.state === "Activo",
      }).run();
    }
  }

  // Seed commissioning
  const commCount = await db.select().from(schema.commissioning).all();
  if (commCount.length === 0) {
    await db.insert(schema.commissioning).values({
      deviceId: "CAM5-01",
      deviceDiscovered: true,
      registerMapVerified: true,
      inputsVerified: true,
      clockSynchronized: true,
      alarmsAndRelaysVerified: true,
      initialBackupCreated: true,
      historyVerified: true,
      acceptedForProduction: false,
      checks: JSON.stringify([
        { id: "DISCOVERY", status: "passed", checkedAt: new Date().toISOString(), checkedBy: "Sistema", detail: "Serie CAM5-2026-0811 identificada." },
        { id: "REGISTER_MAP", status: "passed", checkedAt: new Date().toISOString(), checkedBy: "Sistema", detail: "105 registros validados." },
        { id: "INPUTS", status: "passed", checkedAt: new Date().toISOString(), checkedBy: "Sistema", detail: "24 entradas físicas revisadas." },
        { id: "CLOCK_SYNC", status: "passed", checkedAt: new Date().toISOString(), checkedBy: "Sistema", detail: "NTP configurado." },
        { id: "ALARMS_RELAYS", status: "passed", checkedAt: new Date().toISOString(), checkedBy: "Sistema", detail: "Matriz de relés probada." },
        { id: "BACKUP", status: "passed", checkedAt: new Date().toISOString(), checkedBy: "Sistema", detail: "Respaldo inicial guardado." },
        { id: "HISTORY_24H", status: "passed", checkedAt: new Date().toISOString(), checkedBy: "Sistema", detail: "24 horas de prueba continuas." },
        { id: "PRODUCTION_ACCEPTANCE", status: "pending", detail: "Pendiente firma operacional." },
      ]),
    }).run();
  }

  // Seed alarms
  const alarmCount = await db.select().from(schema.alarms).all();
  if (alarmCount.length === 0) {
    const initialAlarms = [
      { id: "AL-260811-031", assetId: "MCC-01", channelId: "PD1", title: "Aceleración de descarga parcial", severity: "critical", status: "open", triggerValue: 72, threshold: 60, consecutiveSamples: 3, openedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(), note: "Monitoreo UHF detecta Phi 2.8x" },
      { id: "AL-260811-028", assetId: "MCC-01", channelId: "T01", title: "Diferencial térmico elevado", severity: "warning", status: "open", triggerValue: 68.4, threshold: 65, consecutiveSamples: 3, openedAt: new Date(Date.now() - 34 * 60 * 1000).toISOString(), note: "T01 Barra L1 vs L2/L3" },
      { id: "AL-260811-019", assetId: "MCC-01", channelId: "H01", title: "Humedad sobre umbral", severity: "warning", status: "open", triggerValue: 78, threshold: 75, consecutiveSamples: 3, openedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), note: "H01 Ambiente cabina" },
      { id: "AL-260810-104", assetId: "MCC-01", channelId: "SYS", title: "Sincronización recuperada", severity: "info", status: "closed", triggerValue: 0, threshold: 0, consecutiveSamples: 1, openedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), acknowledgedAt: new Date(Date.now() - 23 * 3600 * 1000).toISOString(), acknowledgedBy: "Felipe Soto", closedAt: new Date(Date.now() - 22 * 3600 * 1000).toISOString(), note: "Gateway CAM5-GW-01 reconectado" },
    ];
    for (const a of initialAlarms) {
      await db.insert(schema.alarms).values(a).run();
    }
  }

  // Seed workOrders
  const woCount = await db.select().from(schema.workOrders).all();
  if (woCount.length === 0) {
    const initialWorkOrders = [
      { id: "OT-260811-018", sourceAlarmId: "AL-260811-031", title: "Diagnóstico de descarga parcial", priority: "critical", status: "in_progress", assigneeId: "Emerson Allende", dueAt: new Date(Date.now() + 4 * 3600 * 1000).toISOString() },
      { id: "OT-260811-017", sourceAlarmId: "AL-260811-028", title: "Inspección termográfica dirigida", priority: "high", status: "pending", dueAt: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(), assigneeId: "Paula Rojas" },
      { id: "OT-260810-014", sourceAlarmId: "AL-260811-019", title: "Control de humedad en cabina", priority: "high", status: "pending", dueAt: new Date(Date.now() + 11 * 24 * 3600 * 1000).toISOString(), assigneeId: "Felipe Soto" },
      { id: "OT-260731-009", title: "Verificación mensual de gateway", priority: "normal", status: "completed", assigneeId: "Felipe Soto", dueAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString() },
    ];
    for (const wo of initialWorkOrders) {
      await db.insert(schema.workOrders).values(wo).run();
    }
  }

  // Seed initial telemetryReadings
  const telemetryCount = await db.select().from(schema.telemetryReadings).all();
  if (telemetryCount.length === 0) {
    const now = new Date().toISOString();
    let seq = 1;
    for (const ch of cam5OperationalChannels) {
      if (!ch.configured) continue;
      const numVal = parseFloat(ch.value);
      const isNum = !isNaN(numVal);
      await db.insert(schema.telemetryReadings).values({
        channelId: ch.id,
        sourceId: ch.sourceId,
        assetId: "MCC-01",
        nativeRegister: ch.nativeRegister,
        value: isNum ? numVal : null,
        rawValue: isNum ? (ch.metric === "temperature" ? numVal * 10 : numVal) : null,
        unit: ch.unit,
        severity: ch.state,
        quality: ch.configured ? "good" : "disabled",
        qualityFlags: JSON.stringify([]),
        sourceTimestamp: now,
        receivedAt: now,
        sequence: seq++,
      }).run();
    }
  }

  // Seed configurationSnapshots
  const snapCount = await db.select().from(schema.configurationSnapshots).all();
  if (snapCount.length === 0) {
    await db.insert(schema.configurationSnapshots).values({
      id: "SNAP-001",
      deviceId: "CAM5-01",
      version: 1,
      status: "deployed",
      createdAt: new Date().toISOString(),
      createdBy: "Emerson Allende",
      checksum: "a1b2c3d4e5f6",
      payload: JSON.stringify({ assetId: "MCC-01", channelCount: 32 }),
    }).run();
  }

  // Seed logFiles
  const logCount = await db.select().from(schema.logFiles).all();
  if (logCount.length === 0) {
    await db.insert(schema.logFiles).values({
      id: "LOG-001",
      deviceId: "CAM5-01",
      name: "system-2026-08-11.log",
      size: 1024 * 128,
      createdAt: new Date().toISOString(),
    }).run();
  }
}

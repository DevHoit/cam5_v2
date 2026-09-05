import { and, eq, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { cam5InputInventory, cam5OperationalChannels, cam5RegisterCatalog, cam5RelayDefaults } from "../app/cam5-model";
import { PORTAL_PERMISSIONS, PORTAL_ROLES } from "./access-control";
import { hashPassword } from "./auth";
import { closeDb, getDb, type Cam5Database } from "./index";
import { loadDatabaseEnvironment } from "./load-env";
import {
  alarmRules,
  assets,
  authIdentities,
  channels,
  commissioningItems,
  clients,
  deviceModels,
  devices,
  gateways,
  permissions,
  physicalInputs,
  readingProfileRanges,
  readingProfiles,
  registerDefinitions,
  relayConfigurations,
  reportTemplates,
  rolePermissions,
  roles,
  sites,
  userClientAssignments,
  userRoleAssignments,
  users,
} from "./schema";

type RegisterMetric = typeof registerDefinitions.$inferInsert.metric;
type InputKind = typeof physicalInputs.$inferInsert.kind;
type ChannelMetric = typeof channels.$inferInsert.metric;

function registerMetric(description: string): RegisterMetric {
  if (description.startsWith("Temperatura ambiente")) return "ambient_temperature";
  if (description.startsWith("Temperatura")) return "temperature";
  if (description.startsWith("Humedad")) return "humidity";
  if (/^SD\d Total/.test(description) || description.startsWith("Superficial")) return "surface_discharge";
  if (/^PD\d Total/.test(description) || description.startsWith("Interna")) return "partial_discharge";
  if (description.startsWith("Ruido")) return "noise";
  if (description.includes("conteo")) return "event_count";
  if (description.startsWith("Alpha")) return "alpha";
  if (description.startsWith("Beta")) return "beta";
  if (description.startsWith("Phi")) return "phi";
  return "system";
}

function inputKind(kind: (typeof cam5InputInventory)[number]["kind"]): InputKind {
  if (kind === "Temperatura SAW") return "temperature_saw";
  if (kind === "Interfaz UHF") return "uhf";
  return "humidity";
}

function channelMetric(metric: (typeof cam5OperationalChannels)[number]["metric"]): ChannelMetric {
  if (metric === "ambient") return "ambient_temperature";
  if (metric === "humidity") return "humidity";
  if (metric === "pd") return "partial_discharge";
  if (metric === "sd") return "surface_discharge";
  return "temperature";
}

function portNumber(code: string): number {
  const parsed = Number.parseInt(code.replace(/\D/g, ""), 10);
  if (!Number.isFinite(parsed)) throw new Error(`Código de entrada inválido: ${code}`);
  return parsed;
}

function physicalInputCode(sourceId: string): string {
  return sourceId.startsWith("TEMP-") ? `T${sourceId.slice(5)}` : sourceId;
}

export async function seedCam5Database(
  db: Cam5Database,
  options: {
    adminEmail?: string;
    adminName?: string;
    adminPassword?: string;
    clientCode?: string;
    clientName?: string;
    log?: boolean;
  } = {},
) {
  await db.transaction(async (tx) => {
    const clientCode = options.clientCode ?? process.env.CAM5_CLIENT_CODE ?? "CLIENTE-PRINCIPAL";
    const clientName = options.clientName ?? process.env.CAM5_CLIENT_NAME ?? "Cliente principal";
    await tx.insert(clients).values({
      code: clientCode,
      name: clientName,
    }).onConflictDoUpdate({
      target: clients.code,
      set: { name: clientName, active: true, updatedAt: new Date() },
    });
    const [client] = await tx.select().from(clients).where(eq(clients.code, clientCode)).limit(1);
    if (!client) throw new Error("No fue posible crear el cliente inicial.");

    await tx.insert(sites).values({
      clientId: client.id,
      code: "SITE-NORTE",
      name: "Subestación Norte",
      description: "Primera ubicación productiva HoitLive Core",
      timezone: "America/Santiago",
    }).onConflictDoUpdate({
      target: [sites.clientId, sites.code],
      set: { name: "Subestación Norte", timezone: "America/Santiago", active: true, updatedAt: new Date() },
    });
    const [site] = await tx.select().from(sites).where(and(eq(sites.clientId, client.id), eq(sites.code, "SITE-NORTE"))).limit(1);
    if (!site) throw new Error("No fue posible crear la ubicación inicial.");

    await tx.insert(assets).values({
      siteId: site.id,
      code: "MCC-01",
      name: "Alimentador Norte",
      area: "Cabina instrumentada",
      nominalVoltageKv: "13.8",
      state: "offline",
    }).onConflictDoUpdate({
      target: [assets.siteId, assets.code],
      set: { name: "Alimentador Norte", area: "Cabina instrumentada", nominalVoltageKv: "13.8", updatedAt: new Date() },
    });
    const [asset] = await tx.select().from(assets).where(and(eq(assets.siteId, site.id), eq(assets.code, "MCC-01"))).limit(1);
    if (!asset) throw new Error("No fue posible crear el activo inicial.");

    await tx.insert(gateways).values({
      siteId: site.id,
      code: "CAM5-GW-01",
      name: "Gateway industrial CAM5",
      state: "pending",
      metadata: { connectionState: "awaiting_backend" },
    }).onConflictDoUpdate({
      target: [gateways.siteId, gateways.code],
      set: { name: "Gateway industrial CAM5", updatedAt: new Date() },
    });
    const [gateway] = await tx.select().from(gateways).where(and(eq(gateways.siteId, site.id), eq(gateways.code, "CAM5-GW-01"))).limit(1);
    if (!gateway) throw new Error("No fue posible crear el gateway inicial.");

    await tx.insert(readingProfiles).values({
      key: "cam5-balanced-v1",
      name: "CAM5 equilibrado",
      description: "Perfil inicial: variables operativas cada 2 s y diagnóstico en ciclos más lentos.",
      staleAfterSeconds: 30,
      rawRetentionDays: 30,
      aggregateRetentionDays: 1825,
    }).onConflictDoUpdate({
      target: readingProfiles.key,
      set: { name: "CAM5 equilibrado", staleAfterSeconds: 30, rawRetentionDays: 30, aggregateRetentionDays: 1825, enabled: true, updatedAt: new Date() },
    });
    const [profile] = await tx.select().from(readingProfiles).where(eq(readingProfiles.key, "cam5-balanced-v1")).limit(1);
    if (!profile) throw new Error("No fue posible crear el perfil de lectura.");

    const profileRanges = [
      { name: "Temperatura y ambiente", startRegister: 418, endRegister: 445, intervalMs: 2_000, priority: 10 },
      { name: "Totales UHF", startRegister: 446, endRegister: 453, intervalMs: 2_000, priority: 20 },
      { name: "Sistema y diagnóstico UHF", startRegister: 454, endRegister: 490, intervalMs: 30_000, priority: 30 },
      { name: "Conteos y tendencias", startRegister: 491, endRegister: 522, intervalMs: 10_000, priority: 40 },
    ];
    for (const range of profileRanges) {
      await tx.insert(readingProfileRanges).values({ profileId: profile.id, functionCode: 3, enabled: true, ...range }).onConflictDoUpdate({
        target: [readingProfileRanges.profileId, readingProfileRanges.name],
        set: { startRegister: range.startRegister, endRegister: range.endRegister, intervalMs: range.intervalMs, priority: range.priority, functionCode: 3, enabled: true },
      });
    }

    await tx.insert(deviceModels).values({
      code: "CAM5-TPH-XDCW",
      manufacturer: "IntelliSAW",
      name: "CAM5 TPH XDCW",
      registerMapVersion: "R1.6",
      capabilities: { temperatureInputs: 12, uhfInputs: 4, humidityInputs: 8, relayOutputs: 6 },
    }).onConflictDoUpdate({
      target: deviceModels.code,
      set: { registerMapVersion: "R1.6", capabilities: { temperatureInputs: 12, uhfInputs: 4, humidityInputs: 8, relayOutputs: 6 } },
    });
    const [model] = await tx.select().from(deviceModels).where(eq(deviceModels.code, "CAM5-TPH-XDCW")).limit(1);
    if (!model) throw new Error("No fue posible crear el modelo CAM5.");

    await tx.insert(devices).values({
      assetId: asset.id,
      gatewayId: gateway.id,
      modelId: model.id,
      readingProfileId: profile.id,
      code: "CAM5-CTRL-01",
      name: "CAM5 Alimentador Norte",
      state: "commissioning",
      host: "192.168.10.42",
      port: 502,
      unitId: 1,
      timeoutMs: 1000,
      retries: 2,
    }).onConflictDoUpdate({
      target: [devices.gatewayId, devices.unitId],
      set: { assetId: asset.id, modelId: model.id, readingProfileId: profile.id, code: "CAM5-CTRL-01", updatedAt: new Date() },
    });
    const [device] = await tx.select().from(devices).where(and(eq(devices.gatewayId, gateway.id), eq(devices.unitId, 1))).limit(1);
    if (!device) throw new Error("No fue posible crear el equipo CAM5.");

    for (const definition of cam5RegisterCatalog) {
      const approximateScale = definition.scale.includes("aprox.");
      await tx.insert(registerDefinitions).values({
        modelId: model.id,
        nativeRegister: definition.register,
        humanReference: definition.reference,
        name: definition.description,
        registerGroup: definition.group,
        metric: registerMetric(definition.description),
        dataType: definition.dataType === "Int16" ? "int16" : "uint16",
        scaleFactor: definition.scale === "0.1" ? "0.1" : "1",
        scaleNote: approximateScale ? definition.scale : null,
        unit: definition.unit,
        errorRawValue: Number.parseInt(definition.errorCode, 16),
        minimumValue: definition.minimum,
        maximumValue: definition.maximum,
        writable: false,
      }).onConflictDoUpdate({
        target: [registerDefinitions.modelId, registerDefinitions.nativeRegister],
        set: {
          humanReference: definition.reference,
          name: definition.description,
          registerGroup: definition.group,
          metric: registerMetric(definition.description),
          dataType: definition.dataType === "Int16" ? "int16" : "uint16",
          scaleFactor: definition.scale === "0.1" ? "0.1" : "1",
          scaleNote: approximateScale ? definition.scale : null,
          unit: definition.unit,
          errorRawValue: Number.parseInt(definition.errorCode, 16),
          minimumValue: definition.minimum,
          maximumValue: definition.maximum,
        },
      });
    }
    const registerRows = await tx.select().from(registerDefinitions).where(eq(registerDefinitions.modelId, model.id));
    if (registerRows.length !== 105) throw new Error(`El mapa CAM5 debe contener 105 registros; se encontraron ${registerRows.length}.`);
    const registersByNative = new Map(registerRows.map((register) => [register.nativeRegister, register]));

    for (const input of cam5InputInventory) {
      const band = input.assignment.match(/(\d+) MHz/)?.[1];
      const antenna = input.assignment.match(/Antena (\d+)/)?.[1];
      const humidityIndex = input.kind === "Humedad" ? portNumber(input.id) - 1 : null;
      await tx.insert(physicalInputs).values({
        deviceId: device.id,
        code: input.id,
        kind: inputKind(input.kind),
        portNumber: portNumber(input.id),
        enabled: input.enabled,
        assignment: input.assignment,
        zone: input.location,
        calibrationCode: input.calibration.startsWith("Código ") ? input.calibration.slice(7) : null,
        frequencyBand: band ? `${band} MHz` : null,
        antennaPort: antenna ? `Antena ${antenna}` : null,
        humidityIndex: humidityIndex === null ? null : String(humidityIndex),
        metadata: { registers: input.register, calibrationState: input.calibration, signalState: input.signal },
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [physicalInputs.deviceId, physicalInputs.code],
        set: {
          enabled: input.enabled,
          assignment: input.assignment,
          zone: input.location,
          calibrationCode: input.calibration.startsWith("Código ") ? input.calibration.slice(7) : null,
          frequencyBand: band ? `${band} MHz` : null,
          antennaPort: antenna ? `Antena ${antenna}` : null,
          humidityIndex: humidityIndex === null ? null : String(humidityIndex),
          metadata: { registers: input.register, calibrationState: input.calibration, signalState: input.signal },
          updatedAt: new Date(),
        },
      });
    }
    const inputRows = await tx.select().from(physicalInputs).where(eq(physicalInputs.deviceId, device.id));
    if (inputRows.length !== 24) throw new Error(`El CAM5 debe contener 24 entradas; se encontraron ${inputRows.length}.`);
    const inputsByCode = new Map(inputRows.map((input) => [input.code, input]));

    for (const [displayOrder, channel] of cam5OperationalChannels.entries()) {
      const register = registersByNative.get(channel.nativeRegister);
      const input = inputsByCode.get(physicalInputCode(channel.sourceId));
      if (!register) throw new Error(`No existe el registro ${channel.nativeRegister} para ${channel.id}.`);
      if (!input) throw new Error(`No existe la entrada física ${channel.sourceId} para ${channel.id}.`);
      await tx.insert(channels).values({
        deviceId: device.id,
        assetId: asset.id,
        physicalInputId: input.id,
        registerDefinitionId: register.id,
        code: channel.id,
        name: channel.label,
        zone: channel.zone,
        metric: channelMetric(channel.metric),
        unit: channel.unit,
        enabled: channel.configured,
        displayOrder,
        metadata: { sourceId: channel.sourceId },
      }).onConflictDoUpdate({
        target: [channels.deviceId, channels.code],
        set: {
          physicalInputId: input.id,
          registerDefinitionId: register.id,
          name: channel.label,
          zone: channel.zone,
          metric: channelMetric(channel.metric),
          unit: channel.unit,
          enabled: channel.configured,
          displayOrder,
          updatedAt: new Date(),
        },
      });
    }
    const channelRows = await tx.select().from(channels).where(eq(channels.deviceId, device.id));
    if (channelRows.length !== 36) throw new Error(`El portal debe exponer 36 señales operativas; se encontraron ${channelRows.length}.`);
    const channelByCode = new Map(channelRows.map((channel) => [channel.code, channel]));

    for (const channel of cam5OperationalChannels) {
      const storedChannel = channelByCode.get(channel.id);
      if (!storedChannel) continue;
      await tx.insert(alarmRules).values({
        channelId: storedChannel.id,
        enabled: channel.configured,
        warningThreshold: String(channel.warningDefault),
        criticalThreshold: String(channel.criticalDefault),
        hysteresis: channel.metric === "humidity" ? "2" : channel.metric === "pd" || channel.metric === "sd" ? "5" : "1",
        activationSamples: 3,
        recoverySamples: 3,
        staleAfterSeconds: 30,
      }).onConflictDoUpdate({
        target: alarmRules.channelId,
        set: {
          enabled: channel.configured,
          warningThreshold: String(channel.warningDefault),
          criticalThreshold: String(channel.criticalDefault),
          activationSamples: 3,
          recoverySamples: 3,
          staleAfterSeconds: 30,
          updatedAt: new Date(),
        },
      });
    }

    for (const relay of cam5RelayDefaults) {
      await tx.insert(relayConfigurations).values({
        deviceId: device.id,
        relayNumber: relay.id,
        name: relay.name,
        sourceExpression: relay.source,
        severity: relay.level === "Advertencia" ? "warning" : "critical",
        enabled: relay.state === "Activo",
        failsafe: true,
      }).onConflictDoUpdate({
        target: [relayConfigurations.deviceId, relayConfigurations.relayNumber],
        set: { name: relay.name, sourceExpression: relay.source, severity: relay.level === "Advertencia" ? "warning" : "critical", enabled: relay.state === "Activo", updatedAt: new Date() },
      });
    }

    const checklist = [
      ["identity", "Identidad, serie, firmware y versión de datos confirmados"],
      ["registers", "Lectura FC03 completa del bloque 418–522"],
      ["inputs", "Bandas, códigos, antenas e índices contrastados en terreno"],
      ["clock", "Reloj y zona horaria sincronizados"],
      ["alarms", "Umbrales, persistencia e histéresis validados"],
      ["relays", "Seis salidas de relé probadas"],
      ["backup", "Respaldo inicial de configuración almacenado"],
      ["stability", "Histórico y calidad verificados durante 24 horas"],
    ] as const;
    for (const [itemKey, label] of checklist) {
      await tx.insert(commissioningItems).values({ deviceId: device.id, itemKey, label, status: "pending" }).onConflictDoUpdate({
        target: [commissioningItems.deviceId, commissioningItems.itemKey],
        set: { label },
      });
    }

    const templates = [
      { key: "condition-summary", name: "Resumen de condición", description: "Estado, alarmas y evolución de variables críticas.", definition: { sections: ["summary", "alarms", "trends"] } },
      { key: "alarm-history", name: "Histórico de alarmas", description: "Eventos, reconocimientos, cierres y órdenes asociadas.", definition: { sections: ["alarms", "workflow", "audit"] } },
      { key: "commissioning", name: "Acta de puesta en marcha", description: "Evidencias y aceptación del equipo CAM5.", definition: { sections: ["device", "inputs", "registers", "checklist"] } },
    ];
    for (const template of templates) {
      await tx.insert(reportTemplates).values({ siteId: site.id, active: true, ...template }).onConflictDoUpdate({
        target: [reportTemplates.siteId, reportTemplates.key],
        set: { name: template.name, description: template.description, definition: template.definition, active: true, updatedAt: new Date() },
      });
    }

    for (const permission of PORTAL_PERMISSIONS) {
      await tx.insert(permissions).values(permission).onConflictDoUpdate({
        target: permissions.code,
        set: { module: permission.module, action: permission.action, description: permission.description },
      });
    }
    const permissionRows = await tx.select().from(permissions);
    const permissionByCode = new Map(permissionRows.map((permission) => [permission.code, permission]));

    for (const role of PORTAL_ROLES) {
      await tx.insert(roles).values({ key: role.key, name: role.name, description: role.description, isSystem: true }).onConflictDoUpdate({
        target: roles.key,
        set: { name: role.name, description: role.description, isSystem: true },
      });
      const [storedRole] = await tx.select().from(roles).where(eq(roles.key, role.key)).limit(1);
      if (!storedRole) throw new Error(`No fue posible crear el perfil ${role.name}.`);
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, storedRole.id));
      for (const permissionCode of role.permissions) {
        const permission = permissionByCode.get(permissionCode);
        if (!permission) throw new Error(`Permiso desconocido: ${permissionCode}.`);
        await tx.insert(rolePermissions).values({ roleId: storedRole.id, permissionId: permission.id }).onConflictDoNothing();
      }
    }

    const configuredAdminEmail = options.adminEmail === undefined ? process.env.CAM5_ADMIN_EMAIL : options.adminEmail;
    const adminEmail = configuredAdminEmail?.trim().toLowerCase();
    if (adminEmail) {
      const configuredAdminName = options.adminName === undefined ? process.env.CAM5_ADMIN_NAME : options.adminName;
      const configuredAdminPassword = options.adminPassword === undefined ? process.env.CAM5_ADMIN_PASSWORD : options.adminPassword;
      const adminName = configuredAdminName?.trim() || "Administrador CAM5";
      await tx.insert(users).values({ email: adminEmail, displayName: adminName, status: "active" }).onConflictDoNothing();
      const [admin] = await tx.select().from(users).where(sql`lower(${users.email}) = ${adminEmail}`).limit(1);
      const [adminRole] = await tx.select().from(roles).where(eq(roles.key, "administrator")).limit(1);
      if (!admin || !adminRole) throw new Error("No fue posible asignar el administrador inicial.");
      await tx.insert(userClientAssignments).values({ userId: admin.id, clientId: client.id, roleId: adminRole.id }).onConflictDoNothing();
      await tx.insert(userRoleAssignments).values({ userId: admin.id, roleId: adminRole.id, siteId: site.id }).onConflictDoNothing();
      if (configuredAdminPassword) {
        const passwordHash = await hashPassword(configuredAdminPassword);
        await tx.insert(authIdentities).values({
          userId: admin.id,
          provider: "local",
          providerSubject: adminEmail,
          passwordHash,
        }).onConflictDoUpdate({
          target: [authIdentities.provider, authIdentities.providerSubject],
          set: { userId: admin.id, passwordHash, updatedAt: new Date() },
        });
      }
    }
  });

  if (options.log !== false) console.log("Base CAM5 inicializada: 1 cliente, 1 sitio, 1 punto de medición, 1 gateway, 1 controlador CAM5, 24 entradas, 36 señales, 105 registros y 4 perfiles de portal.");
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  loadDatabaseEnvironment();
  seedCam5Database(getDb())
    .catch((error: unknown) => {
      console.error("No fue posible inicializar la base CAM5.", error);
      process.exitCode = 1;
    })
    .finally(closeDb);
}

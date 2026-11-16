import { and, eq, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { cam5RegisterCatalog } from "../app/cam5-model";
import { PORTAL_PERMISSIONS, PORTAL_ROLES } from "./access-control";
import { hashPassword } from "./auth";
import { provisionCam5Device } from "./cam5-provisioning";
import { closeDb, getDb, type Cam5Database } from "./index";
import { loadDatabaseEnvironment } from "./load-env";
import {
  assets,
  authIdentities,
  clients,
  deviceModels,
  devices,
  gateways,
  permissions,
  readingProfileRanges,
  readingProfiles,
  registerDefinitions,
  reportTemplates,
  rolePermissions,
  roles,
  sites,
  userClientAssignments,
  userRoleAssignments,
  users,
} from "./schema";

type RegisterMetric = typeof registerDefinitions.$inferInsert.metric;

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
    }).onConflictDoNothing({ target: clients.code });
    const [client] = await tx.select().from(clients).where(eq(clients.code, clientCode)).limit(1);
    if (!client) throw new Error("No fue posible crear el cliente inicial.");

    await tx.insert(sites).values({
      clientId: client.id,
      code: "SITE-NORTE",
      name: "Subestación Norte",
      description: "Primera ubicación productiva HoitLive Core",
      timezone: "America/Santiago",
    }).onConflictDoNothing({ target: [sites.clientId, sites.code] });
    const [site] = await tx.select().from(sites).where(and(eq(sites.clientId, client.id), eq(sites.code, "SITE-NORTE"))).limit(1);
    if (!site) throw new Error("No fue posible crear la ubicación inicial.");

    await tx.insert(assets).values({
      siteId: site.id,
      code: "MCC-01",
      name: "Alimentador Norte",
      area: "Cabina instrumentada",
      nominalVoltageKv: "13.8",
      state: "offline",
    }).onConflictDoNothing({ target: [assets.siteId, assets.code] });
    const [asset] = await tx.select().from(assets).where(and(eq(assets.siteId, site.id), eq(assets.code, "MCC-01"))).limit(1);
    if (!asset) throw new Error("No fue posible crear el activo inicial.");

    await tx.insert(gateways).values({
      siteId: site.id,
      code: "CAM5-GW-01",
      name: "Gateway industrial CAM5",
      state: "pending",
      metadata: { connectionState: "awaiting_backend" },
    }).onConflictDoNothing({ target: [gateways.siteId, gateways.code] });
    const [gateway] = await tx.select().from(gateways).where(and(eq(gateways.siteId, site.id), eq(gateways.code, "CAM5-GW-01"))).limit(1);
    if (!gateway) throw new Error("No fue posible crear el gateway inicial.");

    await tx.insert(readingProfiles).values({
      key: "cam5-balanced-v1",
      name: "CAM5 equilibrado",
      description: "Perfil equilibrado: lectura local rápida, persistencia operativa cada minuto y diagnóstico completo cada 5 minutos.",
      staleAfterSeconds: 180,
      storageIntervalSeconds: 60,
      heartbeatIntervalSeconds: 30,
      diagnosticIntervalSeconds: 300,
      rawRetentionDays: 7,
      aggregateRetentionDays: 1825,
    }).onConflictDoNothing({ target: readingProfiles.key });
    const [profile] = await tx.select().from(readingProfiles).where(eq(readingProfiles.key, "cam5-balanced-v1")).limit(1);
    if (!profile) throw new Error("No fue posible crear el perfil de lectura.");

    const profileRanges = [
      { name: "Temperatura y ambiente", startRegister: 418, endRegister: 445, intervalMs: 2_000, priority: 10 },
      { name: "Totales UHF", startRegister: 446, endRegister: 453, intervalMs: 2_000, priority: 20 },
      { name: "Sistema y diagnóstico UHF", startRegister: 454, endRegister: 490, intervalMs: 30_000, priority: 30 },
      { name: "Conteos y tendencias", startRegister: 491, endRegister: 522, intervalMs: 10_000, priority: 40 },
    ];
    for (const range of profileRanges) {
      await tx.insert(readingProfileRanges).values({ profileId: profile.id, functionCode: 3, enabled: true, ...range }).onConflictDoNothing({
        target: [readingProfileRanges.profileId, readingProfileRanges.name],
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
    }).onConflictDoNothing({ target: [devices.gatewayId, devices.code] });
    const [device] = await tx.select().from(devices).where(and(eq(devices.gatewayId, gateway.id), eq(devices.code, "CAM5-CTRL-01"))).limit(1);
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
    await provisionCam5Device(tx, { id: device.id, assetId: asset.id, modelId: model.id });

    const templates = [
      { key: "condition-summary", name: "Resumen de condición", description: "Estado, alarmas y evolución de variables críticas.", definition: { sections: ["summary", "alarms", "trends"] } },
      { key: "alarm-history", name: "Histórico de alarmas", description: "Eventos, reconocimientos, cierres y trazabilidad operativa.", definition: { sections: ["alarms", "workflow", "audit"] } },
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
        }).onConflictDoNothing({ target: [authIdentities.provider, authIdentities.providerSubject] });
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

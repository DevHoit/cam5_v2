import type { NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { listMaintenanceWindowsForSite, maintenanceWindowStatus } from "../../../../db/maintenance-window-service";
import { resolveOnCallUser } from "../../../../db/on-call-engine";
import {
  alarms,
  assets,
  devices,
  gateways,
  shifts,
  users,
} from "../../../../db/schema";
import { apiErrorResponse, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "overview.read");
    const now = new Date();

    const [alarmRows, gatewayRows, deviceRows, maintenanceRows, shiftRows] = await Promise.all([
      db.select({
        id: alarms.id,
        code: alarms.code,
        severity: alarms.severity,
        status: alarms.status,
        title: alarms.title,
        openedAt: alarms.openedAt,
        assetId: assets.id,
        assetCode: assets.code,
        assetName: assets.name,
      }).from(alarms)
        .innerJoin(assets, eq(assets.id, alarms.assetId))
        .where(and(
          eq(alarms.siteId, user.siteId),
          inArray(alarms.status, ["open", "acknowledged"]),
        ))
        .orderBy(desc(alarms.openedAt))
        .limit(50),
      db.select({
        id: gateways.id,
        code: gateways.code,
        name: gateways.name,
        state: gateways.state,
        lastSeenAt: gateways.lastSeenAt,
      }).from(gateways)
        .where(and(eq(gateways.siteId, user.siteId), eq(gateways.active, true)))
        .orderBy(gateways.code),
      db.select({
        id: devices.id,
        code: devices.code,
        name: devices.name,
        state: devices.state,
        lastReadAt: devices.lastReadAt,
        assetCode: assets.code,
        assetName: assets.name,
      }).from(devices)
        .innerJoin(assets, eq(assets.id, devices.assetId))
        .where(and(eq(assets.siteId, user.siteId), eq(devices.active, true)))
        .orderBy(devices.code),
      listMaintenanceWindowsForSite(db, { clientId: user.clientId, siteId: user.siteId }),
      db.select({
        id: shifts.id,
        name: shifts.name,
        timezone: shifts.timezone,
      }).from(shifts)
        .where(and(eq(shifts.clientId, user.clientId), eq(shifts.active, true)))
        .orderBy(shifts.name),
    ]);

    const onCall = await Promise.all(shiftRows.map(async (shift) => {
      const resolution = await resolveOnCallUser(db, shift.id, now);
      if (resolution.status !== "resolved") return {
        shiftId: shift.id,
        shiftName: shift.name,
        timezone: shift.timezone,
        status: resolution.status,
        user: null,
        priority: "priority" in resolution ? resolution.priority : null,
      };
      const [person] = await db.select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        phoneE164: users.phoneE164,
      }).from(users).where(eq(users.id, resolution.userId)).limit(1);
      return {
        shiftId: shift.id,
        shiftName: shift.name,
        timezone: shift.timezone,
        status: "resolved" as const,
        user: person ?? null,
        priority: resolution.priority,
      };
    }));

    const maintenance = maintenanceRows
      .map((window) => ({ ...window, status: maintenanceWindowStatus(window, now) }))
      .filter((window) => window.status === "active" || window.status === "scheduled")
      .map((window) => ({
        id: window.id,
        scopeType: window.scopeType,
        scopeId: window.scopeId,
        startsAt: window.startsAt.toISOString(),
        endsAt: window.endsAt.toISOString(),
        reason: window.reason,
        status: window.status,
      }));

    const critical = alarmRows.filter((alarm) => alarm.severity === "critical").length;
    const warning = alarmRows.filter((alarm) => alarm.severity === "warning").length;
    const unhealthyGateways = gatewayRows.filter((gateway) => gateway.state !== "online");
    const unhealthyDevices = deviceRows.filter((device) => !["online", "normal"].includes(device.state));

    return Response.json({
      generatedAt: now.toISOString(),
      site: {
        id: user.siteId,
        code: user.siteCode,
        name: user.siteName,
        clientId: user.clientId,
        clientName: user.clientName,
      },
      summary: {
        activeAlarms: alarmRows.length,
        critical,
        warning,
        unhealthyGateways: unhealthyGateways.length,
        unhealthyDevices: unhealthyDevices.length,
        activeMaintenance: maintenance.filter((item) => item.status === "active").length,
        unresolvedOnCall: onCall.filter((item) => item.status !== "resolved").length,
      },
      alarms: alarmRows.map((alarm) => ({
        ...alarm,
        openedAt: alarm.openedAt.toISOString(),
      })),
      gateways: gatewayRows.map((gateway) => ({
        ...gateway,
        lastSeenAt: gateway.lastSeenAt?.toISOString() ?? null,
      })),
      devices: deviceRows.map((device) => ({
        ...device,
        lastReadAt: device.lastReadAt?.toISOString() ?? null,
      })),
      maintenance,
      onCall,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

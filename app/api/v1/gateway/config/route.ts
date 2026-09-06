import type { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { alarmRules, assets, channels, configurationSnapshots, devices, readingProfileRanges, readingProfiles, registerDefinitions } from "../../../../../db/schema";
import { apiErrorResponse } from "../../_lib/auth";
import { requireGatewayCredential } from "../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, credential } = await requireGatewayCredential(request);
    const deviceRows = await db.select({ device: devices }).from(devices)
      .innerJoin(assets, eq(assets.id, devices.assetId))
      .where(and(eq(devices.gatewayId, credential.gatewayId), eq(devices.active, true), eq(assets.active, true)))
      .orderBy(devices.unitId)
      .then((rows) => rows.map((row) => row.device));
    const payloadDevices = await Promise.all(deviceRows.map(async (device) => {
      const [ranges, registers, channelPolicies, revisions] = await Promise.all([
        device.readingProfileId ? db.select({
          name: readingProfileRanges.name,
          startRegister: readingProfileRanges.startRegister,
          endRegister: readingProfileRanges.endRegister,
          functionCode: readingProfileRanges.functionCode,
          intervalMs: readingProfileRanges.intervalMs,
          priority: readingProfileRanges.priority,
          enabled: readingProfileRanges.enabled,
        }).from(readingProfileRanges).where(eq(readingProfileRanges.profileId, device.readingProfileId)).orderBy(readingProfileRanges.priority) : [],
        db.select({
          register: registerDefinitions.nativeRegister,
          reference: registerDefinitions.humanReference,
          name: registerDefinitions.name,
          dataType: registerDefinitions.dataType,
          scaleFactor: registerDefinitions.scaleFactor,
          unit: registerDefinitions.unit,
          errorRawValue: registerDefinitions.errorRawValue,
          minimumValue: registerDefinitions.minimumValue,
          maximumValue: registerDefinitions.maximumValue,
        }).from(registerDefinitions).where(eq(registerDefinitions.modelId, device.modelId)).orderBy(registerDefinitions.nativeRegister),
        db.select({
          code: channels.code,
          name: channels.name,
          register: registerDefinitions.nativeRegister,
          metric: channels.metric,
          unit: channels.unit,
          enabled: channels.enabled,
          warningThreshold: alarmRules.warningThreshold,
          criticalThreshold: alarmRules.criticalThreshold,
          hysteresis: alarmRules.hysteresis,
          activationSamples: alarmRules.activationSamples,
          recoverySamples: alarmRules.recoverySamples,
          staleAfterSeconds: alarmRules.staleAfterSeconds,
        }).from(channels)
          .innerJoin(registerDefinitions, eq(registerDefinitions.id, channels.registerDefinitionId))
          .leftJoin(alarmRules, eq(alarmRules.channelId, channels.id))
          .where(eq(channels.deviceId, device.id))
          .orderBy(channels.displayOrder),
        db.select({ version: configurationSnapshots.version, checksumSha256: configurationSnapshots.checksumSha256, createdAt: configurationSnapshots.createdAt })
          .from(configurationSnapshots)
          .where(eq(configurationSnapshots.deviceId, device.id))
          .orderBy(desc(configurationSnapshots.version))
          .limit(1),
      ]);
      const [profile] = device.readingProfileId ? await db.select({ key: readingProfiles.key, staleAfterSeconds: readingProfiles.staleAfterSeconds }).from(readingProfiles).where(eq(readingProfiles.id, device.readingProfileId)).limit(1) : [];
      return {
        code: device.code,
        unitId: device.unitId,
        protocol: device.protocol,
        host: device.host,
        port: device.port,
        timeoutMs: device.timeoutMs,
        retries: device.retries,
        registerConvention: device.registerConvention,
        configuration: revisions[0] ? { version: revisions[0].version, checksumSha256: revisions[0].checksumSha256, createdAt: revisions[0].createdAt.toISOString() } : null,
        profile: profile ?? null,
        ranges,
        registers,
        channels: channelPolicies.map((channel) => ({
          ...channel,
          warningThreshold: channel.warningThreshold === null ? null : Number(channel.warningThreshold),
          criticalThreshold: channel.criticalThreshold === null ? null : Number(channel.criticalThreshold),
          hysteresis: channel.hysteresis === null ? 0 : Number(channel.hysteresis),
        })),
      };
    }));
    return Response.json({
      schemaVersion: "1.1",
      serverTime: new Date().toISOString(),
      ingestionUrl: "/api/v1/gateway/ingest",
      gateway: { code: credential.gatewayCode, name: credential.gatewayName },
      devices: payloadDevices,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

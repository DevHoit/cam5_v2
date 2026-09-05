import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { assets, devices, readingProfileRanges, readingProfiles, registerDefinitions } from "../../../../../db/schema";
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
      const [ranges, registers] = await Promise.all([
        device.readingProfileId ? db.select({
          name: readingProfileRanges.name,
          startRegister: readingProfileRanges.startRegister,
          endRegister: readingProfileRanges.endRegister,
          functionCode: readingProfileRanges.functionCode,
          intervalMs: readingProfileRanges.intervalMs,
          priority: readingProfileRanges.priority,
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
        profile: profile ?? null,
        ranges,
        registers,
      };
    }));
    return Response.json({
      schemaVersion: "1.0",
      serverTime: new Date().toISOString(),
      ingestionUrl: "/api/v1/gateway/ingest",
      gateway: { code: credential.gatewayCode, name: credential.gatewayName },
      devices: payloadDevices,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

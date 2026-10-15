import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { assets, devices } from "../../../../../db/schema";
import { apiErrorResponse, ApiError } from "../../_lib/auth";
import { requireGatewayCredential } from "../_lib/auth";
import { handleSpecGatewayConfig, hasSpecGatewayConfig } from "../_lib/config-spec-v1";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, credential } = await requireGatewayCredential(request);
    if (await hasSpecGatewayConfig(db, credential.gatewayId)) {
      return handleSpecGatewayConfig(db, credential);
    }

    const [device] = await db.select({ code: devices.code }).from(devices)
      .innerJoin(assets, eq(assets.id, devices.assetId))
      .where(and(eq(devices.gatewayId, credential.gatewayId), eq(devices.active, true), eq(assets.active, true)))
      .limit(1);

    if (device) {
      throw new ApiError(409, `El gateway tiene dispositivos asociados, pero no posee bindings de adquisición. Configura sus interfaces en el Gateway Agent/control plane antes de operar ${device.code}.`);
    }

    throw new ApiError(404, "El gateway no tiene dispositivos configurados.");
  } catch (error) {
    return apiErrorResponse(error);
  }
}

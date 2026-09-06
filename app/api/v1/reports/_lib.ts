import { and, eq } from "drizzle-orm";
import type { Cam5Database } from "../../../../db/index";
import type { AuthenticatedPortalUser } from "../../../../db/auth";
import { assets, userAssetScopes } from "../../../../db/schema";
import { ApiError } from "../_lib/auth";

export async function requireReportAsset(db: Cam5Database, user: AuthenticatedPortalUser, assetId: string) {
  if (!assetId) throw new ApiError(400, "Selecciona un punto de medición.");
  const [asset, scopes] = await Promise.all([
    db.select({ id: assets.id, code: assets.code, name: assets.name }).from(assets).where(and(eq(assets.id, assetId), eq(assets.siteId, user.siteId), eq(assets.active, true))).limit(1),
    db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id)),
  ]);
  if (!asset[0]) throw new ApiError(404, "El punto de medición no pertenece al sitio activo.");
  if (scopes.length && !scopes.some((scope) => scope.assetId === assetId)) throw new ApiError(403, "No tienes acceso al punto de medición indicado.");
  return asset[0];
}

export function parseReportPeriod(body: Record<string, unknown>) {
  const periodStart = new Date(String(body.periodStart ?? ""));
  const periodEnd = new Date(String(body.periodEnd ?? ""));
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodStart >= periodEnd) throw new ApiError(400, "El rango de fechas no es válido.");
  if (periodEnd.getTime() > Date.now() + 5 * 60_000) throw new ApiError(400, "El fin del periodo no puede estar en el futuro.");
  if (periodEnd.getTime() - periodStart.getTime() > 366 * 24 * 60 * 60 * 1000) throw new ApiError(400, "El periodo máximo permitido es de 366 días.");
  return { periodStart, periodEnd };
}

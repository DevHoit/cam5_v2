import type { NextRequest } from "next/server";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { assets, reportTemplates } from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requireApiSession } from "../../_lib/auth";
import { requireReportAsset } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "reports.read");
    const assetId = request.nextUrl.searchParams.get("assetId") || "";
    let assetType: string | null = null;
    if (assetId) {
      await requireReportAsset(db, user, assetId);
      const [asset] = await db.select({ assetType: assets.assetType }).from(assets).where(eq(assets.id, assetId)).limit(1);
      if (!asset) throw new ApiError(404, "El activo solicitado no existe.");
      assetType = asset.assetType;
    }

    const items = await db.select({
      id: reportTemplates.id,
      key: reportTemplates.key,
      name: reportTemplates.name,
      description: reportTemplates.description,
      definition: reportTemplates.definition,
      siteId: reportTemplates.siteId,
    }).from(reportTemplates)
      .where(and(eq(reportTemplates.active, true), or(isNull(reportTemplates.siteId), eq(reportTemplates.siteId, user.siteId))))
      .orderBy(asc(reportTemplates.name));
    const filtered = assetType === "cold_room"
      ? items.filter((item) => item.key === "cold-chain-summary")
      : assetType
        ? items.filter((item) => item.key !== "cold-chain-summary")
        : items;
    return Response.json({ items: filtered }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

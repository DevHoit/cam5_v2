import type { NextRequest } from "next/server";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { assets, deviceMetrics, devices, metricDefinitions, reportTemplates } from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requireApiSession } from "../../_lib/auth";
import { requireReportAsset } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "reports.read");
    const assetId = request.nextUrl.searchParams.get("assetId") || "";
    let assetType: string | null = null;
    let metricKeys: string[] = [];
    if (assetId) {
      await requireReportAsset(db, user, assetId);
      const [asset] = await db.select({ assetType: assets.assetType }).from(assets).where(eq(assets.id, assetId)).limit(1);
      if (!asset) throw new ApiError(404, "El activo solicitado no existe.");
      assetType = asset.assetType;
      const metrics = await db.select({ key: metricDefinitions.key }).from(deviceMetrics)
        .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
        .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
        .where(and(eq(devices.assetId, assetId), eq(devices.active, true), eq(deviceMetrics.enabled, true)));
      metricKeys = [...new Set(metrics.map((metric) => metric.key))];
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
    const capabilities = {
      coldChain: metricKeys.some((key) => key === "environment.temperature"),
      electrical: metricKeys.some((key) => key.startsWith("electrical.")),
      ats: metricKeys.some((key) => key.startsWith("ats.") || key.startsWith("dse.")),
    };
    const specialized = new Set<string>();
    if (capabilities.coldChain) specialized.add("cold-chain-summary");
    if (capabilities.electrical) specialized.add("electrical-summary");
    if (capabilities.ats) specialized.add("ats-summary");

    const filtered = assetId
      ? items.filter((item) => {
          if (item.key === "cold-chain-summary" || item.key === "electrical-summary" || item.key === "ats-summary") return specialized.has(item.key);
          // Legacy assets without normalized metrics (notably CAM-5) keep their
          // general report templates. Normalized assets may also expose general
          // templates in addition to every compatible capability report.
          return specialized.size === 0 || assetType !== null;
        })
      : items;
    return Response.json({ items: filtered }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

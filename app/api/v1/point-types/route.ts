import type { NextRequest } from "next/server";
import { asc } from "drizzle-orm";
import { POINT_AGGREGATIONS, POINT_SYSTEMS } from "../../../../db/point-types";
import { pointTypes } from "../../../../db/schema";
import { apiErrorResponse, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

/** Catálogo de tipos de punto con su sistema (Frío, Energía, Respaldo…) y su configuración por defecto. */
export async function GET(request: NextRequest) {
  try {
    const { db } = await requireApiSession(request, "assets.read");
    const rows = await db.select().from(pointTypes).orderBy(asc(pointTypes.displayOrder), asc(pointTypes.name));
    return Response.json({
      items: rows.map((row) => ({ ...row, systemName: POINT_SYSTEMS[row.system] })),
      systems: POINT_SYSTEMS,
      aggregations: POINT_AGGREGATIONS,
    }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

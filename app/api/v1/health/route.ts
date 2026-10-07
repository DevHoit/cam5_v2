import { sql } from "drizzle-orm";
import { getDb } from "../../../../db/index";

export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    await getDb().execute(sql`select 1 as ok`);
    return Response.json({
      service: "HoitLive Core",
      status: "ok",
      database: "ok",
      checked_at: checkedAt,
    }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("HoitLive Core health check failed", error);
    return Response.json({
      service: "HoitLive Core",
      status: "degraded",
      database: "unavailable",
      checked_at: checkedAt,
    }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

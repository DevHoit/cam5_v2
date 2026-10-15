import { sql } from "drizzle-orm";
import { getDb } from "../../../../db/index";

export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();
  const deployment = {
    environment: process.env.VERCEL_ENV ?? "local",
    revision: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  };
  try {
    await getDb().execute(sql`select 1 as ok`);
    return Response.json({
      service: "HoitLive Core",
      status: "ok",
      database: "ok",
      deployment,
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
      deployment,
      checked_at: checkedAt,
    }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

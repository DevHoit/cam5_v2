import type { NextRequest } from "next/server";
import { requireApiSession } from "../../_lib/auth";
import { latestMetricReadings, deviceMetrics, devices, assets } from "../../../../../db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "overview.read");
    const assetId = request.nextUrl.searchParams.get("assetId");

    const encoder = new TextEncoder();
    let isClosed = false;

    const stream = new ReadableStream({
      async start(controller) {
        request.signal.addEventListener("abort", () => {
          isClosed = true;
          controller.close();
        });

        const sendTelemetryUpdate = async () => {
          if (isClosed) return;
          try {
            const readings = await db
              .select({
                readingId: latestMetricReadings.readingId,
                recordedAt: latestMetricReadings.recordedAt,
                valueNumeric: latestMetricReadings.valueNumeric,
                valueBoolean: latestMetricReadings.valueBoolean,
                valueText: latestMetricReadings.valueText,
                quality: latestMetricReadings.quality,
                code: deviceMetrics.code,
                deviceId: deviceMetrics.deviceId,
              })
              .from(latestMetricReadings)
              .innerJoin(deviceMetrics, eq(deviceMetrics.id, latestMetricReadings.deviceMetricId))
              .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
              .innerJoin(assets, eq(assets.id, devices.assetId))
              .where(
                and(
                  eq(assets.siteId, user.siteId),
                  assetId ? eq(assets.id, assetId) : undefined,
                  eq(assets.active, true),
                )
              );

            const payload = JSON.stringify({
              timestamp: new Date().toISOString(),
              readings: readings.map((r) => ({
                ...r,
                recordedAt: r.recordedAt.toISOString(),
              })),
            });

            if (!isClosed) {
              controller.enqueue(encoder.encode(`event: telemetry\ndata: ${payload}\n\n`));
            }
          } catch {
            // Error handling during streaming
          }
        };

        // Initial burst
        await sendTelemetryUpdate();

        // Stream tick every 3 seconds
        const interval = setInterval(() => {
          if (isClosed) {
            clearInterval(interval);
            return;
          }
          void sendTelemetryUpdate();
        }, 3_000);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error iniciando streaming." }, { status: 500 });
  }
}

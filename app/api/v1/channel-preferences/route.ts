import type { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { assets, channels, userAssetScopes, userChannelPreferences } from "../../../../db/schema";
import { apiErrorResponse, ApiError, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

async function assertPointAccess(db: Awaited<ReturnType<typeof requireApiSession>>["db"], user: Awaited<ReturnType<typeof requireApiSession>>["user"], assetId: string) {
  const [asset] = await db.select({ id: assets.id }).from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.siteId, user.siteId), eq(assets.active, true)))
    .limit(1);
  if (!asset) throw new ApiError(404, "El punto de medición no existe en el sitio activo.");
  const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
  if (scopes.length && !scopes.some((scope) => scope.assetId === assetId)) throw new ApiError(403, "No tienes acceso al punto de medición indicado.");
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "condition.read");
    const body = await request.json().catch(() => null) as { assetId?: unknown; visibleChannelIds?: unknown } | null;
    if (!body || typeof body.assetId !== "string" || !body.assetId) throw new ApiError(400, "Selecciona un punto de medición.");
    if (!Array.isArray(body.visibleChannelIds) || body.visibleChannelIds.length > 100 || body.visibleChannelIds.some((id) => typeof id !== "string" || !id)) {
      throw new ApiError(400, "La selección de canales no es válida.");
    }
    const selectedIds = [...new Set(body.visibleChannelIds as string[])];
    await assertPointAccess(db, user, body.assetId);
    const pointChannels = await db.select({ id: channels.id, enabled: channels.enabled }).from(channels)
      .where(eq(channels.assetId, body.assetId))
      .orderBy(channels.displayOrder);
    const channelIds = pointChannels.map((channel) => channel.id);
    if (selectedIds.some((id) => !pointChannels.some((channel) => channel.id === id && channel.enabled))) {
      throw new ApiError(400, "Sólo puedes mostrar canales monitoreados del punto activo.");
    }

    await db.transaction(async (tx) => {
      if (channelIds.length) {
        await tx.delete(userChannelPreferences).where(and(
          eq(userChannelPreferences.userId, user.id),
          inArray(userChannelPreferences.channelId, channelIds),
        ));
        await tx.insert(userChannelPreferences).values(pointChannels.map((channel) => ({
          userId: user.id,
          channelId: channel.id,
          visible: channel.enabled && selectedIds.includes(channel.id),
          displayOrder: selectedIds.indexOf(channel.id) >= 0 ? selectedIds.indexOf(channel.id) : null,
          updatedAt: new Date(),
        })));
      }
    });

    return Response.json({
      ok: true,
      assetId: body.assetId,
      visibleChannelIds: selectedIds,
      visible: selectedIds.length,
      monitored: pointChannels.filter((channel) => channel.enabled).length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

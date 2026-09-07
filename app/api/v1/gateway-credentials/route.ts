import type { NextRequest } from "next/server";
import { and, count, desc, eq, gt, ilike, isNotNull, isNull, lte, or, type SQL } from "drizzle-orm";
import { createGatewayToken, gatewayTokenDisplayPrefix, hashGatewayToken } from "../../../../db/gateway-auth";
import { auditLogs, gatewayApiCredentials, gateways } from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

type CredentialStatus = "all" | "active" | "revoked" | "expired" | "unused";
const STATUSES: CredentialStatus[] = ["all", "active", "revoked", "expired", "unused"];

function serializeStatus(record: { revokedAt: Date | null; expiresAt: Date | null; lastUsedAt: Date | null }, now: Date) {
  if (record.revokedAt) return "revoked" as const;
  if (record.expiresAt && record.expiresAt <= now) return "expired" as const;
  if (!record.lastUsedAt) return "unused" as const;
  return "active" as const;
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.read");
    const { page, pageSize, offset } = parsePage(request);
    const gatewayId = request.nextUrl.searchParams.get("gatewayId") || "all";
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const requestedStatus = request.nextUrl.searchParams.get("status") || "all";
    const status = STATUSES.includes(requestedStatus as CredentialStatus) ? requestedStatus as CredentialStatus : "all";
    const now = new Date();
    const filters: SQL[] = [eq(gateways.siteId, user.siteId)];
    if (gatewayId !== "all") filters.push(eq(gatewayApiCredentials.gatewayId, gatewayId));
    if (q) filters.push(or(
      ilike(gatewayApiCredentials.name, `%${q}%`),
      ilike(gatewayApiCredentials.tokenPrefix, `%${q}%`),
      ilike(gateways.code, `%${q}%`),
      ilike(gateways.name, `%${q}%`),
    )!);
    if (status === "active") filters.push(and(isNull(gatewayApiCredentials.revokedAt), isNotNull(gatewayApiCredentials.lastUsedAt), or(isNull(gatewayApiCredentials.expiresAt), gt(gatewayApiCredentials.expiresAt, now)))!);
    if (status === "revoked") filters.push(isNotNull(gatewayApiCredentials.revokedAt));
    if (status === "expired") filters.push(and(isNull(gatewayApiCredentials.revokedAt), lte(gatewayApiCredentials.expiresAt, now))!);
    if (status === "unused") filters.push(and(isNull(gatewayApiCredentials.revokedAt), isNull(gatewayApiCredentials.lastUsedAt), or(isNull(gatewayApiCredentials.expiresAt), gt(gatewayApiCredentials.expiresAt, now)))!);
    const where = and(...filters)!;

    const [records, totalRows, gatewayRows, allCredentials] = await Promise.all([
      db.select({
        id: gatewayApiCredentials.id,
        name: gatewayApiCredentials.name,
        tokenPrefix: gatewayApiCredentials.tokenPrefix,
        expiresAt: gatewayApiCredentials.expiresAt,
        lastUsedAt: gatewayApiCredentials.lastUsedAt,
        revokedAt: gatewayApiCredentials.revokedAt,
        createdAt: gatewayApiCredentials.createdAt,
        gatewayId: gateways.id,
        gatewayCode: gateways.code,
        gatewayName: gateways.name,
      }).from(gatewayApiCredentials)
        .innerJoin(gateways, eq(gateways.id, gatewayApiCredentials.gatewayId))
        .where(where)
        .orderBy(desc(gatewayApiCredentials.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ value: count() }).from(gatewayApiCredentials)
        .innerJoin(gateways, eq(gateways.id, gatewayApiCredentials.gatewayId))
        .where(where),
      db.select({
        id: gateways.id,
        code: gateways.code,
        name: gateways.name,
        state: gateways.state,
        active: gateways.active,
        lastSeenAt: gateways.lastSeenAt,
        softwareVersion: gateways.softwareVersion,
        ipAddress: gateways.ipAddress,
      }).from(gateways).where(eq(gateways.siteId, user.siteId)).orderBy(gateways.code),
      db.select({
        gatewayId: gatewayApiCredentials.gatewayId,
        revokedAt: gatewayApiCredentials.revokedAt,
        expiresAt: gatewayApiCredentials.expiresAt,
        lastUsedAt: gatewayApiCredentials.lastUsedAt,
      }).from(gatewayApiCredentials)
        .innerJoin(gateways, eq(gateways.id, gatewayApiCredentials.gatewayId))
        .where(eq(gateways.siteId, user.siteId)),
    ]);

    const total = Number(totalRows[0]?.value ?? 0);
    const statusRows = allCredentials.map((credential) => ({ ...credential, status: serializeStatus(credential, now) }));
    return Response.json({
      gateways: gatewayRows.map((gateway) => ({
        ...gateway,
        lastSeenAt: gateway.lastSeenAt?.toISOString() ?? null,
        activeCredentials: statusRows.filter((credential) => credential.gatewayId === gateway.id && (credential.status === "active" || credential.status === "unused")).length,
      })),
      items: records.map((record) => ({
        id: record.id,
        name: record.name,
        tokenPrefix: `${record.tokenPrefix}…`,
        gateway: { id: record.gatewayId, code: record.gatewayCode, name: record.gatewayName },
        status: serializeStatus(record, now),
        expiresAt: record.expiresAt?.toISOString() ?? null,
        lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
        revokedAt: record.revokedAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      summary: {
        gateways: gatewayRows.length,
        onlineGateways: gatewayRows.filter((gateway) => gateway.state === "online").length,
        activeCredentials: statusRows.filter((credential) => credential.status === "active" || credential.status === "unused").length,
        usedCredentials: statusRows.filter((credential) => credential.lastUsedAt && (credential.status === "active")).length,
      },
      serverTime: now.toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.write");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const gatewayId = typeof body?.gatewayId === "string" ? body.gatewayId : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const validityDays = typeof body?.validityDays === "number" ? body.validityDays : Number(body?.validityDays);
    const rotateCredentialId = typeof body?.rotateCredentialId === "string" ? body.rotateCredentialId : null;
    if (!gatewayId) throw new ApiError(400, "Selecciona un gateway.");
    if (name.length < 3 || name.length > 120) throw new ApiError(400, "El nombre debe tener entre 3 y 120 caracteres.");
    if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 1825) throw new ApiError(400, "La vigencia debe estar entre 1 y 1825 días.");

    const token = createGatewayToken();
    const tokenPrefix = gatewayTokenDisplayPrefix(token);
    const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
    const metadata = requestMetadata(request);
    const created = await db.transaction(async (tx) => {
      const [gateway] = await tx.select({ id: gateways.id, code: gateways.code, name: gateways.name, active: gateways.active })
        .from(gateways)
        .where(and(eq(gateways.id, gatewayId), eq(gateways.siteId, user.siteId)))
        .limit(1);
      if (!gateway) throw new ApiError(404, "El gateway no pertenece al sitio activo.");
      if (!gateway.active) throw new ApiError(409, "Activa el gateway antes de crear una credencial.");

      let rotated: { id: string; name: string } | null = null;
      if (rotateCredentialId) {
        const [target] = await tx.select({ id: gatewayApiCredentials.id, name: gatewayApiCredentials.name, revokedAt: gatewayApiCredentials.revokedAt })
          .from(gatewayApiCredentials)
          .where(and(eq(gatewayApiCredentials.id, rotateCredentialId), eq(gatewayApiCredentials.gatewayId, gateway.id)))
          .limit(1);
        if (!target) throw new ApiError(404, "La credencial que deseas rotar no existe.");
        if (target.revokedAt) throw new ApiError(409, "La credencial seleccionada ya está revocada.");
        rotated = { id: target.id, name: target.name };
      } else {
        const [activeCount] = await tx.select({ value: count() }).from(gatewayApiCredentials).where(and(
          eq(gatewayApiCredentials.gatewayId, gateway.id),
          isNull(gatewayApiCredentials.revokedAt),
          or(isNull(gatewayApiCredentials.expiresAt), gt(gatewayApiCredentials.expiresAt, new Date())),
        ));
        if (Number(activeCount?.value ?? 0) >= 5) throw new ApiError(409, "El gateway ya tiene 5 credenciales activas. Revoca o rota una antes de crear otra.");
      }

      const [credential] = await tx.insert(gatewayApiCredentials).values({
        gatewayId: gateway.id,
        name,
        tokenPrefix,
        tokenHash: hashGatewayToken(token),
        expiresAt,
        createdBy: user.id,
      }).returning({ id: gatewayApiCredentials.id, createdAt: gatewayApiCredentials.createdAt });
      if (rotated) await tx.update(gatewayApiCredentials).set({ revokedAt: new Date() }).where(eq(gatewayApiCredentials.id, rotated.id));
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: rotated ? "gateway_credentials.rotate" : "gateway_credentials.create",
        resourceType: "gateway_api_credential",
        resourceId: credential.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: rotated ? { credentialId: rotated.id, name: rotated.name } : null,
        after: { gatewayId: gateway.id, gatewayCode: gateway.code, name, tokenPrefix, expiresAt: expiresAt.toISOString() },
      });
      return { credential, gateway, rotated };
    });

    return Response.json({
      credential: {
        id: created.credential.id,
        name,
        tokenPrefix: `${tokenPrefix}…`,
        gateway: { id: created.gateway.id, code: created.gateway.code, name: created.gateway.name },
        status: "unused",
        expiresAt: expiresAt.toISOString(),
        lastUsedAt: null,
        revokedAt: null,
        createdAt: created.credential.createdAt.toISOString(),
      },
      token,
      rotatedCredentialId: created.rotated?.id ?? null,
      endpoints: { configuration: "/api/v1/gateway/config", ingestion: "/api/v1/gateway/ingest" },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

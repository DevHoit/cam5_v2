import { eq } from "drizzle-orm";
import { reportRuns, siteReportSchedules, sites, userAssetScopes, userRoleAssignments, users, type SiteReportRecipient } from "../../../../db/schema";
import type { Cam5Database } from "../../../../db/index";
import { ApiError, type requireApiSession } from "../_lib/auth";
import type { SiteReportKind } from "../../../../db/site-report";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_RECIPIENTS = 20;

export function parseKind(value: unknown): SiteReportKind {
  if (value !== "weekly" && value !== "monthly") throw new ApiError(400, "El tipo de informe debe ser semanal o mensual.");
  return value;
}

export async function allowedAssets(db: Cam5Database, userId: string) {
  const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, userId));
  return scopes.map((scope) => scope.assetId);
}

/** Valida y normaliza los destinatarios: correo válido, sin repetidos, máximo 20. */
export function parseRecipients(value: unknown): SiteReportRecipient[] {
  if (!Array.isArray(value)) throw new ApiError(400, "Indica los destinatarios.");
  const seen = new Set<string>();
  const recipients: SiteReportRecipient[] = [];
  for (const item of value) {
    const raw = typeof item === "string" ? { email: item } : item as Record<string, unknown>;
    const email = typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : "";
    if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new ApiError(400, `El correo «${String(raw?.email ?? "")}» no es válido.`);
    if (seen.has(email)) continue;
    seen.add(email);
    recipients.push({ email, name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : null, userId: typeof raw.userId === "string" && UUID_PATTERN.test(raw.userId) ? raw.userId : null });
  }
  if (recipients.length > MAX_RECIPIENTS) throw new ApiError(400, `Puedes agregar hasta ${MAX_RECIPIENTS} destinatarios.`);
  return recipients;
}

export function parseHour(value: unknown, fallback = 8) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 23) throw new ApiError(400, "La hora de envío debe estar entre 0 y 23.");
  return value as number;
}

/** Usuarios con acceso al sitio, para sugerirlos como destinatarios. */
export async function siteUsers(db: Cam5Database, siteId: string) {
  const rows = await db.select({ id: users.id, email: users.email, name: users.displayName, status: users.status, platformStaff: users.platformStaff })
    .from(userRoleAssignments).innerJoin(users, eq(users.id, userRoleAssignments.userId)).where(eq(userRoleAssignments.siteId, siteId));
  return [...new Map(rows.filter((row) => row.status === "active" && !row.platformStaff).map((row) => [row.id, { id: row.id, email: row.email, name: row.name }])).values()];
}

export async function scheduleForSite(db: Cam5Database, id: string, siteId: string) {
  if (!UUID_PATTERN.test(id)) throw new ApiError(404, "La programación no existe.");
  const [row] = await db.select().from(siteReportSchedules).where(eq(siteReportSchedules.id, id)).limit(1);
  if (!row || row.siteId !== siteId) throw new ApiError(404, "La programación no existe.");
  return row;
}

export async function siteTimezone(db: Cam5Database, siteId: string) {
  const [site] = await db.select({ timezone: sites.timezone }).from(sites).where(eq(sites.id, siteId)).limit(1);
  return site?.timezone ?? "America/Santiago";
}

export async function loadSiteReportRun(db: Cam5Database, id: string, user: Awaited<ReturnType<typeof requireApiSession>>["user"]) {
  if (!UUID_PATTERN.test(id)) throw new ApiError(404, "El informe no existe.");
  const [row] = await db.select({ id: reportRuns.id, title: reportRuns.title, siteId: reportRuns.siteId, payload: reportRuns.payload, createdAt: reportRuns.createdAt }).from(reportRuns).where(eq(reportRuns.id, id)).limit(1);
  // Solo informes de un sitio al que el usuario tiene acceso.
  if (!row?.siteId || !user.sites.some((site) => site.id === row.siteId)) throw new ApiError(404, "El informe no existe.");
  return row;
}


export function serializeSchedule(row: typeof siteReportSchedules.$inferSelect, lastReportTitle?: string | null) {
  return {
    id: row.id, kind: row.kind, hour: row.hour, recipients: row.recipients, attachPdf: row.attachPdf, onlyIfFindings: row.onlyIfFindings, active: row.active,
    nextRunAt: row.nextRunAt?.toISOString() ?? null, lastRunAt: row.lastRunAt?.toISOString() ?? null, lastStatus: row.lastStatus, lastError: row.lastError, lastReportId: row.lastReportId, lastReportTitle: lastReportTitle ?? null,
  };
}


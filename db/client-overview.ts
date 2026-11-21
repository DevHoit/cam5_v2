import { and, asc, eq, inArray } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { sites } from "./schema";
import { loadSiteOverview, sortPoints, systemSummaries, type AttentionItem, type HealthIssue, type SitePoint, type SystemSummary } from "./site-overview";

/**
 * Vista del cliente: la operación de todos sus sitios en una pantalla. Reúne la vista de cada sitio
 * (mismos puntos, excepciones y salud de sensores) y agrega un resumen por sitio. Cada elemento lleva
 * su sitio, para que el portal pueda abrirlo cambiando de contexto.
 */

/** Tope de sitios por consulta: la vista recorre cada sitio y no debe crecer sin límite. */
export const CLIENT_OVERVIEW_MAX_SITES = 40;

export type SiteRef = { siteId: string; siteName: string };
export type ClientPoint = SitePoint & SiteRef;
export type ClientAttentionItem = AttentionItem & SiteRef;
export type ClientHealthIssue = HealthIssue & SiteRef;

export type ClientSiteSummary = {
  id: string;
  code: string;
  name: string;
  /** Peor estado del sitio: crítico, advertencia, sin datos o normal. */
  status: "critical" | "warning" | "offline" | "normal";
  total: number;
  normal: number;
  attention: number;
  offline: number;
  systems: SystemSummary[];
  /** Suma de la potencia de los puntos de energía (kW), si el sitio tiene. */
  demandKw: number | null;
  /** Cámara más cerca o más fuera de su rango. */
  worstCold: { pointId: string; pointName: string; value: number; unit: string | null; decimals: number; outOfRange: boolean } | null;
  healthIssues: number;
  lastReadAt: string | null;
};

export type ClientOverview = {
  serverTime: string;
  sites: ClientSiteSummary[];
  points: ClientPoint[];
  systems: SystemSummary[];
  attention: ClientAttentionItem[];
  health: ClientHealthIssue[];
  truncated: boolean;
};

const STATUS_ORDER: Record<ClientSiteSummary["status"], number> = { critical: 0, warning: 1, offline: 2, normal: 3 };
const SEVERITY_ORDER = { critical: 0, warning: 1, offline: 2, normal: 3 } as const;

export function summarizeSite(site: { id: string; code: string; name: string }, points: SitePoint[], systems: SystemSummary[], attentionItems: AttentionItem[], healthIssues: number): ClientSiteSummary {
  // Con observaciones: puntos con alarma o fuera de rango y también los que solo tienen una observación
  // (factor de potencia bajo, desbalance), igual que "Requiere atención".
  const offlineIds = new Set(points.filter((point) => point.status === "offline").map((point) => point.id));
  const observed = new Set([
    ...points.filter((point) => point.status === "warning" || point.status === "critical").map((point) => point.id),
    ...attentionItems.filter((item) => item.reason !== "offline").map((item) => item.pointId),
  ].filter((id) => !offlineIds.has(id)));
  const attention = observed.size;
  const offline = offlineIds.size;
  const energy = points.filter((point) => point.system === "energy" && point.status !== "offline" && point.condition?.value !== null && point.condition?.value !== undefined);
  const cold = points.filter((point) => point.system === "cold" && point.status !== "offline" && point.condition?.value !== null && point.condition?.value !== undefined)
    .sort((left, right) => (right.condition!.deviation ?? -99) - (left.condition!.deviation ?? -99));
  const worst = cold[0];
  const status: ClientSiteSummary["status"] = points.some((point) => point.status === "critical") || attentionItems.some((item) => item.severity === "critical") ? "critical"
    : points.length > 0 && offline === points.length ? "offline"
      : attention > 0 || offline > 0 ? "warning" : "normal";
  return {
    id: site.id,
    code: site.code,
    name: site.name,
    status,
    total: points.length,
    normal: points.length - attention - offline,
    attention,
    offline,
    systems,
    demandKw: energy.length ? Math.round(energy.reduce((total, point) => total + point.condition!.value!, 0) * 10) / 10 : null,
    worstCold: worst ? { pointId: worst.id, pointName: worst.name, value: worst.condition!.value!, unit: worst.condition!.unit, decimals: worst.condition!.decimals, outOfRange: worst.condition!.status === "out_of_range" } : null,
    healthIssues,
    lastReadAt: points.reduce<string | null>((latest, point) => point.lastReadAt && (!latest || point.lastReadAt > latest) ? point.lastReadAt : latest, null),
  };
}

export async function loadClientOverview(db: Cam5Database, siteIds: string[], allowedAssetIds: string[], now = new Date()): Promise<ClientOverview> {
  const rows = siteIds.length
    ? await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites)
      .where(and(inArray(sites.id, siteIds), eq(sites.active, true))).orderBy(asc(sites.name))
    : [];
  const selected = rows.slice(0, CLIENT_OVERVIEW_MAX_SITES);
  const perSite = [];
  // Uno a uno: cada vista de sitio ya hace varias consultas y así no se satura el pool de conexiones.
  for (const site of selected) perSite.push({ site, overview: await loadSiteOverview(db, site.id, allowedAssetIds, now) });

  const points = sortPoints(perSite.flatMap(({ site, overview }) => overview.points.map((point) => ({ ...point, siteId: site.id, siteName: site.name })))) as ClientPoint[];
  const attention = perSite.flatMap(({ site, overview }) => overview.attention.map((item) => ({ ...item, siteId: site.id, siteName: site.name })))
    .sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]);
  const health = perSite.flatMap(({ site, overview }) => overview.health.map((issue) => ({ ...issue, siteId: site.id, siteName: site.name })))
    .sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]);
  const summaries = perSite.map(({ site, overview }) => summarizeSite(site, overview.points, overview.systems, overview.attention, overview.health.length))
    .sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || left.name.localeCompare(right.name, "es"));

  return {
    serverTime: now.toISOString(),
    sites: summaries,
    points,
    systems: systemSummaries(points),
    attention,
    health,
    truncated: rows.length > selected.length,
  };
}

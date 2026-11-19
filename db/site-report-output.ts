import { and, eq, isNull, lte } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { appBaseUrl } from "./app-url";
import type { Cam5Executor } from "./cam5-provisioning";
import type { Cam5Database } from "./index";
import { nextCronRun } from "./report-engine";
import { reportRuns, reportTemplates, siteReportSchedules, sites, type SiteReportRecipient } from "./schema";
import { buildSiteReport, previousPeriod, type PointHealth, type SiteReport, type SiteReportKind } from "./site-report";

/**
 * Salidas de los informes de subestación: el registro del informe, el PDF, el correo y el envío programado.
 */
export const KIND_TITLE: Record<SiteReportKind, string> = { weekly: "Informe semanal de operación", monthly: "Informe mensual de condición" };
const HEALTH_LABEL: Record<PointHealth, string> = { good: "Bueno", watch: "Observar", action: "Requiere acción" };
const decimal = (value: number | null, digits = 1, unit = "") => value === null ? "—" : `${new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}${unit}`;

/** Genera el informe y lo guarda como un informe más de la biblioteca. */
export async function createSiteReportRun(db: Cam5Executor, input: { siteId: string; kind: SiteReportKind; periodStart: Date; periodEnd: Date; requestedBy?: string | null; allowedAssetIds?: string[]; now?: Date }) {
  const report = await buildSiteReport(db, input);
  const [template] = await db.select({ id: reportTemplates.id }).from(reportTemplates)
    .where(and(eq(reportTemplates.key, input.kind === "weekly" ? "site_weekly" : "site_monthly"), isNull(reportTemplates.siteId))).limit(1);
  if (!template) throw new Error("Faltan las plantillas de informes de subestación (migración 0018).");
  const now = input.now ?? new Date();
  const [run] = await db.insert(reportRuns).values({
    templateId: template.id, siteId: input.siteId, kind: input.kind, requestedBy: input.requestedBy ?? null,
    title: `${KIND_TITLE[input.kind]} · ${report.site.name} · ${report.period.label}`,
    format: "pdf", status: "completed", periodStart: input.periodStart, periodEnd: input.periodEnd,
    payload: report as unknown as Record<string, unknown>, completedAt: now,
  }).returning({ id: reportRuns.id, title: reportRuns.title });
  return { id: run.id, title: run.title, report };
}

/** Texto apto para las fuentes estándar del PDF (WinAnsi): lo que no cabe se reemplaza. */
function pdfText(value: unknown) {
  return String(value ?? "—").replaceAll("→", "->").replaceAll("≥", ">=").replaceAll("≤", "<=").replaceAll("–", "-").replaceAll("—", "-")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "-");
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of pdfText(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else { if (line) lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

const INK = rgb(0.094, 0.094, 0.106), MUTED = rgb(0.443, 0.443, 0.478), LINE = rgb(0.894, 0.894, 0.906);
const TONES: Record<string, { bg: RGB; fg: RGB; line: RGB }> = {
  critical: { bg: rgb(0.996, 0.949, 0.949), fg: rgb(0.725, 0.11, 0.11), line: rgb(0.996, 0.792, 0.792) },
  warning: { bg: rgb(1, 0.984, 0.922), fg: rgb(0.706, 0.325, 0.035), line: rgb(0.992, 0.902, 0.541) },
  normal: { bg: rgb(0.925, 0.992, 0.961), fg: rgb(0.016, 0.471, 0.341), line: rgb(0.655, 0.953, 0.816) },
  neutral: { bg: rgb(0.957, 0.957, 0.961), fg: rgb(0.322, 0.322, 0.357), line: LINE },
};
const HEALTH_TONE: Record<PointHealth, string> = { action: "critical", watch: "warning", good: "normal" };
const PRIORITY: Record<string, { label: string; tone: string }> = { now: { label: "Este periodo", tone: "critical" }, next: { label: "Próxima visita", tone: "warning" }, watch: { label: "Observar", tone: "neutral" } };
const PHASE_COLORS: Record<string, RGB> = { L1: rgb(0.008, 0.518, 0.78), L2: rgb(0.851, 0.467, 0.024), L3: rgb(0.059, 0.463, 0.431) };

/** PDF A4 del informe (2 páginas en el mensual, 1–2 en el semanal). */
export async function siteReportPdf(report: SiteReport) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${KIND_TITLE[report.kind]} · ${report.site.name} · ${report.period.label}`);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 42, CW = W - M * 2;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = H - M; };
  const ensure = (height: number) => { if (y - height < M + 30) newPage(); };
  const write = (value: string, x: number, size: number, options: { font?: PDFFont; color?: RGB; width?: number; lineGap?: number } = {}) => {
    const font = options.font ?? regular;
    const lines = wrap(value, font, size, options.width ?? CW - (x - M));
    for (const line of lines) { page.drawText(line, { x, y: y - size, size, font, color: options.color ?? INK }); y -= size + (options.lineGap ?? 3); }
    return lines.length;
  };
  const heading = (value: string) => { ensure(40); y -= 10; write(value, M, 12, { font: bold }); y -= 4; };
  const box = (x: number, top: number, w: number, h: number, tone: string) => page.drawRectangle({ x, y: top - h, width: w, height: h, color: TONES[tone].bg, borderColor: TONES[tone].line, borderWidth: 0.8 });

  // Encabezado
  newPage();
  page.drawText(pdfText(`${KIND_TITLE[report.kind]} · ${report.period.label}`), { x: M, y: y - 9, size: 9, font: regular, color: MUTED });
  page.drawText(pdfText(report.client.name), { x: W - M - bold.widthOfTextAtSize(pdfText(report.client.name), 11), y: y - 10, size: 11, font: bold, color: rgb(0.118, 0.106, 0.294) });
  y -= 14;
  write(report.site.name, M, 22, { font: bold });
  write(`${report.kpis.totalPoints} puntos de medición · ${new Date(report.period.start).toLocaleDateString("es-CL", { timeZone: report.timezone })} al ${new Date(new Date(report.period.end).getTime() - 1).toLocaleDateString("es-CL", { timeZone: report.timezone })}`, M, 9, { color: MUTED });
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.4, color: INK });
  y -= 16;

  // Conclusión y KPI
  const conclusionTop = y;
  const leftW = CW * 0.55;
  box(M, conclusionTop, leftW, 92, report.conclusion.tone);
  y = conclusionTop - 10;
  write("Conclusión del periodo", M + 12, 8, { font: bold, color: TONES[report.conclusion.tone].fg });
  y -= 2;
  write(report.conclusion.title, M + 12, 12, { font: bold, width: leftW - 24 });
  y -= 2;
  write(report.conclusion.detail, M + 12, 8.5, { color: rgb(0.32, 0.32, 0.36), width: leftW - 24 });
  const kpis: Array<[string, string, string]> = [
    ["Puntos en buen estado", `${report.kpis.healthyPoints} / ${report.kpis.totalPoints}`, "índice de salud"],
    ["Alarmas", String(report.kpis.alarms), `${report.kpis.criticalAlarms} críticas · ${report.kpis.warningAlarms} advertencias`],
    ["Reconocimiento", report.kpis.mttaMinutes === null ? "—" : `${report.kpis.mttaMinutes} min`, report.kpis.previousMttaMinutes === null ? "tiempo medio" : `antes ${report.kpis.previousMttaMinutes} min`],
    ["Disponibilidad", decimal(report.kpis.availabilityPercent, 1, " %"), "datos recibidos"],
  ];
  const kx = M + leftW + 10, kw = (CW - leftW - 10 - 6) / 2;
  kpis.forEach(([label, value, note], index) => {
    const x = kx + (index % 2) * (kw + 6), top = conclusionTop - Math.floor(index / 2) * 47;
    page.drawRectangle({ x, y: top - 43, width: kw, height: 43, borderColor: LINE, borderWidth: 0.8 });
    page.drawText(pdfText(label), { x: x + 8, y: top - 12, size: 7.5, font: regular, color: MUTED });
    page.drawText(pdfText(value), { x: x + 8, y: top - 27, size: 13, font: bold, color: INK });
    page.drawText(pdfText(note), { x: x + 8, y: top - 38, size: 6.5, font: regular, color: MUTED });
  });
  y = conclusionTop - 104;

  // Acciones
  heading("Acciones recomendadas");
  if (!report.actions.length) { write("Sin acciones: los puntos operaron dentro de sus umbrales.", M, 9, { color: MUTED }); }
  report.actions.slice(0, report.kind === "weekly" ? 4 : 6).forEach((action, index) => {
    const titleLines = wrap(`${action.title} · ${action.pointName}`, bold, 9.5, CW - 130).length;
    const whyLines = wrap(action.why, regular, 8, CW - 130).length;
    const h = 16 + titleLines * 12 + whyLines * 10;
    ensure(h + 6);
    const top = y;
    page.drawRectangle({ x: M, y: top - h, width: CW, height: h, borderColor: LINE, borderWidth: 0.8 });
    const tone = TONES[PRIORITY[action.priority].tone];
    page.drawCircle({ x: M + 16, y: top - 16, size: 8, color: tone.bg, borderColor: tone.line, borderWidth: 0.6 });
    page.drawText(String(index + 1), { x: M + 13.5, y: top - 19, size: 8, font: bold, color: tone.fg });
    y = top - 8;
    write(`${action.title} · ${action.pointName}`, M + 32, 9.5, { font: bold, width: CW - 130 });
    write(action.why, M + 32, 8, { color: rgb(0.32, 0.32, 0.36), width: CW - 130, lineGap: 2 });
    const label = pdfText(PRIORITY[action.priority].label);
    const lw = bold.widthOfTextAtSize(label, 7.5) + 12;
    page.drawRectangle({ x: W - M - lw - 8, y: top - 21, width: lw, height: 14, color: tone.bg });
    page.drawText(label, { x: W - M - lw - 2, y: top - 17, size: 7.5, font: bold, color: tone.fg });
    y = top - h - 6;
  });

  // Estado por punto
  heading("Estado por punto de medición");
  const cols = [{ label: "Punto", w: 150 }, { label: "Temp. máx.", w: 62, right: true }, { label: "Desbalance", w: 62, right: true }, { label: "Sobre amb.", w: 62, right: true }, { label: "UHF máx.", w: 50, right: true }, { label: "Alarmas", w: 44, right: true }, { label: "Salud", w: CW - 430 }];
  const drawRow = (cells: string[], options: { header?: boolean; tone?: string } = {}) => {
    ensure(24);
    const top = y;
    if (options.header) page.drawRectangle({ x: M, y: top - 18, width: CW, height: 18, color: rgb(0.98, 0.98, 0.98) });
    else page.drawLine({ start: { x: M, y: top }, end: { x: W - M, y: top }, thickness: 0.5, color: LINE });
    let x = M + 6;
    cells.forEach((cell, index) => {
      const col = cols[index];
      const font = options.header ? regular : index === 0 ? bold : regular;
      const size = options.header ? 7.5 : 8.5;
      const text = pdfText(cell);
      if (!options.header && index === cols.length - 1 && options.tone) {
        const tw = bold.widthOfTextAtSize(text, 7.5) + 10;
        page.drawRectangle({ x, y: top - 15, width: tw, height: 12, color: TONES[options.tone].bg });
        page.drawText(text, { x: x + 5, y: top - 12, size: 7.5, font: bold, color: TONES[options.tone].fg });
      } else {
        const tx = col.right ? x + col.w - 10 - font.widthOfTextAtSize(text, size) : x;
        page.drawText(text, { x: tx, y: top - 12.5, size, font, color: options.header ? MUTED : INK });
      }
      x += col.w;
    });
    y = top - 20;
  };
  drawRow(cols.map((col) => col.label), { header: true });
  for (const point of report.points) {
    drawRow([point.name, decimal(point.tempMax, 1, " °C"), decimal(point.imbalance, 1, " °C"), decimal(point.riseOverAmbient, 1, " °C"), decimal(point.uhfMax, 0), String(point.alarms), HEALTH_LABEL[point.health]], { tone: HEALTH_TONE[point.health] });
  }
  y -= 4;
  write(`Desbalance: diferencia entre fases del mismo punto (percentil 95 del periodo). Criterio: sobre ${report.criteria.imbalanceWatch} °C, observar; sobre ${report.criteria.imbalanceAct} °C, actuar.`, M, 7, { color: MUTED });

  // Gráfico de fases
  if (report.imbalanceChart && report.imbalanceChart.series.some((series) => series.values.some((value) => value !== null))) {
    heading(`Desbalance entre fases · ${report.imbalanceChart.pointName}`);
    ensure(170);
    const chart = report.imbalanceChart;
    const values = chart.series.flatMap((series) => series.values.filter((value): value is number => value !== null));
    const low = Math.floor(Math.min(...values) / 5) * 5;
    const high = Math.max(Math.ceil(Math.max(...values) / 5) * 5, low + 10);
    const cx = M + 26, cw = CW - 30, ch = 130, top = y - 4;
    for (let tick = low; tick <= high; tick += (high - low) / 4) {
      const ty = top - ch + (tick - low) / (high - low) * ch;
      page.drawLine({ start: { x: cx, y: ty }, end: { x: cx + cw, y: ty }, thickness: 0.4, color: LINE });
      page.drawText(String(Math.round(tick)), { x: M, y: ty - 3, size: 7, font: regular, color: MUTED });
    }
    const n = chart.days.length;
    chart.series.forEach((series) => {
      let previous: { x: number; y: number } | null = null;
      series.values.forEach((value, index) => {
        if (value === null) { previous = null; return; }
        const point = { x: cx + (n === 1 ? 0 : index / (n - 1)) * cw, y: top - ch + (value - low) / (high - low) * ch };
        if (previous) page.drawLine({ start: previous, end: point, thickness: series.phase === report.points.find((p) => p.name === chart.pointName)?.hotPhase ? 2 : 1.3, color: PHASE_COLORS[series.phase] ?? INK });
        previous = point;
      });
    });
    [0, Math.floor((n - 1) / 2), n - 1].forEach((index) => {
      const label = new Date(chart.days[index]).toLocaleDateString("es-CL", { timeZone: report.timezone, day: "numeric", month: "short" });
      page.drawText(pdfText(label), { x: cx + (n === 1 ? 0 : index / (n - 1)) * cw - 10, y: top - ch - 12, size: 7, font: regular, color: MUTED });
    });
    y = top - ch - 24;
    let lx = cx;
    chart.series.forEach((series) => {
      page.drawLine({ start: { x: lx, y: y + 3 }, end: { x: lx + 14, y: y + 3 }, thickness: 2, color: PHASE_COLORS[series.phase] ?? INK });
      page.drawText(series.phase, { x: lx + 18, y, size: 8, font: regular, color: INK });
      lx += 50;
    });
    y -= 12;
  }

  // Descarga parcial y humedad, alarmas y disponibilidad
  heading("Descarga parcial y humedad");
  for (const point of report.points) {
    ensure(14);
    write(`${point.name}: ${point.pdEvents} h con descarga parcial y ${point.sdEvents} h con descarga superficial sobre umbral; ${point.humidityHours} h con humedad sobre ${report.criteria.humidityLimit} %.`, M, 8.5, { lineGap: 2 });
  }
  heading("Gestión de alarmas");
  write(`${report.alarmsSummary.total} alarmas (${report.alarmsSummary.critical} críticas, ${report.alarmsSummary.warning} advertencias). Tiempo medio de reconocimiento: ${report.alarmsSummary.mttaMinutes === null ? "sin reconocimientos" : `${report.alarmsSummary.mttaMinutes} min`}. Sin cerrar al final del periodo: ${report.alarmsSummary.unresolved}.`, M, 8.5);
  for (const item of report.alarmsSummary.recurrent) write(`Recurrente: ${item.channel} en ${item.pointName}, ${item.count} veces.`, M, 8.5, { color: TONES.warning.fg });
  heading("Disponibilidad del monitoreo");
  write(`Datos recibidos: ${decimal(report.availability.percent, 1, " %")}.${report.availability.gaps.length ? "" : " Sin cortes de una hora o más."}`, M, 8.5);
  for (const gap of report.availability.gaps.slice(0, 5)) write(`${gap.pointName}: ${gap.hours} h sin datos desde el ${new Date(gap.start).toLocaleString("es-CL", { timeZone: report.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`, M, 8.5);

  pages.forEach((item, index) => {
    item.drawLine({ start: { x: M, y: M + 4 }, end: { x: W - M, y: M + 4 }, thickness: 0.5, color: LINE });
    item.drawText(pdfText(`Generado el ${new Date(report.generatedAt).toLocaleString("es-CL", { timeZone: report.timezone })} · HoitLive Core`), { x: M, y: M - 8, size: 7, font: regular, color: MUTED });
    const label = `Página ${index + 1} de ${pages.length}`;
    item.drawText(pdfText(label), { x: W - M - regular.widthOfTextAtSize(pdfText(label), 7), y: M - 8, size: 7, font: regular, color: MUTED });
  });
  return doc.save();
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);

export function siteReportEmail(report: SiteReport, reportUrl: string) {
  const actionsNow = report.actions.filter((action) => action.priority === "now").length;
  const subject = `${report.site.name} · ${report.period.label}: ${actionsNow ? `${actionsNow} ${actionsNow === 1 ? "acción requerida" : "acciones requeridas"}` : report.actions.length ? "puntos en observación" : "sin hallazgos"}`;
  const tone = { critical: ["#fef2f2", "#fecaca", "#b91c1c"], warning: ["#fffbeb", "#fde68a", "#b45309"], normal: ["#ecfdf5", "#a7f3d0", "#047857"], neutral: ["#f4f4f5", "#e4e4e7", "#52525b"] } as const;
  const kpi = (label: string, value: string, note: string) => `<td style="padding:10px 12px;border:1px solid #e4e4e7;vertical-align:top"><div style="font-size:11px;color:#71717a">${escapeHtml(label)}</div><div style="font-size:18px;font-weight:600;color:#18181b">${escapeHtml(value)}</div><div style="font-size:10px;color:#71717a">${escapeHtml(note)}</div></td>`;
  const actions = report.actions.slice(0, 4).map((action, index) => {
    const [bg, border] = tone[PRIORITY[action.priority].tone as keyof typeof tone];
    return `<div style="margin:0 0 8px;padding:12px 14px;border-radius:8px;background:${bg};border:1px solid ${border}"><div style="font-size:13px;font-weight:600;color:#18181b">${index + 1}. ${escapeHtml(action.title)} · ${escapeHtml(action.pointName)}</div><div style="font-size:12px;color:#52525b;line-height:1.45;margin-top:3px">${escapeHtml(action.why)}</div></div>`;
  }).join("");
  const dots = { action: "#ef4444", watch: "#f59e0b", good: "#10b981" } as const;
  const points = report.points.map((point) => `<tr><td style="padding:8px 0;border-top:1px solid #f4f4f5;width:14px"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${dots[point.health]}"></span></td><td style="padding:8px 0;border-top:1px solid #f4f4f5;font-size:13px;color:#18181b">${escapeHtml(point.name)}</td><td style="padding:8px 0;border-top:1px solid #f4f4f5;font-size:12px;color:#52525b;text-align:right">${escapeHtml(HEALTH_LABEL[point.health])}${point.reasons[0] ? ` · ${escapeHtml(point.reasons[0])}` : ""}</td></tr>`).join("");
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#eef0f2;font-family:Inter,Segoe UI,Arial,sans-serif;color:#18181b">
<div style="max-width:640px;margin:0 auto;padding:24px">
<div style="background:#ffffff;border-radius:10px;overflow:hidden">
<div style="padding:20px 28px;border-bottom:1px solid #f0f0f2;font-size:12px;color:#71717a"><strong style="font-size:15px;color:#1e1b4b">${escapeHtml(report.client.name)}</strong> &nbsp;·&nbsp; ${escapeHtml(KIND_TITLE[report.kind])}</div>
<div style="padding:24px 28px">
<h1 style="margin:0 0 6px;font-size:20px;font-weight:600">${escapeHtml(report.site.name)}</h1>
<p style="margin:0 0 18px;font-size:13px;color:#52525b;line-height:1.5">${escapeHtml(report.period.label)}. ${escapeHtml(report.conclusion.title)}</p>
<table style="width:100%;border-collapse:collapse;margin:0 0 18px"><tr>${kpi("Puntos", `${report.kpis.healthyPoints} / ${report.kpis.totalPoints}`, "en buen estado")}${kpi("Alarmas", String(report.kpis.alarms), `${report.kpis.criticalAlarms} críticas`)}${kpi("Reconocimiento", report.kpis.mttaMinutes === null ? "—" : `${report.kpis.mttaMinutes} min`, "tiempo medio")}${kpi("Datos", decimal(report.kpis.availabilityPercent, 1, " %"), "disponibles")}</tr></table>
<h2 style="margin:0 0 8px;font-size:15px;font-weight:600">${report.actions.length ? "Qué hacer" : "Sin acciones requeridas"}</h2>
${actions || `<p style="margin:0 0 8px;font-size:13px;color:#52525b">Todos los puntos operaron dentro de sus umbrales.</p>`}
<h2 style="margin:18px 0 6px;font-size:15px;font-weight:600">Estado por punto</h2>
<table style="width:100%;border-collapse:collapse">${points}</table>
<p style="margin:20px 0 0"><a href="${escapeHtml(reportUrl)}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#18181b;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none">Ver el informe en línea</a></p>
</div>
<div style="padding:16px 28px;background:#fafafa;border-top:1px solid #f0f0f2;font-size:11px;color:#71717a;line-height:1.5">Recibes este correo porque estás en la programación «${escapeHtml(KIND_TITLE[report.kind])}» de ${escapeHtml(report.site.name)}. Para dejar de recibirlo, pide al administrador del portal que te quite de la lista.</div>
</div></div></body></html>`;
  const text = [
    `${report.site.name} · ${report.period.label}`,
    report.conclusion.title,
    "",
    ...report.actions.slice(0, 4).map((action, index) => `${index + 1}. ${action.title} · ${action.pointName}\n   ${action.why}`),
    "",
    ...report.points.map((point) => `- ${point.name}: ${HEALTH_LABEL[point.health]}${point.reasons[0] ? ` (${point.reasons[0]})` : ""}`),
    "",
    `Informe en línea: ${reportUrl}`,
  ].join("\n");
  return { subject, html, text };
}

export class ReportEmailNotConfigured extends Error {}

export async function sendSiteReportEmail(input: { report: SiteReport; runId: string; recipients: SiteReportRecipient[]; attachPdf: boolean; environment?: Record<string, string | undefined>; fetchImpl?: typeof fetch }) {
  const environment = input.environment ?? process.env;
  const apiKey = environment.RESEND_API_KEY?.trim();
  const from = environment.REPORT_FROM_EMAIL?.trim() || environment.NOTIFICATION_FROM_EMAIL?.trim() || environment.AUTH_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new ReportEmailNotConfigured("El envío de correo no está configurado (RESEND_API_KEY y remitente).");
  if (!input.recipients.length) throw new Error("La programación no tiene destinatarios.");
  const url = `${appBaseUrl(environment)}/?view=reports&report=${encodeURIComponent(input.runId)}`;
  const message = siteReportEmail(input.report, url);
  const attachments = input.attachPdf ? [{ filename: `${KIND_TITLE[input.report.kind].replace(/\s+/g, "-")}-${input.report.site.code}-${input.report.period.start.slice(0, 10)}.pdf`, content: Buffer.from(await siteReportPdf(input.report)).toString("base64") }] : undefined;
  const response = await (input.fetchImpl ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: input.recipients.map((recipient) => recipient.email), subject: message.subject, html: message.html, text: message.text, attachments }),
  });
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok) throw new Error(result.message || `El proveedor de correo respondió ${response.status}.`);
  return { providerMessageId: result.id ?? null, subject: message.subject };
}

/** Próximo envío: lunes (semanal) o día 1 (mensual) a la hora indicada, en la zona horaria del sitio. */
export function nextSiteReportRun(kind: SiteReportKind, hour: number, timezone: string, after = new Date()) {
  return nextCronRun(kind === "weekly" ? `0 ${hour} * * 1` : `0 ${hour} 1 * *`, timezone, after);
}

const CLAIM_MS = 10 * 60_000;

/** Genera y envía el informe de una programación (el del periodo cerrado anterior). */
export async function runSiteReportSchedule(db: Cam5Database, scheduleId: string, options: { now?: Date; force?: boolean; environment?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}) {
  const now = options.now ?? new Date();
  const [schedule] = await db.select({ id: siteReportSchedules.id, siteId: siteReportSchedules.siteId, kind: siteReportSchedules.kind, recipients: siteReportSchedules.recipients, attachPdf: siteReportSchedules.attachPdf, onlyIfFindings: siteReportSchedules.onlyIfFindings, createdBy: siteReportSchedules.createdBy, timezone: sites.timezone })
    .from(siteReportSchedules).innerJoin(sites, eq(sites.id, siteReportSchedules.siteId)).where(eq(siteReportSchedules.id, scheduleId)).limit(1);
  if (!schedule) throw new Error("La programación no existe.");
  const kind = schedule.kind as SiteReportKind;
  const period = previousPeriod(kind, now, schedule.timezone);
  const run = await createSiteReportRun(db, { siteId: schedule.siteId, kind, periodStart: period.start, periodEnd: period.end, requestedBy: schedule.createdBy, now });
  const hasFindings = run.report.actions.length > 0 || run.report.alarmsSummary.total > 0;
  if (schedule.onlyIfFindings && !hasFindings && !options.force) {
    await db.update(siteReportSchedules).set({ lastRunAt: now, lastStatus: "skipped", lastError: null, lastReportId: run.id, updatedAt: now }).where(eq(siteReportSchedules.id, schedule.id));
    return { status: "skipped" as const, reportId: run.id };
  }
  try {
    const sent = await sendSiteReportEmail({ report: run.report, runId: run.id, recipients: schedule.recipients, attachPdf: schedule.attachPdf, environment: options.environment, fetchImpl: options.fetchImpl });
    await db.update(siteReportSchedules).set({ lastRunAt: now, lastStatus: "sent", lastError: null, lastReportId: run.id, updatedAt: now }).where(eq(siteReportSchedules.id, schedule.id));
    return { status: "sent" as const, reportId: run.id, subject: sent.subject };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible enviar el correo.";
    await db.update(siteReportSchedules).set({ lastRunAt: now, lastStatus: "failed", lastError: message.slice(0, 500), lastReportId: run.id, updatedAt: now }).where(eq(siteReportSchedules.id, schedule.id));
    return { status: "failed" as const, reportId: run.id, error: message };
  }
}

/** Procesa las programaciones vencidas (lo llama el cron de reportes cada 5 minutos). */
export async function processSiteReportSchedules(db: Cam5Database, now = new Date(), options: { environment?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}) {
  const due = await db.select({ id: siteReportSchedules.id, kind: siteReportSchedules.kind, hour: siteReportSchedules.hour, timezone: sites.timezone })
    .from(siteReportSchedules).innerJoin(sites, eq(sites.id, siteReportSchedules.siteId))
    .where(and(eq(siteReportSchedules.active, true), lte(siteReportSchedules.nextRunAt, now))).limit(20);
  const result = { due: due.length, sent: 0, skipped: 0, failed: 0 };
  for (const schedule of due) {
    // Reserva antes de generar: si otra ejecución ya la tomó, se omite; si falla, la reserva vence y se reintenta.
    const [claimed] = await db.update(siteReportSchedules).set({ nextRunAt: new Date(now.getTime() + CLAIM_MS) })
      .where(and(eq(siteReportSchedules.id, schedule.id), eq(siteReportSchedules.active, true), lte(siteReportSchedules.nextRunAt, now))).returning({ id: siteReportSchedules.id });
    if (!claimed) continue;
    try {
      const outcome = await runSiteReportSchedule(db, schedule.id, { now, ...options });
      result[outcome.status] += 1;
      await db.update(siteReportSchedules).set({ nextRunAt: nextSiteReportRun(schedule.kind as SiteReportKind, schedule.hour, schedule.timezone, now) }).where(eq(siteReportSchedules.id, schedule.id));
    } catch (error) {
      console.error("No fue posible generar el informe programado", schedule.id, error);
      result.failed += 1;
    }
  }
  return result;
}

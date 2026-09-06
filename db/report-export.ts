import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ReportSnapshot } from "./report-engine";

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[\",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function reportCsv(snapshot: ReportSnapshot) {
  const rows: unknown[][] = [
    ["HOITLIVE CORE - REPORTE OPERACIONAL"],
    ["Plantilla", snapshot.template.name],
    ["Cliente", snapshot.client.name],
    ["Sitio", snapshot.site.name],
    ["Punto de medición", `${snapshot.asset.code} - ${snapshot.asset.name}`],
    ["Periodo inicio UTC", snapshot.period.start],
    ["Periodo fin UTC", snapshot.period.end],
    ["Generado UTC", snapshot.generatedAt],
    [],
    ["RESUMEN"],
    ["Condición", snapshot.summary.condition],
    ["Canales", snapshot.summary.channelCount],
    ["Muestras", snapshot.summary.sampleCount],
    ["Calidad (%)", snapshot.summary.qualityPercent],
    ["Alarmas", snapshot.summary.alarmCount],
    [],
    ["CANALES"],
    ["Código", "Nombre", "Zona", "Último", "Mínimo", "Promedio", "Máximo", "Unidad", "Muestras", "Muestras válidas", "Última lectura UTC"],
    ...snapshot.channels.map((channel) => [channel.code, channel.name, channel.zone, channel.latest, channel.minimum, channel.average, channel.maximum, channel.unit, channel.sampleCount, channel.validSampleCount, channel.latestAt]),
    [],
    ["ALARMAS"],
    ["Código", "Título", "Severidad", "Estado", "Canal", "Valor", "Umbral", "Apertura UTC"],
    ...snapshot.alarms.map((alarm) => [alarm.code, alarm.title, alarm.severity, alarm.status, alarm.channelCode, alarm.triggerValue, alarm.thresholdValue, alarm.openedAt]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function safeText(value: unknown) {
  return String(value ?? "—")
    .replaceAll("·", "-")
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("≤", "<=")
    .replaceAll("≥", ">=")
    .replaceAll("→", "->");
}

function linesFor(text: string, font: PDFFont, size: number, width: number) {
  const words = safeText(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else { if (line) lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

export async function reportPdf(snapshot: ReportSnapshot) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 45;
  let page: PDFPage;
  let y: number;
  const addPage = () => {
    page = document.addPage(pageSize);
    y = pageSize[1] - margin;
    page.drawText("HoitLive Core", { x: margin, y, font: bold, size: 17, color: rgb(0.05, 0.12, 0.18) });
    page.drawText("Reporte de monitoreo de condición eléctrica", { x: margin, y: y - 17, font: regular, size: 8.5, color: rgb(0.38, 0.43, 0.48) });
    page.drawLine({ start: { x: margin, y: y - 28 }, end: { x: pageSize[0] - margin, y: y - 28 }, thickness: 1.2, color: rgb(0.05, 0.49, 0.7) });
    y -= 48;
  };
  const ensure = (height: number) => { if (y - height < margin + 25) addPage(); };
  const text = (value: unknown, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number; width?: number } = {}) => {
    const size = options.size ?? 9.5;
    const font = options.font ?? regular;
    const width = options.width ?? pageSize[0] - margin * 2;
    const lines = linesFor(safeText(value), font, size, width);
    ensure(lines.length * (size + 3) + (options.gap ?? 4));
    for (const line of lines) { page.drawText(line, { x: margin, y, font, size, color: options.color ?? rgb(0.16, 0.18, 0.2) }); y -= size + 3; }
    y -= options.gap ?? 4;
  };
  const section = (value: string) => { ensure(35); y -= 5; text(value.toUpperCase(), { size: 9, font: bold, color: rgb(0.03, 0.42, 0.63), gap: 8 }); };
  const row = (label: string, value: unknown) => {
    ensure(18);
    page.drawText(safeText(label), { x: margin, y, font: regular, size: 8.5, color: rgb(0.43, 0.47, 0.51) });
    page.drawText(safeText(value), { x: 210, y, font: bold, size: 8.5, color: rgb(0.13, 0.15, 0.17) });
    y -= 16;
  };

  addPage();
  text(snapshot.template.name, { size: 22, font: bold, gap: 7 });
  text(snapshot.template.description ?? "Informe operacional consolidado.", { size: 10, color: rgb(0.38, 0.43, 0.48), gap: 14 });
  row("Cliente", snapshot.client.name);
  row("Sitio", snapshot.site.name);
  row("Punto de medición", `${snapshot.asset.code} - ${snapshot.asset.name}`);
  row("Periodo", `${new Date(snapshot.period.start).toLocaleString("es-CL", { timeZone: snapshot.site.timezone })} a ${new Date(snapshot.period.end).toLocaleString("es-CL", { timeZone: snapshot.site.timezone })}`);
  row("Generado por", snapshot.generatedBy);
  row("Generado", new Date(snapshot.generatedAt).toLocaleString("es-CL", { timeZone: snapshot.site.timezone }));

  section("Resumen ejecutivo");
  row("Condición", snapshot.summary.condition === "critical" ? "Crítica" : snapshot.summary.condition === "warning" ? "Advertencia" : "Normal");
  row("Canales incluidos", snapshot.summary.channelCount);
  row("Muestras recibidas", snapshot.summary.sampleCount);
  row("Calidad de datos", snapshot.summary.qualityPercent === null ? "Sin muestras" : `${snapshot.summary.qualityPercent}%`);
  row("Alarmas del periodo", `${snapshot.summary.alarmCount} (${snapshot.summary.criticalCount} críticas, ${snapshot.summary.warningCount} advertencias)`);

  section("Resumen por canal");
  if (!snapshot.channels.length) text("No hay canales habilitados para este punto de medición.");
  for (const channel of snapshot.channels) {
    ensure(38);
    text(`${channel.code} - ${channel.name}`, { size: 9.5, font: bold, gap: 2 });
    text(`Último ${channel.latest ?? "s/d"} ${channel.unit} | Mín ${channel.minimum ?? "s/d"} | Prom ${channel.average === null ? "s/d" : channel.average.toFixed(2)} | Máx ${channel.maximum ?? "s/d"} | ${channel.sampleCount} muestras`, { size: 8, color: rgb(0.4, 0.44, 0.48), gap: 6 });
  }

  section("Alarmas del periodo");
  if (!snapshot.alarms.length) text("No se registraron alarmas en el periodo seleccionado.");
  for (const alarm of snapshot.alarms) {
    ensure(34);
    text(`${alarm.code} - ${alarm.title}`, { size: 9, font: bold, gap: 2 });
    text(`${alarm.severity} | ${alarm.status} | ${alarm.channelCode ?? "Sin canal"} | ${new Date(alarm.openedAt).toLocaleString("es-CL", { timeZone: snapshot.site.timezone })}`, { size: 8, color: rgb(0.4, 0.44, 0.48), gap: 6 });
  }

  const pages = document.getPages();
  pages.forEach((item, index) => {
    item.drawLine({ start: { x: margin, y: 34 }, end: { x: pageSize[0] - margin, y: 34 }, thickness: 0.5, color: rgb(0.82, 0.84, 0.86) });
    item.drawText(`HoitLive Core | ${snapshot.asset.code} | Página ${index + 1} de ${pages.length}`, { x: margin, y: 20, font: regular, size: 7.5, color: rgb(0.5, 0.53, 0.56) });
  });
  return document.save();
}

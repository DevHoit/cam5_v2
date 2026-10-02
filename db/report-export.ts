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
    ...(snapshot.coldChain ? [
      [],
      ["CADENA DE FRÍO"],
      ["Rango mínimo °C", snapshot.coldChain.minimumC],
      ["Rango máximo °C", snapshot.coldChain.maximumC],
      ["Objetivo °C", snapshot.coldChain.targetC],
      ["Excursiones térmicas", snapshot.coldChain.excursionCount],
      ["Tiempo fuera de rango (s)", snapshot.coldChain.totalOutOfRangeSeconds],
      ["Gaps de datos", snapshot.coldChain.dataGapCount],
      [],
      ["EXCURSIONES"],
      ["Sensor", "Nombre", "Tipo", "Inicio UTC", "Fin UTC", "Duración (s)", "Extremo °C", "Activa"],
      ...snapshot.coldChain.excursions.map((item) => [item.sensorCode, item.sensorName, item.type, item.startedAt, item.endedAt, item.durationSeconds, item.extremeC, item.active ? "Sí" : "No"]),
    ] : []),
    ...(snapshot.electrical ? [
      [],
      ["MONITOREO ELÉCTRICO"],
      ["Medidores", snapshot.electrical.meterCount],
      ["Sin telemetría después de (s)", snapshot.electrical.limits.staleAfterSeconds],
      ["Persistencia de umbral (s)", snapshot.electrical.limits.thresholdDelaySeconds],
      ["Voltaje mínimo L-N (V)", snapshot.electrical.limits.voltageMinV],
      ["Voltaje máximo L-N (V)", snapshot.electrical.limits.voltageMaxV],
      ["Corriente máxima por fase (A)", snapshot.electrical.limits.currentMaxA],
      ["Frecuencia mínima (Hz)", snapshot.electrical.limits.frequencyMinHz],
      ["Frecuencia máxima (Hz)", snapshot.electrical.limits.frequencyMaxHz],
      ["Factor de potencia mínimo", snapshot.electrical.limits.powerFactorMin],
      [],
      ["MEDIDORES"],
      ["Código", "Nombre", "Calidad (%)", "V mín", "V prom", "V máx", "I máx", "P prom kW", "P máx kW", "S prom kVA", "Q prom kVAr", "PF mín", "PF prom", "Hz mín", "Hz prom", "Hz máx", "E importada Δ kWh", "E exportada Δ kWh", "Demanda máx kW"],
      ...snapshot.electrical.meters.map((meter) => [
        meter.code, meter.name, meter.qualityPercent,
        meter.voltageMinimumV, meter.voltageAverageV, meter.voltageMaximumV,
        meter.currentMaximumA, meter.activePowerAverageKw, meter.activePowerMaximumKw,
        meter.apparentPowerAverageKva, meter.reactivePowerAverageKvar,
        meter.powerFactorMinimum, meter.powerFactorAverage,
        meter.frequencyMinimumHz, meter.frequencyAverageHz, meter.frequencyMaximumHz,
        meter.energyImportDeltaKwh, meter.energyExportDeltaKwh, meter.peakDemandKw,
      ]),
    ] : []),
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
    page.drawText(snapshot.coldChain ? "Reporte de cadena de frío" : snapshot.electrical ? "Reporte de monitoreo eléctrico" : "Reporte de monitoreo de condición", { x: margin, y: y - 17, font: regular, size: 8.5, color: rgb(0.38, 0.43, 0.48) });
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
  row(snapshot.coldChain ? "Cámara" : snapshot.electrical ? "Punto eléctrico" : "Punto de medición", `${snapshot.asset.code} - ${snapshot.asset.name}`);
  row("Periodo", `${new Date(snapshot.period.start).toLocaleString("es-CL", { timeZone: snapshot.site.timezone })} a ${new Date(snapshot.period.end).toLocaleString("es-CL", { timeZone: snapshot.site.timezone })}`);
  row("Generado por", snapshot.generatedBy);
  row("Generado", new Date(snapshot.generatedAt).toLocaleString("es-CL", { timeZone: snapshot.site.timezone }));

  section("Resumen ejecutivo");
  row("Condición", snapshot.summary.condition === "critical" ? "Crítica" : snapshot.summary.condition === "warning" ? "Advertencia" : "Normal");
  row(snapshot.coldChain ? "Sensores incluidos" : snapshot.electrical ? "Variables incluidas" : "Canales incluidos", snapshot.summary.channelCount);
  row("Muestras recibidas", snapshot.summary.sampleCount);
  row("Calidad de datos", snapshot.summary.qualityPercent === null ? "Sin muestras" : `${snapshot.summary.qualityPercent}%`);
  row("Alarmas del periodo", `${snapshot.summary.alarmCount} (${snapshot.summary.criticalCount} críticas, ${snapshot.summary.warningCount} advertencias)`);

  if (snapshot.coldChain) {
    section("Cadena de frío");
    row("Rango configurado", snapshot.coldChain.minimumC === null || snapshot.coldChain.maximumC === null
      ? "Sin rango configurado"
      : `${snapshot.coldChain.minimumC} °C a ${snapshot.coldChain.maximumC} °C`);
    row("Objetivo", snapshot.coldChain.targetC === null ? "Sin objetivo configurado" : `${snapshot.coldChain.targetC} °C`);
    row("Excursiones térmicas", snapshot.coldChain.excursionCount);
    row("Tiempo total fuera de rango", `${Math.round(snapshot.coldChain.totalOutOfRangeSeconds / 60)} min`);
    row("Gaps de datos", snapshot.coldChain.dataGapCount);
  }

  if (snapshot.electrical) {
    section("Monitoreo eléctrico");
    row("Medidores incluidos", snapshot.electrical.meterCount);
    row("Voltaje L-N configurado", snapshot.electrical.limits.voltageMinV === null && snapshot.electrical.limits.voltageMaxV === null
      ? "Sin límites configurados"
      : `${snapshot.electrical.limits.voltageMinV ?? "s/d"} V a ${snapshot.electrical.limits.voltageMaxV ?? "s/d"} V`);
    row("Corriente máxima", snapshot.electrical.limits.currentMaxA === null ? "Sin límite configurado" : `${snapshot.electrical.limits.currentMaxA} A`);
    row("Frecuencia configurada", snapshot.electrical.limits.frequencyMinHz === null && snapshot.electrical.limits.frequencyMaxHz === null
      ? "Sin límites configurados"
      : `${snapshot.electrical.limits.frequencyMinHz ?? "s/d"} Hz a ${snapshot.electrical.limits.frequencyMaxHz ?? "s/d"} Hz`);
    row("Factor de potencia mínimo", snapshot.electrical.limits.powerFactorMin ?? "Sin límite configurado");
    row("Pérdida de telemetría", `${snapshot.electrical.limits.staleAfterSeconds} s`);

    section("Resumen por medidor");
    if (!snapshot.electrical.meters.length) text("No hay medidores con variables eléctricas configuradas.");
    for (const meter of snapshot.electrical.meters) {
      ensure(78);
      text(`${meter.code} - ${meter.name}`, { size: 9.5, font: bold, gap: 2 });
      text(`Voltaje ${meter.voltageMinimumV ?? "s/d"} / ${meter.voltageAverageV === null ? "s/d" : meter.voltageAverageV.toFixed(1)} / ${meter.voltageMaximumV ?? "s/d"} V (mín/prom/máx) | Corriente máx ${meter.currentMaximumA ?? "s/d"} A`, { size: 8, color: rgb(0.4, 0.44, 0.48), gap: 2 });
      text(`Potencia activa prom ${meter.activePowerAverageKw === null ? "s/d" : meter.activePowerAverageKw.toFixed(2)} kW | máx ${meter.activePowerMaximumKw ?? "s/d"} kW | Demanda máx ${meter.peakDemandKw ?? "s/d"} kW`, { size: 8, color: rgb(0.4, 0.44, 0.48), gap: 2 });
      text(`PF prom ${meter.powerFactorAverage === null ? "s/d" : meter.powerFactorAverage.toFixed(3)} | Frecuencia ${meter.frequencyMinimumHz ?? "s/d"} / ${meter.frequencyAverageHz === null ? "s/d" : meter.frequencyAverageHz.toFixed(2)} / ${meter.frequencyMaximumHz ?? "s/d"} Hz`, { size: 8, color: rgb(0.4, 0.44, 0.48), gap: 2 });
      text(`Energía importada período ${meter.energyImportDeltaKwh === null ? "s/d" : meter.energyImportDeltaKwh.toFixed(2)} kWh | Calidad ${meter.qualityPercent === null ? "s/d" : meter.qualityPercent + "%"}`, { size: 8, color: rgb(0.4, 0.44, 0.48), gap: 7 });
    }
  }

  section(snapshot.coldChain ? "Resumen por sensor" : snapshot.electrical ? "Resumen por variable" : "Resumen por canal");
  if (!snapshot.channels.length) text("No hay canales habilitados para este punto de medición.");
  for (const channel of snapshot.channels) {
    ensure(38);
    text(`${channel.code} - ${channel.name}`, { size: 9.5, font: bold, gap: 2 });
    text(`Último ${channel.latest ?? "s/d"} ${channel.unit} | Mín ${channel.minimum ?? "s/d"} | Prom ${channel.average === null ? "s/d" : channel.average.toFixed(2)} | Máx ${channel.maximum ?? "s/d"} | ${channel.sampleCount} muestras`, { size: 8, color: rgb(0.4, 0.44, 0.48), gap: 6 });
  }

  if (snapshot.coldChain) {
    section("Excursiones y disponibilidad");
    if (!snapshot.coldChain.excursions.length) text("No se detectaron excursiones térmicas ni gaps de datos en el periodo seleccionado.");
    for (const item of snapshot.coldChain.excursions.slice(0, 100)) {
      ensure(34);
      const type = item.type === "high" ? "Alta temperatura" : item.type === "low" ? "Baja temperatura" : "Sin telemetría";
      text(`${item.sensorCode} - ${type}`, { size: 9, font: bold, gap: 2 });
      text(`${new Date(item.startedAt).toLocaleString("es-CL", { timeZone: snapshot.site.timezone })} | ${Math.round(item.durationSeconds / 60)} min | ${item.extremeC === null ? "sin valor térmico" : `extremo ${item.extremeC} °C`}`, { size: 8, color: rgb(0.4, 0.44, 0.48), gap: 6 });
    }
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


function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function worksheetXml(rows: unknown[][]) {
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = columnName(columnIndex) + (rowIndex + 1);
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
      if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
      const text = value === null || value === undefined ? "" : String(value);
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function zipStored(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    localParts.push(local);

    const central = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    centralParts.push(central);
    offset += local.length;
  }

  const localBytes = concatBytes(localParts);
  const centralBytes = concatBytes(centralParts);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBytes.length),
    u32(localBytes.length),
    u16(0),
  ]);
  return concatBytes([localBytes, centralBytes, end]);
}

export function reportXlsx(snapshot: ReportSnapshot) {
  const summaryRows: unknown[][] = [
    ["HOITLIVE CORE - REPORTE OPERACIONAL"],
    ["Plantilla", snapshot.template.name],
    ["Cliente", snapshot.client.name],
    ["Sitio", snapshot.site.name],
    [snapshot.coldChain ? "Cámara" : snapshot.electrical ? "Punto eléctrico" : "Punto de medición", `${snapshot.asset.code} - ${snapshot.asset.name}`],
    ["Periodo inicio UTC", snapshot.period.start],
    ["Periodo fin UTC", snapshot.period.end],
    ["Generado UTC", snapshot.generatedAt],
    [],
    ["RESUMEN"],
    ["Condición", snapshot.summary.condition],
    [snapshot.coldChain ? "Sensores" : snapshot.electrical ? "Variables" : "Canales", snapshot.summary.channelCount],
    ["Muestras", snapshot.summary.sampleCount],
    ["Muestras válidas", snapshot.summary.validSampleCount],
    ["Calidad (%)", snapshot.summary.qualityPercent],
    ["Alarmas", snapshot.summary.alarmCount],
    ["Críticas", snapshot.summary.criticalCount],
    ["Advertencias", snapshot.summary.warningCount],
  ];

  if (snapshot.coldChain) {
    summaryRows.push(
      [],
      ["CADENA DE FRÍO"],
      ["Rango mínimo °C", snapshot.coldChain.minimumC],
      ["Rango máximo °C", snapshot.coldChain.maximumC],
      ["Objetivo °C", snapshot.coldChain.targetC],
      ["Persistencia alarma (s)", snapshot.coldChain.excursionDelaySeconds],
      ["Lectura obsoleta (s)", snapshot.coldChain.staleAfterSeconds],
      ["Excursiones térmicas", snapshot.coldChain.excursionCount],
      ["Tiempo fuera de rango (s)", snapshot.coldChain.totalOutOfRangeSeconds],
      ["Gaps de datos", snapshot.coldChain.dataGapCount],
    );
  }

  if (snapshot.electrical) {
    summaryRows.push(
      [],
      ["MONITOREO ELÉCTRICO"],
      ["Medidores", snapshot.electrical.meterCount],
      ["Sin telemetría después de (s)", snapshot.electrical.limits.staleAfterSeconds],
      ["Persistencia de umbral (s)", snapshot.electrical.limits.thresholdDelaySeconds],
      ["Voltaje mínimo L-N (V)", snapshot.electrical.limits.voltageMinV],
      ["Voltaje máximo L-N (V)", snapshot.electrical.limits.voltageMaxV],
      ["Corriente máxima por fase (A)", snapshot.electrical.limits.currentMaxA],
      ["Frecuencia mínima (Hz)", snapshot.electrical.limits.frequencyMinHz],
      ["Frecuencia máxima (Hz)", snapshot.electrical.limits.frequencyMaxHz],
      ["Factor de potencia mínimo", snapshot.electrical.limits.powerFactorMin],
    );
  }

  const channelRows: unknown[][] = [
    [snapshot.coldChain ? "Sensor" : snapshot.electrical ? "Variable" : "Canal", "Nombre", "Zona", "Último", "Mínimo", "Promedio", "Máximo", "Unidad", "Muestras", "Muestras válidas", "Última lectura UTC"],
    ...snapshot.channels.map((channel) => [
      channel.code,
      channel.name,
      channel.zone,
      channel.latest,
      channel.minimum,
      channel.average,
      channel.maximum,
      channel.unit,
      channel.sampleCount,
      channel.validSampleCount,
      channel.latestAt,
    ]),
  ];

  const alarmRows: unknown[][] = [
    ["Código", "Título", "Severidad", "Estado", snapshot.coldChain ? "Sensor/canal" : "Canal", "Valor", "Umbral", "Apertura UTC"],
    ...snapshot.alarms.map((alarm) => [
      alarm.code,
      alarm.title,
      alarm.severity,
      alarm.status,
      alarm.channelCode,
      alarm.triggerValue,
      alarm.thresholdValue,
      alarm.openedAt,
    ]),
  ];

  const sheets = [
    { name: "Resumen", rows: summaryRows },
    { name: snapshot.coldChain ? "Sensores" : snapshot.electrical ? "Variables" : "Canales", rows: channelRows },
    ...(snapshot.coldChain ? [{
      name: "Excursiones",
      rows: [
        ["Sensor", "Nombre", "Tipo", "Inicio UTC", "Fin UTC", "Duración (s)", "Extremo °C", "Activa"],
        ...snapshot.coldChain.excursions.map((item) => [
          item.sensorCode,
          item.sensorName,
          item.type,
          item.startedAt,
          item.endedAt,
          item.durationSeconds,
          item.extremeC,
          item.active,
        ]),
      ],
    }] : []),
    ...(snapshot.electrical ? [{
      name: "Medidores",
      rows: [
        ["Código", "Nombre", "Muestras", "Muestras válidas", "Calidad (%)", "V mín", "V prom", "V máx", "I máx", "P prom kW", "P máx kW", "S prom kVA", "Q prom kVAr", "PF mín", "PF prom", "Hz mín", "Hz prom", "Hz máx", "E imp inicio kWh", "E imp fin kWh", "E imp Δ kWh", "E exp inicio kWh", "E exp fin kWh", "E exp Δ kWh", "Demanda máx kW"],
        ...snapshot.electrical.meters.map((meter) => [
          meter.code, meter.name, meter.sampleCount, meter.validSampleCount, meter.qualityPercent,
          meter.voltageMinimumV, meter.voltageAverageV, meter.voltageMaximumV, meter.currentMaximumA,
          meter.activePowerAverageKw, meter.activePowerMaximumKw, meter.apparentPowerAverageKva, meter.reactivePowerAverageKvar,
          meter.powerFactorMinimum, meter.powerFactorAverage,
          meter.frequencyMinimumHz, meter.frequencyAverageHz, meter.frequencyMaximumHz,
          meter.energyImportStartKwh, meter.energyImportEndKwh, meter.energyImportDeltaKwh,
          meter.energyExportStartKwh, meter.energyExportEndKwh, meter.energyExportDeltaKwh,
          meter.peakDemandKw,
        ]),
      ],
    }] : []),
    { name: "Alarmas", rows: alarmRows },
  ];

  const workbookSheets = sheets.map((sheet, index) =>
    `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("");
  const relationships = sheets.map((_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");
  const contentSheets = sheets.map((_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");

  const files: Array<{ name: string; content: string }> = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${contentSheets}
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheets}</sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationships}
</Relationships>`,
    },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: worksheetXml(sheet.rows),
    })),
  ];

  return zipStored(files);
}

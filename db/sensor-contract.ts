export function sensorInstalled(metadata: Record<string, unknown>, deviceMetadata: Record<string, unknown> = {}) {
  return metadata.installation === "installed" || (metadata.installation === undefined && deviceMetadata.sensorConfiguration !== 1);
}
export function sensorName(name: string, metadata: Record<string, unknown>) {
  return typeof metadata.sensorAlias === "string" && metadata.sensorAlias.trim() ? metadata.sensorAlias : name;
}
export type HistoryCell = { value: number | string | boolean | null; quality: string; count: number };
export type HistoryColumn = { id: string; name: string; code: string; unit: string; deviceId: string; deviceName: string };
export type WideRow = { id: string; recordedAt: string; deviceId: string; deviceName: string; cells: Record<string, HistoryCell> };
export type WideHistory = { columns: HistoryColumn[]; rows: WideRow[]; hasMore: boolean; page: number; mode: string; aggregation: string };
export function historyCsv(data: WideHistory) {
  const cell = (v: unknown) => {
    let text = v === null || v === undefined ? "" : String(v);
    if (typeof v === "string" && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const lines: unknown[][] = [["Fecha/hora UTC", "Equipo", ...data.columns.map((c) => `${c.deviceName} · ${c.name}${c.unit ? ` (${c.unit})` : ""}`)]];
  for (const row of data.rows) lines.push([row.recordedAt, row.deviceName, ...data.columns.map((c) => row.cells[c.id]?.value ?? null)]);
  return "\uFEFF" + lines.map((line) => line.map(cell).join(";")).join("\r\n");
}

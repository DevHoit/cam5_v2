"use client";
import { useEffect, useState } from "react";
import type { HistoryColumn, WideHistory } from "../db/sensor-contract";
import styles from "./sensor-history.module.css";
const dateInput = (at: Date) => new Date(+at - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export function WideHistoryView({ assetId, canExport }: { assetId: string; canExport: boolean }) {
  const [from, setFrom] = useState(() => dateInput(new Date(Date.now() - 86400000)));
  const [to, setTo] = useState(() => dateInput(new Date()));
  const [mode, setMode] = useState("raw");
  const [aggregation, setAggregation] = useState("avg");
  const [device, setDevice] = useState("");
  const [catalog, setCatalog] = useState<HistoryColumn[]>([]);
  const [columns, setColumns] = useState<string[] | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [data, setData] = useState<WideHistory | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const valid = Number.isFinite(+new Date(from)) && Number.isFinite(+new Date(to));
  const params = new URLSearchParams({ assetId, from: valid ? new Date(from).toISOString() : "", to: valid ? new Date(to).toISOString() : "", mode, aggregation, page: String(page) });
  if (device) params.set("deviceId", device);
  if (columns) params.set("columns", columns.join(","));
  const query = params.toString();
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      fetch(`/api/v1/history/table?${query}`, { signal: abort.signal, cache: "no-store" }).then(async (r) => { const result = await r.json(); if (!r.ok) throw new Error(result.error); return result as WideHistory; })
        .then((result) => { setLoadedQuery(query); setData(result); if (!new URLSearchParams(query).has("columns")) setCatalog((old) => [...old.filter((c) => !result.columns.some((n) => n.id === c.id)), ...result.columns]); })
        .catch((e) => { if (!abort.signal.aborted) { setError(e.message); setData(null); } })
        .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, revision]);
  async function download() {
    setExporting(true); setError("");
    try {
      const r = await fetch(`/api/v1/history/table?${query}&format=csv`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error);
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = url; a.download = "hoitlive-historico.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : "No fue posible exportar."); } finally { setExporting(false); }
  }
  const visibleCatalog = catalog.filter((c) => !device || c.deviceId === device);
  const selected = columns ?? visibleCatalog.map((c) => c.id);
  function move(id: string, offset: number) { const next = [...selected]; const index = next.indexOf(id); const other = index + offset; if (index < 0 || other < 0 || other >= next.length) return; [next[index], next[other]] = [next[other], next[index]]; setColumns(next); setPage(1); }
  return <section className={styles.panel}><h2>Mediciones por muestra</h2><p>Una fila por equipo, lote y hora de medición. Las celdas vacías no tienen lectura; no se arrastran valores anteriores.</p>
    <div className={styles.filters}>
      <label>Desde<input type="datetime-local" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
      <label>Hasta<input type="datetime-local" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
      <label>Equipo<select value={device} onChange={(e) => { setDevice(e.target.value); setColumns(null); setPage(1); }}><option value="">Todos</option>{Array.from(new Map(catalog.map((c) => [c.deviceId, c.deviceName]))).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Filas<select value={mode} onChange={(e) => { setMode(e.target.value); setPage(1); }}><option value="raw">Muestra original</option><option value="minute">Por minuto</option><option value="hour">Por hora</option><option value="day">Por día (UTC)</option></select></label>
      {mode !== "raw" && <label>Valores numéricos<select value={aggregation} onChange={(e) => { setAggregation(e.target.value); setPage(1); }}><option value="avg">Promedio</option><option value="min">Mínimo</option><option value="max">Máximo</option><option value="last">Último válido</option></select></label>}
      <button className="secondary-button" onClick={() => { setPage(1); setTo(dateInput(new Date())); setRevision((v) => v + 1); }}>Actualizar</button>
      {canExport && <button className="secondary-button" disabled={loading || loadedQuery !== query || exporting || !data?.rows.length} onClick={() => void download()}>{exporting ? "Exportando…" : "Exportar CSV para Excel"}</button>}
    </div>
    <button onClick={() => { setColumns(null); setCatalog([]); setPage(1); setRevision((v) => v + 1); }}>Restablecer columnas</button>
    <details><summary>Columnas y orden · {selected.length} seleccionadas</summary><div className={styles.columnGrid}>{visibleCatalog.map((c) => <div key={c.id}><label><input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => { setColumns(e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id)); setPage(1); }} />{c.name} · {c.deviceName}</label><button aria-label={`Mover ${c.name} a la izquierda`} disabled={!selected.includes(c.id) || selected.indexOf(c.id) === 0} onClick={() => move(c.id, -1)}>←</button><button aria-label={`Mover ${c.name} a la derecha`} disabled={!selected.includes(c.id) || selected.indexOf(c.id) === selected.length - 1} onClick={() => move(c.id, 1)}>→</button></div>)}</div></details>
    <small>Fechas en hora local; CSV en UTC. Rango máximo: 31 días; detalle sujeto a retención de datos crudos (30 días). {mode !== "raw" && "Agrupación en UTC; solo lecturas válidas. Texto y estados usan el último válido."}</small>
    {error && <p role="alert">{error}</p>}{loading && <p role="status">Consultando filas…</p>}
    {!loading && loadedQuery === query && data && <><div className={styles.scroll}><table className={styles.table}><thead><tr><th>Fecha/hora</th><th>Equipo</th>{data.columns.map((c) => <th key={c.id}>{c.name}<small>{c.code} · {c.unit}</small></th>)}</tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><th scope="row">{new Date(row.recordedAt).toLocaleString("es-CL", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 })}</th><td>{row.deviceName}</td>{data.columns.map((c) => { const cell = row.cells[c.id]; return <td key={c.id} className={cell && cell.quality !== "good" ? styles.invalid : ""} title={cell ? `Calidad: ${cell.quality}; muestras: ${cell.count}` : "Sin lectura"}>{cell?.value === null || cell?.value === undefined ? "" : String(cell.value)}{cell && cell.quality !== "good" ? " ⚠" : ""}</td>; })}</tr>)}</tbody></table></div>{!data.rows.length && <p>Sin muestras para los sensores y el rango seleccionados.</p>}<div className={styles.actions}><button disabled={page === 1} onClick={() => setPage((v) => v - 1)}>Anterior</button><span>Página {page} · {data.rows.length} filas</span><button disabled={!data.hasMore} onClick={() => setPage((v) => v + 1)}>Siguiente</button></div></>}
  </section>;
}

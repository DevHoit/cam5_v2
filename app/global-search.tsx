"use client";
import { useEffect, useRef, useState } from "react";
import { IconSearch, IconX, IconCircuitCell, IconAlertTriangle, IconLayoutDashboard } from "@tabler/icons-react";
import { portalFetch } from "./lib/portal-fetch";

type AlarmMatch = { id: string; code: string; title: string; assetId: string; assetName: string };
export function GlobalSearch({ assets, modules, canReadAlarms, onClose, onAsset, onModule, onAlarm }: {
  assets: Array<{ id: string; code: string; name: string; area?: string | null }>;
  modules: Array<{ id: string; title: string; description: string }>;
  canReadAlarms: boolean;
  onClose: () => void;
  onAsset: (id: string) => void;
  onModule: (id: string) => void;
  onAlarm: (alarm: AlarmMatch) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; items: AlarmMatch[]; total: number } | null>(null);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]') ?? []);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, []);
  useEffect(() => {
    if (!canReadAlarms) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setError("");
      void portalFetch(`/api/v1/alarms/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(async (response) => { if (!response.ok) throw new Error("No fue posible consultar las alertas."); return response.json() as Promise<{ items: AlarmMatch[]; total: number }>; })
        .then((data) => { if (!controller.signal.aborted) setResult({ ...data, query }); })
        .catch((err: unknown) => { if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : "Error de búsqueda"); setResult(null); } });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, canReadAlarms]);
  const term = query.trim().toLowerCase();
  const points = assets.filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(term));
  const views = modules.filter((m) => `${m.title} ${m.description}`.toLowerCase().includes(term));
  const matches = result?.query === query ? result.items : [];
  const loading = canReadAlarms && result?.query !== query && !error;
  return <div className="channel-visibility-backdrop" role="presentation" onMouseDown={onClose}>
    <section ref={dialog} className="channel-visibility-sheet global-search-dialog" role="dialog" aria-modal="true" aria-label="Búsqueda del sitio" onMouseDown={(event) => event.stopPropagation()}>
      <header className="global-search-header"><IconSearch size={20} /><input ref={input} aria-label="Buscar activos, módulos o alertas críticas del sitio" value={query} onChange={(event) => { setQuery(event.target.value); setError(""); }} placeholder="Buscar en el sitio… (Esc para cerrar)" /><button onClick={onClose} aria-label="Cerrar búsqueda"><IconX size={18} /></button></header>
      <div className="global-search-results">
        {!!points.length && <div className="search-group"><span className="search-group-title">Activos</span>{points.map((p) => <button key={p.id} onClick={() => onAsset(p.id)}><IconCircuitCell size={16} /><div><strong>{p.name}</strong><small>{p.code} · {p.area || "Sin área"}</small></div></button>)}</div>}
        {canReadAlarms && <div className="search-group"><span className="search-group-title">Alertas críticas del sitio</span>{loading && <p role="status">Buscando alertas…</p>}{error && <p role="alert">{error}</p>}{matches.map((alarm) => <button key={alarm.id} onClick={() => onAlarm(alarm)}><IconAlertTriangle size={16} /><div><strong>{alarm.title}</strong><small>{alarm.code} · {alarm.assetName}</small></div></button>)}{result?.query === query && result.total > 20 && <p>Mostrando 20 de {result.total}. Precisa la búsqueda para encontrar otras alertas.</p>}</div>}
        {!!views.length && <div className="search-group"><span className="search-group-title">Módulos</span>{views.map((m) => <button key={m.id} onClick={() => onModule(m.id)}><IconLayoutDashboard size={16} /><div><strong>{m.title}</strong><small>{m.description}</small></div></button>)}</div>}
        {!points.length && !views.length && !matches.length && !loading && !error && <p className="visibility-empty">Sin resultados para esta búsqueda.</p>}
      </div>
    </section>
  </div>;
}

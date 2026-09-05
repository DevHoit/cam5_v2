"use client";

import { useMemo, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

export function useClientPagination<T>(items: T[], pageSize = 8) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const effectivePage = Math.min(page, totalPages);

  const pageItems = useMemo(
    () => items.slice((effectivePage - 1) * pageSize, effectivePage * pageSize),
    [items, effectivePage, pageSize],
  );

  return { page: effectivePage, setPage, totalPages, pageItems, total: items.length, pageSize };
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  itemLabel = "registros",
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const nearby = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter((value) => value === 1 || value === totalPages || Math.abs(value - page) <= 1);

  return (
    <nav className="table-pagination" aria-label={`Paginación de ${itemLabel}`}>
      <span>Mostrando {start}–{end} de {total} {itemLabel}</span>
      <div>
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Página anterior"><IconChevronLeft size={16} /></button>
        {nearby.map((value, index) => {
          const previous = nearby[index - 1];
          return <span key={value}>{previous && value - previous > 1 ? <i>…</i> : null}<button type="button" className={value === page ? "active" : ""} aria-current={value === page ? "page" : undefined} onClick={() => onPageChange(value)}>{value}</button></span>;
        })}
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} aria-label="Página siguiente"><IconChevronRight size={16} /></button>
      </div>
    </nav>
  );
}

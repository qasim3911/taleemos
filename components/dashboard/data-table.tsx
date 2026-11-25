'use client';

import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Printer, Search } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export/excel';

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
  exportValue?: (row: T) => string | number;
}

interface DataTableProps<T> {
  title: string;
  subtitle?: string;
  rows: T[];
  columns: TableColumn<T>[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  searchPlaceholder?: string;
  getSearchText?: (row: T) => string;
  getRowKey: (row: T) => string;
  exportFileName?: string;
  primaryAction?: React.ReactNode;
  filters?: React.ReactNode;
  pageSize?: number;
}

export function DataTable<T>({
  title,
  subtitle,
  rows,
  columns,
  loading = false,
  emptyTitle = 'No records found',
  emptyDescription = 'Add a new record to store real data in your Supabase school workspace.',
  searchPlaceholder = 'Search records...',
  getSearchText,
  getRowKey,
  exportFileName,
  primaryAction,
  filters,
  pageSize = 10,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (!query.trim() || !getSearchText) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => getSearchText(r).toLowerCase().includes(q));
  }, [rows, query, getSearchText]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleExcelExport = () => {
    if (!exportFileName) return;
    const mapped = filtered.map((row) => {
      const obj: Record<string, unknown> = {};
      for (const col of columns) {
        if (col.exportValue) {
          obj[col.header] = col.exportValue(row);
        }
      }
      return obj;
    });
    exportRowsToExcel(exportFileName, title, mapped);
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="flex flex-col gap-4 border-b border-slate-200 dark:border-slate-800 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          {exportFileName && filtered.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExcelExport}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" />
                Excel
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Printer className="h-3.5 w-3.5" />
                Print
              </button>
            </>
          )}
          {primaryAction}
        </div>
      </div>

      {(getSearchText || filters) && (
        <div className="flex flex-col gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between no-print">
          {getSearchText && (
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
              />
            </div>
          )}
          {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
        </div>
      )}

      {loading ? (
        <div className="p-5 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-10 w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{emptyTitle}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            {emptyDescription}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-4 py-3 font-semibold whitespace-nowrap ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {pageRows.map((row) => (
                  <tr
                    key={getRowKey(row)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 text-slate-700 dark:text-slate-200 ${
                          col.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                        }`}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 px-5 py-3 text-xs text-slate-500 dark:text-slate-400 no-print">
            <span className="font-mono-tabular">
              Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of{' '}
              {filtered.length}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="px-2 font-mono-tabular">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

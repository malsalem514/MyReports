'use client';

import { CalendarDays, ChevronLeft, ChevronRight, Database, Download, Search, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { buildRawDataCsvContent } from '@/lib/raw-data-csv';
import { cn } from '@/lib/utils';
import type { RawDataDatasetSummary, RawDataResult, RawDataRow } from '@/lib/raw-data-types';
import type { FormEvent } from 'react';

interface RawDataClientProps {
  catalog: RawDataDatasetSummary[];
  result: RawDataResult;
  errorMessage?: string | null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function isNumericValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getCellDisplay(value: RawDataRow[string]): string {
  if (value === null || value === undefined || value === '') return '—';
  if (isNumericValue(value)) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  return String(value);
}

export function RawDataClient({ catalog, result, errorMessage }: RawDataClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [datasetKey, setDatasetKey] = useState(result.dataset.key);
  const [startDate, setStartDate] = useState(result.startDate);
  const [endDate, setEndDate] = useState(result.endDate);
  const [search, setSearch] = useState(result.search);

  const selectedDataset = useMemo(
    () => catalog.find((dataset) => dataset.key === datasetKey) || result.dataset,
    [catalog, datasetKey, result.dataset],
  );
  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, RawDataDatasetSummary[]>();
    for (const dataset of catalog) {
      const rows = groups.get(dataset.category) || [];
      rows.push(dataset);
      groups.set(dataset.category, rows);
    }
    return Array.from(groups.entries());
  }, [catalog]);
  const pageCount = Math.max(1, Math.ceil(result.totalRows / result.pageSize));
  const firstVisibleRow = result.totalRows === 0 ? 0 : result.page * result.pageSize + 1;
  const lastVisibleRow = Math.min(result.totalRows, (result.page + 1) * result.pageSize);
  const showDateFilters = Boolean(selectedDataset.dateFieldLabel);

  const pushParams = (updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    }
    router.push(`/dashboard/raw-data?${params.toString()}`);
  };

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    pushParams({
      dataset: datasetKey,
      startDate,
      endDate,
      q: search.trim() || null,
      page: 0,
    });
  };

  const changeDataset = (nextDatasetKey: string) => {
    setDatasetKey(nextDatasetKey as typeof result.dataset.key);
    pushParams({
      dataset: nextDatasetKey,
      startDate,
      endDate,
      q: search.trim() || null,
      page: 0,
    });
  };

  const changePage = (nextPage: number) => {
    pushParams({
      dataset: result.dataset.key,
      startDate,
      endDate,
      q: result.search || null,
      page: Math.max(0, Math.min(pageCount - 1, nextPage)),
    });
  };

  const exportCsv = () => {
    const csv = buildRawDataCsvContent(result.columns, result.rows);
    const range = result.dataset.dateFieldLabel ? `-${result.startDate}-${result.endDate}` : '';
    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      `raw-data-${result.dataset.key}${range}.csv`,
    );
  };

  return (
    <div data-testid="raw-data-page" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight text-gray-950">Raw Data</h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-gray-500">
            Source-level evidence behind office attendance, TBS comparison, working hours, mappings, approvals, and device checks.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={exportCsv}
          disabled={result.rows.length === 0}
          className="self-start border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
        >
          <Download className="size-4" />
          CSV
        </Button>
      </div>

      {errorMessage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-800">
          Raw data is currently unavailable. {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
              <Database className="size-4 text-gray-500" />
              Data Sets
            </div>
            <p className="mt-1 text-[12px] text-gray-500">{catalog.length} approved raw-data views</p>
          </div>
          <div className="max-h-[68vh] overflow-y-auto p-2">
            {groupedCatalog.map(([category, datasets]) => (
              <div key={category} className="py-2">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                  {category}
                </p>
                <div className="space-y-1">
                  {datasets.map((dataset) => {
                    const active = dataset.key === result.dataset.key;
                    return (
                      <button
                        key={dataset.key}
                        type="button"
                        onClick={() => changeDataset(dataset.key)}
                        className={cn(
                          'w-full rounded-md px-2.5 py-2 text-left transition-colors',
                          active ? 'bg-slate-900 text-white' : 'text-gray-700 hover:bg-gray-50 hover:text-gray-950',
                        )}
                      >
                        <span className="block truncate text-[12px] font-semibold">{dataset.label}</span>
                        <span className={cn('mt-0.5 block truncate text-[11px]', active ? 'text-slate-300' : 'text-gray-400')}>
                          {dataset.sourceLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <form
            onSubmit={submitFilters}
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.1fr)_minmax(260px,1.5fr)_auto] lg:items-end">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Data set</span>
                <select
                  data-testid="raw-data-dataset-select"
                  value={datasetKey}
                  onChange={(event) => changeDataset(event.target.value)}
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                >
                  {catalog.map((dataset) => (
                    <option key={dataset.key} value={dataset.key}>
                      {dataset.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Search</span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                  <input
                    data-testid="raw-data-search"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Employee, email, ID, IP, code, status"
                    className="h-10 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 text-[13px] text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </span>
              </label>

              <Button type="submit" size="lg" className="bg-slate-900 text-white hover:bg-slate-800">
                <Search className="size-4" />
                Apply
              </Button>
            </div>

            {showDateFilters ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:max-w-[520px]">
                <label className="block">
                  <span className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    <CalendarDays className="size-3.5" />
                    Start
                  </span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    <CalendarDays className="size-3.5" />
                    End
                  </span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
              </div>
            ) : null}
          </form>

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Table2 className="size-4 shrink-0 text-gray-500" />
                    <h3 className="truncate text-[15px] font-semibold text-gray-950">{result.dataset.label}</h3>
                  </div>
                  <p className="mt-1 max-w-4xl text-[12px] leading-5 text-gray-500">{result.dataset.description}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">{result.dataset.sourceLabel}</span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">{result.dataset.audience}</span>
                  {result.dataset.dateFieldLabel ? (
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">{result.dataset.dateFieldLabel}</span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 text-[12px] text-gray-500 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Showing <span className="font-semibold text-gray-800">{formatNumber(firstVisibleRow)}</span>
                {' '}to <span className="font-semibold text-gray-800">{formatNumber(lastVisibleRow)}</span>
                {' '}of <span className="font-semibold text-gray-800">{formatNumber(result.totalRows)}</span>
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => changePage(result.page - 1)}
                  disabled={result.page <= 0}
                  aria-label="Previous page"
                  className="bg-white"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-24 text-center text-[12px] font-medium text-gray-700">
                  Page {result.page + 1} of {pageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => changePage(result.page + 1)}
                  disabled={result.page >= pageCount - 1}
                  aria-label="Next page"
                  className="bg-white"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>

            <div data-testid="raw-data-table">
              <div className="max-h-[68vh] overflow-auto">
                <table className="min-w-max border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-50">
                    <tr>
                      {result.columns.map((column) => (
                        <th
                          key={column.key}
                          className="border-b border-gray-200 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                        >
                          <span className="block max-w-[220px] truncate">{column.label}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  {result.rows.length > 0 ? (
                    <tbody>
                      {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/70">
                          {result.columns.map((column) => {
                            const value = row[column.key];
                            const display = getCellDisplay(value);
                            const numeric = isNumericValue(value);
                            return (
                              <td
                                key={column.key}
                                title={display === '—' ? undefined : display}
                                className={cn(
                                  'whitespace-nowrap px-3 py-2.5 text-[12px] text-gray-700',
                                  numeric ? 'text-right tabular-nums' : 'text-left',
                                )}
                              >
                                <span className="block max-w-[320px] truncate">{display}</span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  ) : null}
                </table>
              </div>
              {result.rows.length === 0 ? (
                <div className="border-t border-gray-100 px-4 py-12 text-center text-[13px] text-gray-500">
                  No rows match the current filters.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

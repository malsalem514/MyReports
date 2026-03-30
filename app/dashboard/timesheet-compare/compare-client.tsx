'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LOOKBACK_OPTIONS } from '@/lib/constants';
import type {
  TbsComparisonRow, TbsComparisonSummary,
} from '@/lib/dashboard-data';
import { getTrailingWeeksParamRange, parseLocalDate, toDateParam } from '@/lib/report-date-defaults';
import {
  arraysEqual,
  parseEnumParam,
  parseListParam,
  parsePageParam,
  serializeListParam,
} from '@/lib/search-params';
import { useUrlStateSync, type UrlStateField } from '@/lib/use-url-state-sync';

interface Props {
  rows: TbsComparisonRow[];
  weeks: string[];
  departments: string[];
  summary: TbsComparisonSummary;
  unmappedEmails: string[];
  startDate: string;
  endDate: string;
}

type SortKey = 'name' | 'department' | 'discrepancyCount' | 'totalBambooPto' | 'totalTbsPto' | string;
type SortDir = 'asc' | 'desc';
type FilterMode = 'all' | 'discrepancies' | 'bamboo-only' | 'tbs-only';

const PAGE_SIZE = 50;
const FILTER_MODES: FilterMode[] = ['all', 'discrepancies', 'bamboo-only', 'tbs-only'];

function getCellColor(cell: { bambooPtoDays: number; tbsPtoDays: number; hasDiscrepancy: boolean } | undefined): string {
  if (!cell) return '';
  if (cell.hasDiscrepancy) return 'bg-red-100 text-red-700';
  if (cell.bambooPtoDays > 0 && cell.tbsPtoDays > 0) return 'bg-green-100 text-green-700';
  if (cell.bambooPtoDays > 0 || cell.tbsPtoDays > 0) return 'bg-blue-100 text-blue-700';
  return '';
}

export function CompareClient({
  rows,
  weeks,
  departments,
  summary,
  unmappedEmails,
  startDate,
  endDate,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeQuickRange = useMemo(() => {
    const today = new Date();
    const expectedEnd = toDateParam(today);
    if (endDate !== expectedEnd) return null;

    for (const weeksBack of LOOKBACK_OPTIONS) {
      const range = getTrailingWeeksParamRange(weeksBack);
      if (startDate === range.startDate) {
        return weeksBack;
      }
    }

    return null;
  }, [startDate, endDate]);

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [selectedDepts, setSelectedDepts] = useState<string[]>(() =>
    parseListParam(searchParams.get('departments')).filter((department) => departments.includes(department)),
  );
  const [filterMode, setFilterMode] = useState<FilterMode>(() => {
    return parseEnumParam(searchParams.get('show'), FILTER_MODES, 'all');
  });
  const [deptOpen, setDeptOpen] = useState(false);
  const [unmappedOpen, setUnmappedOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(() => searchParams.get('sortKey') || 'discrepancyCount');
  const [sortDir, setSortDir] = useState<SortDir>(() => parseEnumParam(searchParams.get('sortDir'), ['asc', 'desc'] as const, 'desc'));
  const [page, setPage] = useState(() => parsePageParam(searchParams.get('page')));

  const deptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) setDeptOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const syncedFields = useMemo<UrlStateField[]>(() => ([
    {
      current: search,
      read: (params) => params.get('q') || '',
      sync: (nextValue) => {
        const nextSearch = nextValue as string;
        setSearch((previous) => (previous === nextSearch ? previous : nextSearch));
      },
      write: (params) => {
        if (search) params.set('q', search);
        else params.delete('q');
      },
    },
    {
      current: selectedDepts,
      read: (params) => parseListParam(params.get('departments')).filter((department) => departments.includes(department)),
      sync: (nextValue) => {
        const nextDepts = nextValue as string[];
        setSelectedDepts((previous) => (arraysEqual(previous, nextDepts) ? previous : nextDepts));
      },
      write: (params) => {
        const serialized = serializeListParam(selectedDepts);
        if (serialized) params.set('departments', serialized);
        else params.delete('departments');
      },
      equals: (current, next) => arraysEqual(current as string[], next as string[]),
    },
    {
      current: filterMode,
      read: (params) => parseEnumParam(params.get('show'), FILTER_MODES, 'all'),
      sync: (nextValue) => {
        const nextFilterMode = nextValue as FilterMode;
        setFilterMode((previous) => (previous === nextFilterMode ? previous : nextFilterMode));
      },
      write: (params) => {
        if (filterMode !== 'all') params.set('show', filterMode);
        else params.delete('show');
      },
    },
    {
      current: sortKey,
      read: (params) => params.get('sortKey') || 'discrepancyCount',
      sync: (nextValue) => {
        const nextSortKey = nextValue as SortKey;
        setSortKey((previous) => (previous === nextSortKey ? previous : nextSortKey));
      },
      write: (params) => {
        if (sortKey !== 'discrepancyCount') params.set('sortKey', String(sortKey));
        else params.delete('sortKey');
      },
    },
    {
      current: sortDir,
      read: (params) => parseEnumParam(params.get('sortDir'), ['asc', 'desc'] as const, 'desc'),
      sync: (nextValue) => {
        const nextSortDir = nextValue as SortDir;
        setSortDir((previous) => (previous === nextSortDir ? previous : nextSortDir));
      },
      write: (params) => {
        if (sortDir !== 'desc') params.set('sortDir', sortDir);
        else params.delete('sortDir');
      },
    },
    {
      current: page,
      read: (params) => parsePageParam(params.get('page')),
      sync: (nextValue) => {
        const nextPage = nextValue as number;
        setPage((previous) => (previous === nextPage ? previous : nextPage));
      },
      write: (params) => {
        if (page > 0) params.set('page', String(page));
        else params.delete('page');
      },
    },
  ]), [departments, filterMode, page, search, selectedDepts, sortDir, sortKey]);

  useUrlStateSync({
    pathname: '/dashboard/timesheet-compare',
    router,
    searchParams,
    fields: syncedFields,
  });

  const toggleDept = (d: string) => {
    setSelectedDepts((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
    setPage(0);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' || key === 'department' ? 'asc' : 'desc'); }
    setPage(0);
  };

  const changeLookback = (val: string) => {
    if (val === 'custom') return;
    const weeksBack = Number(val);
    const range = getTrailingWeeksParamRange(weeksBack);
    const params = new URLSearchParams(searchParams.toString());
    params.set('lookbackWeeks', val);
    params.set('startDate', range.startDate);
    params.set('endDate', range.endDate);
    router.push(`/dashboard/timesheet-compare?${params.toString()}`);
  };

  const changeDates = (nextStart: string, nextEnd: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('lookbackWeeks');
    params.set('startDate', nextStart);
    params.set('endDate', nextEnd);
    router.push(`/dashboard/timesheet-compare?${params.toString()}`);
  };

  const hasFilters = search || selectedDepts.length > 0 || filterMode !== 'all';

  // Filter
  const filtered = useMemo(() => {
    let list = rows;
    if (selectedDepts.length > 0) {
      const deptSet = new Set(selectedDepts);
      list = list.filter((r) => deptSet.has(r.department));
    }
    if (filterMode === 'discrepancies') list = list.filter((r) => r.discrepancyCount > 0);
    else if (filterMode === 'bamboo-only') list = list.filter((r) =>
      Object.values(r.weeks).some((w) => w.bambooPtoDays > 0 && w.tbsPtoDays === 0 && w.hasDiscrepancy),
    );
    else if (filterMode === 'tbs-only') list = list.filter((r) =>
      Object.values(r.weeks).some((w) => w.tbsPtoDays > 0 && w.bambooPtoDays === 0 && w.hasDiscrepancy),
    );
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, selectedDepts, filterMode, search]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === 'name') return dir * a.name.localeCompare(b.name);
      if (sortKey === 'department') return dir * a.department.localeCompare(b.department);
      if (sortKey === 'discrepancyCount') return dir * (a.discrepancyCount - b.discrepancyCount);
      if (sortKey === 'totalBambooPto') return dir * (a.totalBambooPto - b.totalBambooPto);
      if (sortKey === 'totalTbsPto') return dir * (a.totalTbsPto - b.totalTbsPto);
      // Week column sort by discrepancy
      const aDisc = a.weeks[sortKey]?.hasDiscrepancy ? 1 : 0;
      const bDisc = b.weeks[sortKey]?.hasDiscrepancy ? 1 : 0;
      return dir * (aDisc - bDisc);
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Export CSV
  const exportCSV = () => {
    const headers = ['Employee', 'Email', 'Department', 'TBS#', ...weeks.map((w) =>
      parseLocalDate(w).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    ), 'Bamboo PTO', 'TBS PTO', 'Discrepancies'];

    const csvRows = sorted.map((r) => [
      r.name, r.email, r.department, String(r.tbsEmployeeNo),
      ...weeks.map((w) => {
        const cell = r.weeks[w];
        if (!cell) return '';
        if (cell.hasDiscrepancy) return 'DISC';
        if (cell.bambooPtoDays > 0 || cell.tbsPtoDays > 0) return 'OK';
        return '';
      }),
      String(r.totalBambooPto), String(r.totalTbsPto), String(r.discrepancyCount),
    ]);

    const csv = [headers.join(','), ...csvRows.map((row) => row.map((c) => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tbs-compare-${startDate}-${endDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const SortHeader = ({
    label,
    colKey,
    align = 'left',
  }: {
    label: string;
    colKey: SortKey;
    align?: 'left' | 'center' | 'right';
  }) => {
    const alignClass =
      align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
    return (
      <th
        className={`cursor-pointer select-none whitespace-nowrap px-3 py-3 ${alignClass} text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900`}
        onClick={() => handleSort(colKey)}
      >
        {label} {sortKey === colKey ? (sortDir === 'asc' ? '↑' : '↓') : ''}
      </th>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">TBS vs BambooHR Comparison</h2>
          <p className="mt-0.5 text-[12px] text-gray-500">
            Compares PTO entries between BambooHR and TBS timesheet system.
          </p>
          <p className="mt-1 text-[11px] text-gray-400">
            Applied: {activeQuickRange ? `Quick range (${activeQuickRange} weeks)` : 'Custom dates'} · {startDate} to {endDate}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
            CSV
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-[minmax(0,220px),minmax(0,180px),minmax(0,180px),1fr] md:items-end">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Quick Range</label>
          <select
            value={activeQuickRange ? String(activeQuickRange) : 'custom'}
            onChange={(e) => changeLookback(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
          >
            <option value="custom">Custom dates</option>
            {LOOKBACK_OPTIONS.map((w) => (
              <option key={w} value={w}>{w} weeks</option>
            ))}
          </select>
        </div>
        <label>
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Start</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => changeDates(e.target.value || startDate, endDate)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
          />
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">End</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => changeDates(startDate, e.target.value || endDate)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
          />
        </label>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Total Employees</p>
          <p className="mt-1 text-[22px] font-semibold text-gray-900">{summary.totalEmployees}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Mapped</p>
          <p className="mt-1 text-[22px] font-semibold text-green-600">{summary.mappedEmployees}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Unmapped</p>
          <p className={`mt-1 text-[22px] font-semibold ${summary.unmappedEmployees > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
            {summary.unmappedEmployees}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Discrepancies</p>
          <p className={`mt-1 text-[22px] font-semibold ${summary.totalDiscrepancies > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {summary.totalDiscrepancies}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Bamboo Only</p>
          <p className="mt-1 text-[22px] font-semibold text-blue-600">{summary.bambooPtoNotInTbs}</p>
          <p className="text-[10px] text-gray-400">PTO in Bamboo, missing in TBS</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">TBS Only</p>
          <p className="mt-1 text-[22px] font-semibold text-purple-600">{summary.tbsPtoNotInBamboo}</p>
          <p className="text-[10px] text-gray-400">PTO in TBS, missing in Bamboo</p>
        </div>
      </div>

      {/* Unmapped employees */}
      {unmappedEmails.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <button
            onClick={() => setUnmappedOpen((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <p className="text-[12px] font-medium text-amber-800">
              {unmappedEmails.length} employees not mapped to TBS — cannot compare
            </p>
            <span className="text-[10px] text-amber-600">{unmappedOpen ? '▲' : '▼'}</span>
          </button>
          {unmappedOpen && (
            <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
              {unmappedEmails.map((e) => (
                <p key={e} className="text-[11px] text-amber-700">{e}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="relative z-30 flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Name, email, or department..."
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-gray-300 focus:outline-none"
          />
        </div>
        {/* Filter mode */}
        <div className="w-full md:w-52">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Show</label>
          <select
            value={filterMode}
            onChange={(e) => { setFilterMode(e.target.value as FilterMode); setPage(0); }}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] focus:border-gray-300 focus:outline-none"
          >
            <option value="all">All Employees</option>
            <option value="discrepancies">Discrepancies Only</option>
            <option value="bamboo-only">Bamboo PTO Missing in TBS</option>
            <option value="tbs-only">TBS PTO Missing in Bamboo</option>
          </select>
        </div>
        {/* Department multiselect */}
        <div className="relative z-40 w-full md:w-52" ref={deptRef}>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Department</label>
          <button
            type="button"
            onClick={() => setDeptOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px]"
          >
            <span className={selectedDepts.length === 0 ? 'text-gray-500' : 'text-gray-700'}>
              {selectedDepts.length === 0 ? 'All Departments' : `${selectedDepts.length} selected`}
            </span>
            <span className="text-[10px] text-gray-400">▼</span>
          </button>
          {deptOpen && (
            <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {departments.map((d) => (
                <label key={d} className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50">
                  <input type="checkbox" checked={selectedDepts.includes(d)} onChange={() => toggleDept(d)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900" />
                  <span className="text-[12px] text-gray-600">{d}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {hasFilters && (
          <button
            onClick={() => { setSearch(''); setSelectedDepts([]); setFilterMode('all'); setPage(0); }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </div>

      {/* Count + pagination info */}
      <div className="flex items-center justify-between text-[12px] text-gray-500">
        <span>{sorted.length} employees {hasFilters ? '(filtered)' : ''}</span>
        <span>Page {page + 1} of {totalPages}</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-white/95 [&_th]:backdrop-blur">
              <tr className="border-b border-gray-100">
                <th
                  className="sticky left-0 z-10 cursor-pointer select-none whitespace-nowrap bg-white px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900"
                  onClick={() => handleSort('name')}
                >
                  Employee {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
                <SortHeader label="Dept" colKey="department" />
                {weeks.map((w) => (
                  <th
                    key={w}
                    className="cursor-pointer select-none whitespace-nowrap px-2 py-3 text-center text-[10px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900"
                    onClick={() => handleSort(w)}
                  >
                    {parseLocalDate(w).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {sortKey === w ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
                <SortHeader label="B-PTO" colKey="totalBambooPto" align="center" />
                <SortHeader label="T-PTO" colKey="totalTbsPto" align="center" />
                <SortHeader label="Disc" colKey="discrepancyCount" align="center" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.map((row) => (
                <tr key={row.email || row.name} className="hover:bg-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2">
                    <p className="whitespace-nowrap text-[13px] font-medium text-gray-900">{row.name}</p>
                    <p className="text-[10px] text-gray-400">TBS #{row.tbsEmployeeNo}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[12px] text-gray-500">{row.department}</td>
                  {weeks.map((w) => {
                    const cell = row.weeks[w];
                    const color = getCellColor(cell);
                    const hasPto = cell && (cell.bambooPtoDays > 0 || cell.tbsPtoDays > 0);
                    return (
                      <td key={w} className="px-2 py-1.5 text-center">
                        {hasPto ? (
                          <div className="group relative inline-flex">
                            <span className={`inline-flex h-6 min-w-[1.5rem] cursor-default items-center justify-center rounded px-1 text-[10px] font-medium ${color}`}>
                              {cell.hasDiscrepancy ? '!' : '='}
                            </span>
                            {/* Tooltip */}
                            <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                              <div className="whitespace-nowrap text-left text-[11px]">
                                <div className="mb-1.5 flex gap-4 border-b border-gray-100 pb-1.5">
                                  <span className="text-blue-600 font-medium">Bamboo: {cell.bambooPtoDays}d</span>
                                  <span className="text-purple-600 font-medium">TBS: {cell.tbsPtoDays}d</span>
                                </div>
                                {cell.details.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {cell.details.map((d) => (
                                      <div key={d.date} className="flex items-center gap-2">
                                        <span className="w-7 font-medium text-gray-500">{d.dayLabel}</span>
                                        <span className="text-gray-400">{d.date.slice(5)}</span>
                                        {d.bambooHasPto && (
                                          <span className="rounded bg-blue-50 px-1 text-[9px] font-medium text-blue-700">B:{d.bambooType}</span>
                                        )}
                                        {d.tbsHasPto && (
                                          <span className="rounded bg-purple-50 px-1 text-[9px] font-medium text-purple-700">T:{d.tbsWorkCode}</span>
                                        )}
                                        {d.bambooHasPto && !d.tbsHasPto && d.tbsHours === 0 && (
                                          <span className="rounded bg-red-50 px-1 text-[9px] font-medium text-red-600">Missing in TBS</span>
                                        )}
                                        {!d.bambooHasPto && d.tbsHasPto && (
                                          <span className="rounded bg-red-50 px-1 text-[9px] font-medium text-red-600">Missing in Bamboo</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-gray-400">No details</div>
                                )}
                              </div>
                              <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-white" />
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-300">–</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-3 py-1.5 text-center text-[12px] font-medium text-blue-700">{row.totalBambooPto || '–'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-center text-[12px] font-medium text-purple-700">{row.totalTbsPto || '–'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-center">
                    {row.discrepancyCount > 0 ? (
                      <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
                        {row.discrepancyCount}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <div className="p-12 text-center text-[13px] text-gray-500">No employees match filters.</div>
          )}
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            Previous
          </button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const p = totalPages <= 7 ? i : page <= 3 ? i : page >= totalPages - 4 ? totalPages - 7 + i : page - 3 + i;
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-medium ${p === page ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {p + 1}
              </button>
            );
          })}
          <button
            disabled={page === totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 rounded bg-green-100 text-center text-[9px] leading-4 font-bold text-green-700">=</span> PTO matches both</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 rounded bg-red-100 text-center text-[9px] leading-4 font-bold text-red-700">!</span> Discrepancy</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 rounded bg-blue-100 text-center text-[9px] leading-4 font-bold text-blue-700">=</span> PTO in one system</span>
        <span className="flex items-center gap-1.5"><span className="text-gray-300">–</span> No PTO</span>
      </div>
    </div>
  );
}

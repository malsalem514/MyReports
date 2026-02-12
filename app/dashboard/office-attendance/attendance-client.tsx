'use client';

import { useState, useMemo, useRef, useEffect, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { OFFICE_DAYS_REQUIRED, LOOKBACK_OPTIONS, CELL_COLORS, CELL_HEX } from '@/lib/constants';
import { validateAttendanceData, type ValidationResult } from './actions';

// --- Types (exported for server component) ---

export interface DayDetail {
  date: string;       // YYYY-MM-DD
  dayLabel: string;   // "Mon", "Tue", etc.
  location: 'Office' | 'Remote' | 'PTO' | 'Unknown';
}

export interface WeekCell {
  officeDays: number;
  remoteDays: number;
  ptoDays: number;
  days: DayDetail[];
}

export interface AttendanceRow {
  email: string;
  name: string;
  department: string;
  officeLocation: string;
  weeks: Record<string, WeekCell>;
  total: number;
  avgPerWeek: number;
  compliant: boolean;
  trend: 'up' | 'down' | 'flat';
}

export interface AttendanceSummary {
  totalEmployees: number;
  avgOfficeDays: number;
  complianceRate: number;
  zeroAttendanceCount: number;
}

interface Props {
  rows: AttendanceRow[];
  weeks: string[];
  departments: string[];
  locations: string[];
  summary: AttendanceSummary;
  lookbackWeeks: number;
}

type SortKey = 'name' | 'department' | 'officeLocation' | 'total' | 'avgPerWeek' | 'trend' | string;
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;

/** Parse YYYY-MM-DD as local date (avoids UTC timezone shift) */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function getCellColor(officeDays: number, ptoDays: number): string {
  if (ptoDays > 0 && officeDays < OFFICE_DAYS_REQUIRED) return CELL_COLORS.pto;
  if (officeDays >= OFFICE_DAYS_REQUIRED) return CELL_COLORS.compliant;
  if (officeDays >= 1) return CELL_COLORS.partial;
  return CELL_COLORS.absent;
}

function getCellHex(officeDays: number, ptoDays: number): string {
  if (ptoDays > 0 && officeDays < OFFICE_DAYS_REQUIRED) return CELL_HEX.pto;
  if (officeDays >= OFFICE_DAYS_REQUIRED) return CELL_HEX.compliant;
  if (officeDays >= 1) return CELL_HEX.partial;
  return CELL_HEX.absent;
}

export function AttendanceClient({ rows, weeks, departments, locations, summary, lookbackWeeks }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState('');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [selectedLocs, setSelectedLocs] = useState<string[]>([]);
  const [deptOpen, setDeptOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const deptRef = useRef<HTMLDivElement>(null);
  const locRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) setDeptOpen(false);
      if (locRef.current && !locRef.current.contains(e.target as Node)) setLocOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleDept = (d: string) => {
    setSelectedDepts((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
    setPage(0);
  };
  const toggleLoc = (l: string) => {
    setSelectedLocs((prev) => prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]);
    setPage(0);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' || key === 'department' || key === 'officeLocation' ? 'asc' : 'desc'); }
    setPage(0);
  };

  const changeLookback = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('lookbackWeeks', val);
    router.push(`/dashboard/office-attendance?${params.toString()}`);
  };

  const hasFilters = search || selectedDepts.length > 0 || selectedLocs.length > 0;

  // Filter
  const filtered = useMemo(() => {
    let list = rows;
    if (selectedDepts.length > 0) {
      const deptSet = new Set(selectedDepts);
      list = list.filter((r) => deptSet.has(r.department));
    }
    if (selectedLocs.length > 0) {
      const locSet = new Set(selectedLocs);
      list = list.filter((r) => locSet.has(r.officeLocation));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, selectedDepts, selectedLocs, search]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === 'name') return dir * a.name.localeCompare(b.name);
      if (sortKey === 'department') return dir * a.department.localeCompare(b.department);
      if (sortKey === 'officeLocation') return dir * a.officeLocation.localeCompare(b.officeLocation);
      if (sortKey === 'total') return dir * (a.total - b.total);
      if (sortKey === 'avgPerWeek') return dir * (a.avgPerWeek - b.avgPerWeek);
      if (sortKey === 'trend') {
        const order = { up: 2, flat: 1, down: 0 };
        return dir * (order[a.trend] - order[b.trend]);
      }
      // Week column sort
      const aDays = a.weeks[sortKey]?.officeDays ?? 0;
      const bDays = b.weeks[sortKey]?.officeDays ?? 0;
      return dir * (aDays - bDays);
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // --- Export helpers ---
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const headers = ['Employee', 'Email', 'Department', 'Location', ...weeks.map((w) =>
      new Date(w).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    ), 'Total', 'Avg/Week', 'Compliant', 'Trend'];

    const csvRows = sorted.map((r) => [
      r.name, r.email, r.department, r.officeLocation,
      ...weeks.map((w) => String(r.weeks[w]?.officeDays ?? 0)),
      String(r.total), String(r.avgPerWeek),
      r.compliant ? 'Yes' : 'No', r.trend,
    ]);

    const csv = [headers.join(','), ...csvRows.map((row) => row.map((c) => `"${c}"`).join(','))].join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `office-attendance-${lookbackWeeks}w.csv`);
  };

  const exportXLSX = async () => {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Office Attendance');

    const headers = ['Employee', 'Email', 'Department', 'Location', ...weeks.map((w) =>
      new Date(w).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    ), 'Total', 'Avg/Week', 'Compliant', 'Trend'];

    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true, size: 11 };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
    });

    // Summary row (must match header column count: Employee, Email, Department, Location, ...weeks, Total, Avg, Compliant, Trend)
    const summaryRow = ws.addRow([
      `${summary.totalEmployees} employees`,
      '',
      `${summary.complianceRate}% compliant`,
      '', // Location column
      ...weeks.map(() => ''),
      '',
      String(summary.avgOfficeDays),
      `${summary.zeroAttendanceCount} zero-attendance`,
      '',
    ]);
    summaryRow.font = { italic: true, size: 10, color: { argb: '6B7280' } };

    for (const r of sorted) {
      const row = ws.addRow([
        r.name, r.email, r.department, r.officeLocation,
        ...weeks.map((w) => r.weeks[w]?.officeDays ?? 0),
        r.total, r.avgPerWeek,
        r.compliant ? 'Yes' : 'No', r.trend,
      ]);

      // Color week cells
      weeks.forEach((w, i) => {
        const cell = row.getCell(5 + i); // 1-indexed, after name/email/dept/location
        const wc = r.weeks[w];
        const hex = getCellHex(wc?.officeDays ?? 0, wc?.ptoDays ?? 0);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex } };
      });
    }

    // Auto-width
    ws.columns.forEach((col) => {
      col.width = 14;
    });
    if (ws.columns[0]) ws.columns[0].width = 24;

    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `office-attendance-${lookbackWeeks}w.xlsx`);
  };

  const SortHeader = ({ label, colKey, align = 'left' }: { label: string; colKey: SortKey; align?: string }) => (
    <th
      className={`cursor-pointer select-none whitespace-nowrap bg-white px-3 py-3 text-${align} text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900`}
      onClick={() => handleSort(colKey)}
    >
      {label} {sortKey === colKey ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">Office Attendance</h2>
          <p className="mt-0.5 text-[12px] text-gray-500">
            Last {lookbackWeeks} weeks — office days per week (min {OFFICE_DAYS_REQUIRED} required)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={lookbackWeeks}
            onChange={(e) => changeLookback(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] text-gray-600 focus:border-gray-300 focus:outline-none"
          >
            {LOOKBACK_OPTIONS.map((w) => (
              <option key={w} value={w}>{w} weeks</option>
            ))}
          </select>
          <button onClick={exportCSV}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
            CSV
          </button>
          <button onClick={exportXLSX}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
            XLSX
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
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
        {/* Location multiselect */}
        <div className="relative w-full md:w-52" ref={locRef}>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Location</label>
          <button
            type="button"
            onClick={() => { setLocOpen((v) => !v); setDeptOpen(false); }}
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px]"
          >
            <span className={selectedLocs.length === 0 ? 'text-gray-500' : 'text-gray-700'}>
              {selectedLocs.length === 0 ? 'All Locations' : `${selectedLocs.length} selected`}
            </span>
            <span className="text-[10px] text-gray-400">▼</span>
          </button>
          {locOpen && (
            <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {locations.map((l) => (
                <label key={l} className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50">
                  <input type="checkbox" checked={selectedLocs.includes(l)} onChange={() => toggleLoc(l)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900" />
                  <span className="text-[12px] text-gray-600">{l}</span>
                </label>
              ))}
              {locations.length === 0 && <p className="px-3 py-2 text-[12px] text-gray-400">No locations</p>}
            </div>
          )}
        </div>
        {/* Department multiselect */}
        <div className="relative w-full md:w-52" ref={deptRef}>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Department</label>
          <button
            type="button"
            onClick={() => { setDeptOpen((v) => !v); setLocOpen(false); }}
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px]"
          >
            <span className={selectedDepts.length === 0 ? 'text-gray-500' : 'text-gray-700'}>
              {selectedDepts.length === 0 ? 'All Departments' : `${selectedDepts.length} selected`}
            </span>
            <span className="text-[10px] text-gray-400">▼</span>
          </button>
          {deptOpen && (
            <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
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
            onClick={() => { setSearch(''); setSelectedDepts([]); setSelectedLocs([]); setPage(0); }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Employees</p>
          <p className="mt-1 text-[22px] font-semibold text-gray-900">{summary.totalEmployees}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Avg Days/Week</p>
          <p className="mt-1 text-[22px] font-semibold text-gray-900">{summary.avgOfficeDays}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Compliance</p>
          <p className={`mt-1 text-[22px] font-semibold ${summary.complianceRate >= 80 ? 'text-green-600' : summary.complianceRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
            {summary.complianceRate}%
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Zero Attendance</p>
          <p className={`mt-1 text-[22px] font-semibold ${summary.zeroAttendanceCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {summary.zeroAttendanceCount}
          </p>
        </div>
      </div>

      {/* Validation */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (validation) { setValidationOpen((v) => !v); return; }
            startTransition(async () => {
              const result = await validateAttendanceData(lookbackWeeks);
              setValidation(result);
              setValidationOpen(true);
            });
          }}
          disabled={isPending}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {isPending ? 'Validating...' : validation ? (validationOpen ? 'Hide Validation' : 'Show Validation') : 'Validate vs ActivTrak'}
        </button>
        {validation && !validationOpen ? (
          validation.discrepancies.length === 0
            ? <span className="text-[12px] font-medium text-green-600">All 3 sources match</span>
            : <span className="text-[12px] font-medium text-amber-600">{validation.discrepancies.length} discrepancies found</span>
        ) : null}
      </div>

      {validationOpen && validation && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-6 py-4">
            <h3 className="text-[13px] font-semibold text-gray-900">3-Source Validation — ActivTrak vs Oracle vs BambooHR</h3>
            <p className="mt-0.5 text-[11px] text-gray-500">{validation.rangeStart} to {validation.rangeEnd}</p>
          </div>

          {/* Source metrics */}
          <div className="grid gap-4 border-b border-gray-100 p-4 sm:grid-cols-3">
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
              <p className="text-[11px] font-medium text-blue-700">ActivTrak (Source)</p>
              <p className="text-[18px] font-semibold text-gray-900">{validation.activtrak.totalRecords.toLocaleString()}</p>
              <p className="text-[11px] text-gray-500">{validation.activtrak.uniqueEmployees} employees</p>
              <div className="mt-1 flex gap-3 text-[10px] text-gray-400">
                <span>{validation.activtrak.officeDays} office</span>
                <span>{validation.activtrak.remoteDays} remote</span>
                {validation.activtrak.unknownDays > 0 && <span>{validation.activtrak.unknownDays} unknown</span>}
              </div>
            </div>
            <div className="rounded-lg border border-purple-100 bg-purple-50 p-3">
              <p className="text-[11px] font-medium text-purple-700">Oracle (Synced)</p>
              <p className="text-[18px] font-semibold text-gray-900">{validation.oracle.totalRecords.toLocaleString()}</p>
              <p className="text-[11px] text-gray-500">{validation.oracle.uniqueEmployees} employees</p>
              <div className="mt-1 flex gap-3 text-[10px] text-gray-400">
                <span>{validation.oracle.officeDays} office</span>
                <span>{validation.oracle.remoteDays} remote</span>
                {validation.oracle.unknownDays > 0 && <span>{validation.oracle.unknownDays} unknown</span>}
              </div>
            </div>
            <div className="rounded-lg border border-green-100 bg-green-50 p-3">
              <p className="text-[11px] font-medium text-green-700">BambooHR (Directory)</p>
              <p className="text-[18px] font-semibold text-gray-900">{validation.bamboo.activeEmployees}</p>
              <p className="text-[11px] text-gray-500">active employees</p>
              <p className="mt-1 text-[10px] text-gray-400">{validation.bamboo.withPTO} with PTO in range</p>
            </div>
          </div>

          {/* Match summary */}
          <div className="grid gap-4 border-b border-gray-100 p-4 sm:grid-cols-5">
            <div className="text-center">
              <p className="text-[10px] text-gray-500">Record Diff</p>
              <p className={`text-[14px] font-semibold ${validation.activtrak.totalRecords === validation.oracle.totalRecords ? 'text-green-600' : 'text-amber-600'}`}>
                {validation.oracle.totalRecords - validation.activtrak.totalRecords >= 0 ? '+' : ''}{validation.oracle.totalRecords - validation.activtrak.totalRecords}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-gray-500">Discrepancies</p>
              <p className={`text-[14px] font-semibold ${validation.discrepancies.length === 0 ? 'text-green-600' : 'text-amber-600'}`}>
                {validation.discrepancies.length}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-gray-500">ActivTrak Only</p>
              <p className={`text-[14px] font-semibold ${validation.activtrakOnlyEmails.length === 0 ? 'text-green-600' : 'text-red-600'}`}>
                {validation.activtrakOnlyEmails.length}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-gray-500">Not in Bamboo</p>
              <p className={`text-[14px] font-semibold ${validation.notInBamboo.length === 0 ? 'text-green-600' : 'text-amber-600'}`}>
                {validation.notInBamboo.length}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-gray-500">Ghost (0 records)</p>
              <p className="text-[14px] font-semibold text-gray-500">
                {validation.ghostEmployees.length}
              </p>
            </div>
          </div>

          {/* Discrepancy table */}
          {validation.discrepancies.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-20 bg-white">
                  <tr className="border-b border-gray-100">
                    <th className="bg-white px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500">Employee</th>
                    <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500">Dept</th>
                    <th className="px-3 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-blue-600" colSpan={2}>ActivTrak</th>
                    <th className="px-3 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-purple-600" colSpan={2}>Oracle</th>
                    <th className="px-3 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-gray-500">Diff</th>
                    <th className="px-3 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-gray-500">Flags</th>
                  </tr>
                  <tr className="border-b border-gray-50">
                    <th></th><th></th>
                    <th className="px-2 py-1 text-center text-[9px] text-gray-400">Office</th>
                    <th className="px-2 py-1 text-center text-[9px] text-gray-400">Remote</th>
                    <th className="px-2 py-1 text-center text-[9px] text-gray-400">Office</th>
                    <th className="px-2 py-1 text-center text-[9px] text-gray-400">Remote</th>
                    <th></th><th></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {validation.discrepancies.map((d) => (
                    <tr key={d.email} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <p className="text-[12px] font-medium text-gray-900">{d.name}</p>
                        <p className="text-[10px] text-gray-400">{d.email}</p>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-gray-500">{d.department}</td>
                      <td className="px-3 py-2 text-center text-[12px] text-blue-700">{d.activtrak.office}</td>
                      <td className="px-3 py-2 text-center text-[12px] text-blue-400">{d.activtrak.remote}</td>
                      <td className="px-3 py-2 text-center text-[12px] text-purple-700">{d.oracle.office}</td>
                      <td className="px-3 py-2 text-center text-[12px] text-purple-400">{d.oracle.remote}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-[12px] font-semibold ${d.diff > 0 ? 'text-green-600' : d.diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                          {d.diff > 0 ? '+' : ''}{d.diff}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center space-x-1">
                        {d.locationMismatch && <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">LOC</span>}
                        {!d.inBamboo && <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-700">NO-HR</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validation.discrepancies.length >= 50 && (
                <p className="border-t border-gray-100 p-3 text-center text-[11px] text-gray-400">Showing top 50 discrepancies by magnitude</p>
              )}
            </div>
          )}

          {/* Email lists */}
          {(validation.activtrakOnlyEmails.length > 0 || validation.oracleOnlyEmails.length > 0 || validation.notInBamboo.length > 0 || validation.ghostEmployees.length > 0) && (
            <div className="grid gap-4 border-t border-gray-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {validation.activtrakOnlyEmails.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-medium text-red-600">ActivTrak Only ({validation.activtrakOnlyEmails.length})</p>
                  <div className="space-y-0.5">
                    {validation.activtrakOnlyEmails.map((e) => <p key={e} className="text-[10px] text-gray-600">{e}</p>)}
                  </div>
                </div>
              )}
              {validation.oracleOnlyEmails.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-medium text-amber-600">Oracle Only ({validation.oracleOnlyEmails.length})</p>
                  <div className="space-y-0.5">
                    {validation.oracleOnlyEmails.map((e) => <p key={e} className="text-[10px] text-gray-600">{e}</p>)}
                  </div>
                </div>
              )}
              {validation.notInBamboo.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-medium text-red-600">Not in BambooHR ({validation.notInBamboo.length})</p>
                  <div className="space-y-0.5">
                    {validation.notInBamboo.map((e) => <p key={e} className="text-[10px] text-gray-600">{e}</p>)}
                  </div>
                </div>
              )}
              {validation.ghostEmployees.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-medium text-gray-500">Ghost Employees ({validation.ghostEmployees.length})</p>
                  <p className="mb-1 text-[9px] text-gray-400">In BambooHR but 0 records in ActivTrak & Oracle</p>
                  <div className="space-y-0.5">
                    {validation.ghostEmployees.map((e) => <p key={e} className="text-[10px] text-gray-600">{e}</p>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Count + pagination info */}
      <div className="flex items-center justify-between text-[12px] text-gray-500">
        <span>{sorted.length} employees {hasFilters ? '(filtered)' : ''}</span>
        <span>Page {page + 1} of {totalPages}</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="border-b border-gray-100">
                <th
                  className="sticky left-0 z-30 cursor-pointer select-none whitespace-nowrap bg-white px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900"
                  onClick={() => handleSort('name')}
                >
                  Employee {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
                <SortHeader label="Dept" colKey="department" />
                <SortHeader label="Location" colKey="officeLocation" />
                {weeks.map((w) => (
                  <th
                    key={w}
                    className="cursor-pointer select-none whitespace-nowrap bg-white px-2 py-3 text-center text-[10px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900"
                    onClick={() => handleSort(w)}
                  >
                    {parseLocalDate(w).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {sortKey === w ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
                <SortHeader label="Total" colKey="total" align="center" />
                <SortHeader label="Avg" colKey="avgPerWeek" align="center" />
                <th className="whitespace-nowrap bg-white px-3 py-3 text-center text-[11px] font-medium uppercase tracking-wider text-gray-500">Status</th>
                <SortHeader label="Trend" colKey="trend" align="center" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.map((row) => (
                <tr key={row.email} className="hover:bg-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2 group-hover:bg-gray-50">
                    <Link href={`/dashboard/employee/${encodeURIComponent(row.email)}`} className="whitespace-nowrap text-[13px] font-medium text-gray-900 hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[12px] text-gray-500">{row.department}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[12px] text-gray-500">{row.officeLocation}</td>
                  {weeks.map((w) => {
                    const cell = row.weeks[w];
                    const office = cell?.officeDays ?? 0;
                    const remote = cell?.remoteDays ?? 0;
                    const pto = cell?.ptoDays ?? 0;
                    const color = getCellColor(office, pto);
                    return (
                      <td key={w} className="px-2 py-1.5 text-center">
                        <div className="group relative inline-flex">
                          <span className={`inline-flex h-6 w-6 cursor-default items-center justify-center rounded text-[11px] font-medium ${color}`}>
                            {office}
                          </span>
                          <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                            <div className="whitespace-nowrap text-left text-[11px]">
                              {cell && cell.days.length > 0 ? (
                                <div className="space-y-0.5">
                                  {cell.days.map((d) => (
                                    <div key={d.date} className="flex items-center gap-2">
                                      <span className={`inline-block h-2 w-2 rounded-full ${
                                        d.location === 'Office' ? 'bg-green-500' :
                                        d.location === 'Remote' ? 'bg-gray-400' :
                                        d.location === 'PTO' ? 'bg-blue-500' : 'bg-amber-400'
                                      }`} />
                                      <span className="w-7 font-medium text-gray-500">{d.dayLabel}</span>
                                      <span className="text-gray-400">{d.date.slice(5)}</span>
                                      <span className={`ml-auto font-semibold ${
                                        d.location === 'Office' ? 'text-green-700' :
                                        d.location === 'Remote' ? 'text-gray-500' :
                                        d.location === 'PTO' ? 'text-blue-600' : 'text-amber-600'
                                      }`}>{d.location}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-gray-400">No activity</div>
                              )}
                            </div>
                            <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-white" />
                          </div>
                        </div>
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-3 py-1.5 text-center text-[13px] font-semibold text-gray-900">{row.total}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-center text-[12px] text-gray-600">{row.avgPerWeek}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-center">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${row.compliant ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                      {row.compliant ? 'Compliant' : 'Non-Compliant'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-center text-[14px]">
                    {row.trend === 'up' ? <span className="text-green-600">↑</span> :
                     row.trend === 'down' ? <span className="text-red-600">↓</span> :
                     <span className="text-gray-400">–</span>}
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
        <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.compliant}`} /> {OFFICE_DAYS_REQUIRED}+ days</span>
        <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.partial}`} /> 1 day</span>
        <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.absent}`} /> 0 days</span>
        <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.pto}`} /> PTO week</span>
      </div>
    </div>
  );
}

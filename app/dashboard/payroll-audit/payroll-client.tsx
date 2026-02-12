'use client';

import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  PayrollWeekGroup,
  PayrollEmployeeTotal,
  PayrollGrandTotal,
} from '@/lib/dashboard-data';

const PAYROLL_LOOKBACK_OPTIONS = [2, 4, 6, 8, 12, 16];

interface Props {
  weeks: PayrollWeekGroup[];
  grandTotal: PayrollGrandTotal;
  lookbackWeeks: number;
  departments: string[];
  managers: string[];
}

const PAGE_SIZE = 50; // employees per page across all weeks

type SortKey = 'name' | 'department' | 'reportingTo' | 'jobTitle' | 'tbsReported' | 'tbsAbsence' | 'totalTbs' | 'bambooHours' | 'discrepancy';
type SortDir = 'asc' | 'desc';

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function formatWeekLabel(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  const end = new Date(d);
  end.setDate(d.getDate() + 4); // Friday
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function formatDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getDiscColor(disc: number | null): string {
  if (disc == null) return '';
  if (disc < -2) return 'text-red-600 font-semibold';
  if (disc < 0) return 'text-orange-600';
  if (disc === 0) return 'text-green-600';
  if (disc > 2) return 'text-blue-600 font-semibold';
  return 'text-blue-500';
}

function getDiscBadge(disc: number | null): string {
  if (disc == null) return '';
  if (Math.abs(disc) <= 1) return 'bg-green-50 text-green-600';
  if (disc < -2) return 'bg-red-50 text-red-600';
  if (disc < 0) return 'bg-amber-50 text-amber-600';
  return 'bg-blue-50 text-blue-600';
}

export function PayrollClient({ weeks, grandTotal, lookbackWeeks, departments, managers }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState('');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [selectedManagers, setSelectedManagers] = useState<string[]>([]);
  const [deptOpen, setDeptOpen] = useState(false);
  const [mgrOpen, setMgrOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  // Expand state: weeks and employees both start collapsed
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [expandedEmps, setExpandedEmps] = useState<Set<string>>(new Set()); // key: `${week}|${email}`

  const deptRef = useRef<HTMLDivElement>(null);
  const mgrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) setDeptOpen(false);
      if (mgrRef.current && !mgrRef.current.contains(e.target as Node)) setMgrOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleDept = (d: string) => {
    setSelectedDepts((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  };
  const toggleMgr = (m: string) => {
    setSelectedManagers((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  };

  const changeLookback = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('lookbackWeeks', val);
    router.push(`/dashboard/payroll-audit?${params.toString()}`);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' || key === 'department' || key === 'reportingTo' || key === 'jobTitle' ? 'asc' : 'desc'); }
  };

  const toggleWeek = (week: string) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(week)) next.delete(week);
      else next.add(week);
      return next;
    });
  };

  const toggleEmp = (key: string) => {
    setExpandedEmps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    const allWeeks = new Set(filteredWeeks.map((w) => w.week));
    const allEmps = new Set<string>();
    for (const wg of filteredWeeks) {
      for (const emp of wg.employees) allEmps.add(`${wg.week}|${emp.email}`);
    }
    setExpandedWeeks(allWeeks);
    setExpandedEmps(allEmps);
  };

  const collapseAll = () => {
    setExpandedWeeks(new Set());
    setExpandedEmps(new Set());
  };

  const isAllExpanded = expandedWeeks.size > 0 && expandedWeeks.size === weeks.length;

  const hasFilters = search || selectedDepts.length > 0 || selectedManagers.length > 0;

  // Filter employees within each week
  const filteredWeeks = useMemo(() => {
    return weeks.map((wg) => {
      let list = wg.employees;
      if (selectedDepts.length > 0) {
        const deptSet = new Set(selectedDepts);
        list = list.filter((r) => deptSet.has(r.department));
      }
      if (selectedManagers.length > 0) {
        const mgrSet = new Set(selectedManagers);
        list = list.filter((r) => mgrSet.has(r.reportingTo));
      }
      if (search) {
        const q = search.toLowerCase();
        list = list.filter((r) =>
          r.name.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.department.toLowerCase().includes(q),
        );
      }
      // Sort
      const arr = [...list];
      const dir = sortDir === 'asc' ? 1 : -1;
      arr.sort((a, b) => {
        if (sortKey === 'name') return dir * a.name.localeCompare(b.name);
        if (sortKey === 'department') return dir * a.department.localeCompare(b.department);
        if (sortKey === 'reportingTo') return dir * a.reportingTo.localeCompare(b.reportingTo);
        if (sortKey === 'jobTitle') return dir * a.jobTitle.localeCompare(b.jobTitle);
        if (sortKey === 'tbsReported') return dir * (a.tbsReported - b.tbsReported);
        if (sortKey === 'tbsAbsence') return dir * (a.tbsAbsence - b.tbsAbsence);
        if (sortKey === 'totalTbs') return dir * (a.totalTbs - b.totalTbs);
        if (sortKey === 'bambooHours') return dir * ((a.bambooHours ?? 0) - (b.bambooHours ?? 0));
        if (sortKey === 'discrepancy') return dir * ((a.discrepancy ?? 0) - (b.discrepancy ?? 0));
        return 0;
      });

      // Recalculate subtotal for filtered set
      const subtotal = { tbsReported: 0, tbsAbsence: 0, totalTbs: 0, bambooHours: 0, discrepancy: 0 };
      for (const e of arr) {
        subtotal.tbsReported += e.tbsReported;
        subtotal.tbsAbsence += e.tbsAbsence;
        subtotal.totalTbs += e.totalTbs;
        subtotal.bambooHours += e.bambooHours ?? 0;
        subtotal.discrepancy += e.discrepancy ?? 0;
      }

      return { ...wg, employees: arr, subtotal };
    }).filter((wg) => wg.employees.length > 0);
  }, [weeks, selectedDepts, selectedManagers, search, sortKey, sortDir]);

  // Filtered grand total
  const filteredTotal = useMemo(() => {
    const t = { tbsReported: 0, tbsAbsence: 0, totalTbs: 0, bambooHours: 0, discrepancy: 0 };
    for (const wg of filteredWeeks) {
      t.tbsReported += wg.subtotal.tbsReported;
      t.tbsAbsence += wg.subtotal.tbsAbsence;
      t.totalTbs += wg.subtotal.totalTbs;
      t.bambooHours += wg.subtotal.bambooHours;
      t.discrepancy += wg.subtotal.discrepancy;
    }
    return t;
  }, [filteredWeeks]);

  const totalEmployees = useMemo(() => {
    const emails = new Set<string>();
    for (const wg of filteredWeeks) for (const e of wg.employees) emails.add(e.email);
    return emails.size;
  }, [filteredWeeks]);

  // Helpers
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const headers = [
      'Activity Week', 'Name', 'TBS_ENTRY_DATE', 'Day',
      'TBS Reported', 'TBS ABSENCE', 'TOTAL_TBS',
      'BAMBOO_HOURS', 'TBS_BAMBOO_DISCREPANCY',
      'REPORTING_TO', 'JOB_TITLE',
    ];
    const csvRows = [headers.join(',')];

    for (const wg of filteredWeeks) {
      // Week subtotal
      csvRows.push([
        wg.week, '"Week Total"', '', '',
        wg.subtotal.tbsReported, wg.subtotal.tbsAbsence, wg.subtotal.totalTbs,
        wg.subtotal.bambooHours, wg.subtotal.discrepancy, '', '',
      ].join(','));

      for (const emp of wg.employees) {
        csvRows.push([
          wg.week, `"${emp.name}"`, '"Total"', '',
          emp.tbsReported, emp.tbsAbsence, emp.totalTbs,
          emp.bambooHours ?? '', emp.discrepancy ?? '',
          `"${emp.reportingTo}"`, `"${emp.jobTitle}"`,
        ].join(','));

        for (const day of emp.days) {
          csvRows.push([
            wg.week, `"${emp.name}"`, day.date, day.dayLabel,
            day.tbsReported, day.tbsAbsence, day.totalTbs,
            day.bambooHours ?? '', day.discrepancy ?? '',
            `"${emp.reportingTo}"`, `"${emp.jobTitle}"`,
          ].join(','));
        }
      }
    }

    downloadBlob(new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' }), `payroll-audit-${lookbackWeeks}w.csv`);
  };

  const exportXLSX = async () => {
    try {
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Payroll Audit');

      const headers = [
        'Activity Week', 'Name', 'TBS_ENTRY_DATE', 'Day',
        'TBS Reported', 'TBS ABSENCE', 'TOTAL_TBS',
        'BAMBOO_HOURS', 'TBS_BAMBOO_DISCREPANCY',
        'REPORTING_TO', 'JOB_TITLE',
      ];
      const hdrRow = ws.addRow(headers);
      hdrRow.font = { bold: true, size: 11 };
      hdrRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      });

      for (const wg of filteredWeeks) {
        // Week header row
        const wkRow = ws.addRow([formatWeekLabel(wg.week), 'Week Total', '', null,
          wg.subtotal.tbsReported, wg.subtotal.tbsAbsence, wg.subtotal.totalTbs,
          wg.subtotal.bambooHours, wg.subtotal.discrepancy, '', '']);
        wkRow.font = { bold: true, size: 11 };
        wkRow.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
        });

        for (const emp of wg.employees) {
          const subRow = ws.addRow([
            wg.week, emp.name, 'Total', null,
            emp.tbsReported, emp.tbsAbsence, emp.totalTbs,
            emp.bambooHours, emp.discrepancy, emp.reportingTo, emp.jobTitle,
          ]);
          subRow.font = { bold: true, size: 10 };
          subRow.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
          });

          for (const day of emp.days) {
            const dayRow = ws.addRow([
              wg.week, emp.name, day.date, day.dayLabel,
              day.tbsReported, day.tbsAbsence, day.totalTbs,
              day.bambooHours, day.discrepancy, emp.reportingTo, emp.jobTitle,
            ]);
            dayRow.font = { size: 10 };
            const discCell = dayRow.getCell(9);
            if (day.discrepancy != null && day.discrepancy < 0) {
              discCell.font = { size: 10, color: { argb: 'FFDC2626' } };
            } else if (day.discrepancy != null && day.discrepancy > 0) {
              discCell.font = { size: 10, color: { argb: 'FF2563EB' } };
            }
          }
        }
      }

      ws.getColumn(1).width = 14;
      ws.getColumn(2).width = 24;
      ws.getColumn(3).width = 14;
      ws.getColumn(4).width = 12;
      for (let i = 5; i <= 9; i++) ws.getColumn(i).width = 14;
      ws.getColumn(10).width = 24;
      ws.getColumn(11).width = 30;

      const buffer = await wb.xlsx.writeBuffer();
      downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `payroll-audit-${lookbackWeeks}w.xlsx`);
    } catch {
      exportCSV();
    }
  };

  const SortHeader = ({ label, colKey, align = 'left' }: { label: string; colKey: SortKey; align?: string }) => (
    <th
      className={`cursor-pointer select-none whitespace-nowrap bg-white px-3 py-3 text-${align} text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900`}
      onClick={() => handleSort(colKey)}
    >
      {label} {sortKey === colKey ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}
    </th>
  );

  // Summary stats
  const avgDiscrepancy = totalEmployees > 0 ? Math.round((filteredTotal.discrepancy / totalEmployees) * 10) / 10 : 0;
  const allEmps = filteredWeeks.flatMap((w) => w.employees);
  const overReporters = new Set(allEmps.filter((e) => (e.discrepancy ?? 0) > 2).map((e) => e.email)).size;
  const underReporters = new Set(allEmps.filter((e) => (e.discrepancy ?? 0) < -2).map((e) => e.email)).size;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">Payroll Audit</h2>
          <p className="mt-0.5 text-[12px] text-gray-500">
            Last {lookbackWeeks} weeks &mdash; {totalEmployees} employees &mdash; TBS vs BambooHR hours
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={lookbackWeeks}
            onChange={(e) => changeLookback(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] text-gray-600 focus:border-gray-300 focus:outline-none"
          >
            {PAYROLL_LOOKBACK_OPTIONS.map((w) => (
              <option key={w} value={w}>{w} weeks</option>
            ))}
          </select>
          <button
            onClick={isAllExpanded ? collapseAll : expandAll}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
          >
            {isAllExpanded ? 'Collapse All' : 'Expand All'}
          </button>
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email, or department..."
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-gray-300 focus:outline-none"
          />
        </div>
        <div className="relative w-full md:w-52" ref={mgrRef}>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Manager</label>
          <button
            type="button"
            onClick={() => { setMgrOpen((v) => !v); setDeptOpen(false); }}
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px]"
          >
            <span className={selectedManagers.length === 0 ? 'text-gray-500' : 'text-gray-700'}>
              {selectedManagers.length === 0 ? 'All Managers' : `${selectedManagers.length} selected`}
            </span>
            <span className="text-[10px] text-gray-400">{'\u25BC'}</span>
          </button>
          {mgrOpen && (
            <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {managers.map((m) => (
                <label key={m} className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50">
                  <input type="checkbox" checked={selectedManagers.includes(m)} onChange={() => toggleMgr(m)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900" />
                  <span className="text-[12px] text-gray-600">{m}</span>
                </label>
              ))}
              {managers.length === 0 && <p className="px-3 py-2 text-[12px] text-gray-400">No managers</p>}
            </div>
          )}
        </div>
        <div className="relative w-full md:w-52" ref={deptRef}>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Department</label>
          <button
            type="button"
            onClick={() => { setDeptOpen((v) => !v); setMgrOpen(false); }}
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px]"
          >
            <span className={selectedDepts.length === 0 ? 'text-gray-500' : 'text-gray-700'}>
              {selectedDepts.length === 0 ? 'All Departments' : `${selectedDepts.length} selected`}
            </span>
            <span className="text-[10px] text-gray-400">{'\u25BC'}</span>
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
            onClick={() => { setSearch(''); setSelectedDepts([]); setSelectedManagers([]); }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Employees</p>
          <p className="mt-1 text-[22px] font-semibold text-gray-900">{totalEmployees}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Total TBS Hours</p>
          <p className="mt-1 text-[22px] font-semibold text-gray-900">{filteredTotal.totalTbs.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Avg Discrepancy</p>
          <p className={`mt-1 text-[22px] font-semibold ${avgDiscrepancy === 0 ? 'text-green-600' : avgDiscrepancy < 0 ? 'text-red-600' : 'text-blue-600'}`}>
            {avgDiscrepancy > 0 ? '+' : ''}{avgDiscrepancy}h
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Outliers ({'>'}2h)</p>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-[22px] font-semibold text-red-600">{underReporters}</span>
            <span className="text-[11px] text-gray-400">under</span>
            <span className="text-[22px] font-semibold text-blue-600">{overReporters}</span>
            <span className="text-[11px] text-gray-400">over</span>
          </div>
        </div>
      </div>

      {/* Count */}
      <div className="flex items-center justify-between text-[12px] text-gray-500">
        <span>{filteredWeeks.length} weeks &middot; {totalEmployees} employees {hasFilters ? '(filtered)' : ''}</span>
      </div>

      {/* Table — Week → Employee → Day hierarchy */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse table-fixed">
            <colgroup>
              <col className="w-8" />
              <col className="w-[180px]" />
              <col className="w-[90px]" />
              <col className="w-[50px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[100px]" />
              <col className="w-[160px]" />
              <col className="w-[180px]" />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="border-b border-gray-100">
                <th className="bg-white px-2 py-2" />
                <th
                  className="sticky left-0 z-30 cursor-pointer select-none whitespace-nowrap bg-white px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900"
                  onClick={() => handleSort('name')}
                >
                  Name {sortKey === 'name' ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}
                </th>
                <th className="whitespace-nowrap bg-white px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Date</th>
                <th className="whitespace-nowrap bg-white px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Day</th>
                <SortHeader label="Reported" colKey="tbsReported" align="right" />
                <SortHeader label="Absence" colKey="tbsAbsence" align="right" />
                <SortHeader label="Total" colKey="totalTbs" align="right" />
                <SortHeader label="Bamboo" colKey="bambooHours" align="right" />
                <SortHeader label="Disc." colKey="discrepancy" align="right" />
                <SortHeader label="Manager" colKey="reportingTo" />
                <SortHeader label="Title" colKey="jobTitle" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {/* Grand Total Row */}
              <tr className="bg-blue-50">
                <td className="whitespace-nowrap px-2 py-2" />
                <td className="sticky left-0 z-10 whitespace-nowrap bg-blue-50 px-3 py-2 text-[12px] font-semibold text-gray-900">Grand Total</td>
                <td className="whitespace-nowrap px-2 py-2 text-[11px] text-gray-500">{filteredWeeks.length}w</td>
                <td className="whitespace-nowrap px-2 py-2" />
                <td className="whitespace-nowrap px-2 py-2 text-right text-[12px] font-semibold text-gray-900">{filteredTotal.tbsReported}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right text-[12px] font-semibold text-gray-900">{filteredTotal.tbsAbsence}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right text-[12px] font-semibold text-gray-900">{filteredTotal.totalTbs}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right text-[12px] font-semibold text-gray-700">{filteredTotal.bambooHours}</td>
                <td className={`whitespace-nowrap px-2 py-2 text-right text-[12px] font-semibold ${getDiscColor(filteredTotal.discrepancy)}`}>
                  {filteredTotal.discrepancy > 0 ? '+' : ''}{filteredTotal.discrepancy}
                </td>
                <td className="whitespace-nowrap px-2 py-2" />
                <td className="whitespace-nowrap px-2 py-2" />
              </tr>

              {filteredWeeks.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-12 text-center text-[13px] text-gray-500">
                    No data found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredWeeks.map((wg) => {
                  const weekExpanded = expandedWeeks.has(wg.week);
                  return (
                    <Fragment key={wg.week}>
                      {/* Week Header Row */}
                      <tr
                        className="cursor-pointer border-t-2 border-gray-200 bg-gray-100 hover:bg-gray-150"
                        onClick={() => toggleWeek(wg.week)}
                      >
                        <td className="whitespace-nowrap px-2 py-2 text-center text-[11px] text-gray-500">
                          {weekExpanded ? '\u25BC' : '\u25B6'}
                        </td>
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-gray-100 px-3 py-2" colSpan={2}>
                          <span className="text-[12px] font-semibold text-gray-900">{formatWeekLabel(wg.week)}</span>
                          <span className="ml-2 text-[10px] text-gray-500">{wg.employees.length}</span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2" />
                        <td className="whitespace-nowrap px-2 py-2 text-right text-[11px] font-semibold text-gray-900">{wg.subtotal.tbsReported}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right text-[11px] font-semibold text-gray-900">{wg.subtotal.tbsAbsence}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right text-[11px] font-semibold text-gray-900">{wg.subtotal.totalTbs}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right text-[11px] font-semibold text-gray-700">{wg.subtotal.bambooHours}</td>
                        <td className={`whitespace-nowrap px-2 py-2 text-right text-[11px] font-semibold ${getDiscColor(wg.subtotal.discrepancy)}`}>
                          {wg.subtotal.discrepancy > 0 ? '+' : ''}{wg.subtotal.discrepancy}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2" />
                        <td className="whitespace-nowrap px-2 py-2" />
                      </tr>

                      {/* Employee rows within this week */}
                      {weekExpanded && wg.employees.map((emp) => {
                        const empKey = `${wg.week}|${emp.email}`;
                        const empExpanded = expandedEmps.has(empKey);
                        return (
                          <Fragment key={empKey}>
                            {/* Employee Subtotal Row */}
                            <tr
                              className="cursor-pointer bg-gray-50/80 hover:bg-gray-100/50"
                              onClick={() => toggleEmp(empKey)}
                            >
                              <td className="whitespace-nowrap px-2 py-1.5 pl-4 text-center text-[10px] text-gray-400">
                                {empExpanded ? '\u25BC' : '\u25B6'}
                              </td>
                              <td className="sticky left-0 z-10 truncate bg-gray-50/80 px-3 py-1.5 text-[12px] font-medium text-gray-900">{emp.name}</td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-[11px] text-gray-500">Total</td>
                              <td className="whitespace-nowrap px-2 py-1.5" />
                              <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] font-semibold text-gray-900">{emp.tbsReported}</td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] font-semibold text-gray-900">{emp.tbsAbsence}</td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] font-semibold text-gray-900">{emp.totalTbs}</td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] font-semibold text-gray-700">{emp.bambooHours ?? ''}</td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right">
                                {emp.discrepancy != null && (
                                  <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-medium ${getDiscBadge(emp.discrepancy)}`}>
                                    {emp.discrepancy > 0 ? '+' : ''}{emp.discrepancy}h
                                  </span>
                                )}
                              </td>
                              <td className="truncate whitespace-nowrap px-2 py-1.5 text-[11px] text-gray-500">{emp.reportingTo}</td>
                              <td className="truncate whitespace-nowrap px-2 py-1.5 text-[11px] text-gray-500">{emp.jobTitle}</td>
                            </tr>

                            {/* Day Detail Rows */}
                            {empExpanded && emp.days.map((day) => (
                              <tr key={`${empKey}-${day.date}`} className="hover:bg-gray-50">
                                <td className="whitespace-nowrap px-2 py-1" />
                                <td className="sticky left-0 z-10 truncate bg-white px-3 py-1 pl-8 text-[11px] text-gray-400">{emp.name}</td>
                                <td className="whitespace-nowrap px-2 py-1 text-[11px] text-gray-700">{formatDate(day.date)}</td>
                                <td className="whitespace-nowrap px-2 py-1 text-[11px] text-gray-500">{day.dayLabel}</td>
                                <td className="whitespace-nowrap px-2 py-1 text-right text-[11px] text-gray-700">{day.tbsReported || '\u2013'}</td>
                                <td className="whitespace-nowrap px-2 py-1 text-right text-[11px] text-gray-700">{day.tbsAbsence || '\u2013'}</td>
                                <td className="whitespace-nowrap px-2 py-1 text-right text-[11px] text-gray-700">{day.totalTbs || '\u2013'}</td>
                                <td className="whitespace-nowrap px-2 py-1 text-right text-[11px] text-gray-500">{day.bambooHours ?? ''}</td>
                                <td className={`whitespace-nowrap px-2 py-1 text-right text-[11px] ${getDiscColor(day.discrepancy)}`}>
                                  {day.discrepancy != null ? (day.discrepancy > 0 ? '+' : '') + day.discrepancy : ''}
                                </td>
                                <td className="truncate whitespace-nowrap px-2 py-1 text-[10px] text-gray-400">{emp.reportingTo}</td>
                                <td className="truncate whitespace-nowrap px-2 py-1 text-[10px] text-gray-400">{emp.jobTitle}</td>
                              </tr>
                            ))}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 rounded bg-green-50" /> On track ({'\u00B1'}1h)</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 rounded bg-amber-50" /> Minor under</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 rounded bg-red-50" /> Under ({'>'}2h)</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-4 rounded bg-blue-50" /> Over ({'>'}2h)</span>
      </div>
    </div>
  );
}

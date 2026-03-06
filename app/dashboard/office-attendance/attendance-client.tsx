'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { OFFICE_DAYS_REQUIRED, LOOKBACK_OPTIONS, CELL_COLORS, CELL_HEX } from '@/lib/constants';

// --- Types (exported for server component) ---

export interface DayDetail {
  date: string;       // YYYY-MM-DD
  dayLabel: string;   // "Mon", "Tue", etc.
  location: 'Office' | 'Remote' | 'PTO' | 'Unknown';
  ptoType?: string | null;
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
  approvedRemoteWorkRequest: boolean;
  remoteWorkdayPolicyAssigned: boolean;
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
  zeroOfficeDaysCount: number;
}

interface Props {
  rows: AttendanceRow[];
  weeks: string[];
  /** Completed weeks with actual data — used for avg/compliance (subset of weeks) */
  dataWeeks?: string[];
  currentWeek?: string | null;
  departments: string[];
  locations: string[];
  summary: AttendanceSummary;
  lookbackWeeks: number;
  startDate: string;
  endDate: string;
}

type SortKey = 'name' | 'department' | 'officeLocation' | 'total' | 'avgPerWeek' | 'trend' | string;
type SortDir = 'asc' | 'desc';
type ViewMode = 'employees' | 'departments';
type RemoteWorkFilter = 'all' | 'approved';

interface DepartmentRow {
  id: string;
  department: string;
  employeeCount: number;
  officeLocation: string;
  weeks: Record<string, WeekCell>;
  total: number;
  avgPerWeek: number;
  scorePct: number;
  trend: 'up' | 'down' | 'flat';
}

interface DisplayRow {
  id: string;
  label: string;
  secondary: string;
  officeLocation: string;
  approvedRemoteWorkRequest: boolean;
  remoteWorkdayPolicyAssigned: boolean;
  weeks: Record<string, WeekCell>;
  total: number;
  avgPerWeek: number;
  scorePct: number;
  trend: 'up' | 'down' | 'flat';
  employeeCount?: number;
  email?: string;
}

interface DetailState {
  row: DisplayRow;
}

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

function getWeekPointCapacity(cell?: WeekCell): number {
  const ptoDays = cell?.ptoDays ?? 0;
  return Math.max(0, Math.min(OFFICE_DAYS_REQUIRED, 5 - ptoDays));
}

function getWeekPoints(cell?: WeekCell): number {
  const officeDays = cell?.officeDays ?? 0;
  return Math.min(officeDays, getWeekPointCapacity(cell));
}

function calculateScorePct(weeksByKey: Record<string, WeekCell>, scopedWeeks: string[]): number {
  let earned = 0;
  let capacity = 0;
  for (const week of scopedWeeks) {
    const cell = weeksByKey[week];
    earned += getWeekPoints(cell);
    capacity += getWeekPointCapacity(cell);
  }
  if (capacity <= 0) return 0;
  return Math.round((earned / capacity) * 100);
}

function scoreTone(scorePct: number): string {
  if (scorePct >= 80) return 'bg-green-50 text-green-700';
  if (scorePct >= 50) return 'bg-amber-50 text-amber-700';
  return 'bg-red-50 text-red-700';
}

function formatRangeLabel(startDate: string, endDate: string): string {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function parseListParam(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function buildReturnTo(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function formatDayLabel(date: string): string {
  return parseLocalDate(date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function getWeekLabel(week: string): string {
  const start = parseLocalDate(week);
  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function AttendanceClient({
  rows,
  weeks,
  dataWeeks,
  currentWeek = null,
  departments,
  locations,
  summary,
  lookbackWeeks,
  startDate,
  endDate,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [selectedDepts, setSelectedDepts] = useState<string[]>(() => parseListParam(searchParams.get('departments')));
  const [selectedLocs, setSelectedLocs] = useState<string[]>(() => parseListParam(searchParams.get('locations')));
  const [deptOpen, setDeptOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(() => (searchParams.get('sortKey') as SortKey) || 'name');
  const [sortDir, setSortDir] = useState<SortDir>(() => (searchParams.get('sortDir') as SortDir) || 'asc');
  const [page, setPage] = useState(() => Math.max(0, Number(searchParams.get('page') || '0') || 0));
  const [viewMode, setViewMode] = useState<ViewMode>(() => (searchParams.get('view') as ViewMode) || 'employees');
  const [remoteWorkFilter, setRemoteWorkFilter] = useState<RemoteWorkFilter>(() => (searchParams.get('remoteWork') as RemoteWorkFilter) || 'all');
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [showScrollRail, setShowScrollRail] = useState(false);

  const deptRef = useRef<HTMLDivElement>(null);
  const locRef = useRef<HTMLDivElement>(null);
  const detailHistoryPushed = useRef(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const topScrollContentRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);
  const scoredWeeks = useMemo(
    () => (currentWeek ? weeks.filter((week) => week !== currentWeek) : weeks),
    [currentWeek, weeks],
  );
  const buildStateParams = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (search) params.set('q', search);
    else params.delete('q');

    if (selectedDepts.length > 0) params.set('departments', selectedDepts.join(','));
    else params.delete('departments');

    if (selectedLocs.length > 0) params.set('locations', selectedLocs.join(','));
    else params.delete('locations');

    if (sortKey !== 'name') params.set('sortKey', String(sortKey));
    else params.delete('sortKey');

    if (sortDir !== 'asc') params.set('sortDir', sortDir);
    else params.delete('sortDir');

    if (page > 0) params.set('page', String(page));
    else params.delete('page');

    if (viewMode !== 'employees') params.set('view', viewMode);
    else params.delete('view');

    if (remoteWorkFilter !== 'all') params.set('remoteWork', remoteWorkFilter);
    else params.delete('remoteWork');

    return params;
  }, [page, remoteWorkFilter, search, searchParams, selectedDepts, selectedLocs, sortDir, sortKey, viewMode]);
  const returnTo = useMemo(() => buildReturnTo(pathname, buildStateParams), [buildStateParams, pathname]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) setDeptOpen(false);
      if (locRef.current && !locRef.current.contains(e.target as Node)) setLocOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const next = buildStateParams.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(`${pathname}?${next}`, { scroll: false });
    }
  }, [buildStateParams, pathname, router, searchParams]);

  useEffect(() => {
    if (!detail || typeof window === 'undefined') return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (!detailHistoryPushed.current) {
      window.history.pushState(
        { ...(window.history.state ?? {}), officeAttendanceDetailOpen: true },
        '',
        window.location.href,
      );
      detailHistoryPushed.current = true;
    }

    const handlePopState = () => {
      detailHistoryPushed.current = false;
      setDetail(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setDetail(null);
      if (detailHistoryPushed.current) {
        detailHistoryPushed.current = false;
        window.history.back();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [detail]);

  const closeDetail = () => {
    setDetail(null);
    if (typeof window !== 'undefined' && detailHistoryPushed.current) {
      detailHistoryPushed.current = false;
      window.history.back();
    }
  };

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
    const weeksBack = Number(val);
    const nextEnd = new Date();
    const nextStart = new Date(nextEnd);
    nextStart.setDate(nextEnd.getDate() - (weeksBack * 7));
    const params = new URLSearchParams(searchParams.toString());
    params.set('lookbackWeeks', val);
    params.set('startDate', nextStart.toISOString().split('T')[0] ?? '');
    params.set('endDate', nextEnd.toISOString().split('T')[0] ?? '');
    router.push(`/dashboard/office-attendance?${params.toString()}`);
  };

  const hasFilters = search || selectedDepts.length > 0 || selectedLocs.length > 0 || remoteWorkFilter !== 'all';

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
    if (remoteWorkFilter === 'approved') {
      list = list.filter((r) => r.approvedRemoteWorkRequest);
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
  }, [remoteWorkFilter, rows, search, selectedDepts, selectedLocs]);

  const departmentRows = useMemo<DepartmentRow[]>(() => {
    const grouped = new Map<string, DepartmentRow>();
    for (const row of filtered) {
      const key = row.department || 'Unknown';
      const existing = grouped.get(key) || {
        id: key,
        department: key,
        employeeCount: 0,
        officeLocation: row.officeLocation || 'Unknown',
        weeks: {},
        total: 0,
        avgPerWeek: 0,
        scorePct: 0,
        trend: 'flat',
      };

      existing.employeeCount += 1;
      existing.total += row.total;
      if (existing.officeLocation !== row.officeLocation) {
        existing.officeLocation = 'Mixed';
      }

      for (const week of weeks) {
        const cell = row.weeks[week];
        if (!cell) continue;
        const current = existing.weeks[week] || {
          officeDays: 0,
          remoteDays: 0,
          ptoDays: 0,
          days: [],
        };
        current.officeDays += cell.officeDays;
        current.remoteDays += cell.remoteDays;
        current.ptoDays += cell.ptoDays;
        existing.weeks[week] = current;
      }

      grouped.set(key, existing);
    }

    return [...grouped.values()].map((row) => {
      const avgPerWeek = scoredWeeks.length > 0
        ? Math.round((row.total / Math.max(1, row.employeeCount) / scoredWeeks.length) * 10) / 10
        : 0;
      const scorePct = row.employeeCount > 0
        ? Math.round(
          filtered
            .filter((employee) => employee.department === row.department)
            .reduce((sum, employee) => sum + calculateScorePct(employee.weeks, scoredWeeks), 0) / row.employeeCount,
        )
        : 0;
      let trend: 'up' | 'down' | 'flat' = 'flat';
      if (scoredWeeks.length >= 2) {
        const prevWeek = scoredWeeks[scoredWeeks.length - 2]!;
        const lastWeek = scoredWeeks[scoredWeeks.length - 1]!;
        const prevAvg = (row.weeks[prevWeek]?.officeDays ?? 0) / Math.max(1, row.employeeCount);
        const lastAvg = (row.weeks[lastWeek]?.officeDays ?? 0) / Math.max(1, row.employeeCount);
        if (lastAvg > prevAvg) trend = 'up';
        else if (lastAvg < prevAvg) trend = 'down';
      }
      return {
        ...row,
        avgPerWeek,
        scorePct,
        trend,
      };
    });
  }, [filtered, scoredWeeks, weeks]);

  const displayRows = useMemo<DisplayRow[]>(() => {
    const employeeRows: DisplayRow[] = filtered.map((row) => ({
      id: row.email,
      label: row.name,
      secondary: row.department,
      officeLocation: row.officeLocation,
      approvedRemoteWorkRequest: row.approvedRemoteWorkRequest,
      remoteWorkdayPolicyAssigned: row.remoteWorkdayPolicyAssigned,
      weeks: row.weeks,
      total: row.total,
      avgPerWeek: row.avgPerWeek,
      scorePct: calculateScorePct(row.weeks, scoredWeeks),
      trend: row.trend,
      email: row.email,
    }));

    const departmentDisplayRows: DisplayRow[] = departmentRows.map((row) => ({
      id: row.id,
      label: row.department,
      secondary: String(row.employeeCount),
      officeLocation: row.officeLocation,
      approvedRemoteWorkRequest: false,
      remoteWorkdayPolicyAssigned: false,
      weeks: Object.fromEntries(
        weeks.map((week) => {
          const cell = row.weeks[week];
          const employeeCount = Math.max(1, row.employeeCount);
          return [week, {
            officeDays: cell ? Math.round((cell.officeDays / employeeCount) * 10) / 10 : 0,
            remoteDays: cell ? Math.round((cell.remoteDays / employeeCount) * 10) / 10 : 0,
            ptoDays: cell ? Math.round((cell.ptoDays / employeeCount) * 10) / 10 : 0,
            days: [],
          }];
        }),
      ),
      total: row.total,
      avgPerWeek: row.avgPerWeek,
      scorePct: row.scorePct,
      trend: row.trend,
      employeeCount: row.employeeCount,
    }));

    return viewMode === 'departments' ? departmentDisplayRows : employeeRows;
  }, [departmentRows, filtered, scoredWeeks, viewMode, weeks]);

  const sorted = useMemo(() => {
    const arr = [...displayRows];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === 'name') return dir * a.label.localeCompare(b.label);
      if (sortKey === 'department') {
        if (viewMode === 'departments') return dir * ((Number(a.secondary) || 0) - (Number(b.secondary) || 0));
        return dir * a.secondary.localeCompare(b.secondary);
      }
      if (sortKey === 'officeLocation') return dir * a.officeLocation.localeCompare(b.officeLocation);
      if (sortKey === 'total') return dir * (a.total - b.total);
      if (sortKey === 'avgPerWeek') return dir * (a.avgPerWeek - b.avgPerWeek);
      if (sortKey === 'status') return dir * (a.scorePct - b.scorePct);
      if (sortKey === 'trend') {
        const order = { up: 2, flat: 1, down: 0 };
        return dir * (order[a.trend] - order[b.trend]);
      }
      const aDays = a.weeks[sortKey]?.officeDays ?? 0;
      const bDays = b.weeks[sortKey]?.officeDays ?? 0;
      return dir * (aDays - bDays);
    });
    return arr;
  }, [displayRows, sortDir, sortKey, viewMode]);

  const filteredSummary = useMemo(() => {
    const totalEmployees = filtered.length;
    const totalDepartments = departmentRows.length;
    const numCompletedWeeks = scoredWeeks.length;
    let zeroCount = 0;
    let sumOfficeDays = 0;
    let sumScorePct = 0;

    for (const row of filtered) {
      if (row.total === 0) zeroCount++;
      sumScorePct += calculateScorePct(row.weeks, scoredWeeks);
      for (const week of scoredWeeks) {
        sumOfficeDays += row.weeks[week]?.officeDays ?? 0;
      }
    }

    const avgOfficeDays = totalEmployees > 0 && numCompletedWeeks > 0
      ? Math.round((sumOfficeDays / totalEmployees / numCompletedWeeks) * 10) / 10
      : 0;
    const complianceRate = totalEmployees > 0 ? Math.round(sumScorePct / totalEmployees) : 0;
    const zeroOfficeDepartments = departmentRows.filter((row) => row.total === 0).length;

    return {
      totalEmployees,
      totalDepartments,
      avgOfficeDays,
      complianceRate,
      zeroOfficeDaysCount: zeroCount,
      zeroOfficeDepartments,
    };
  }, [departmentRows, filtered, scoredWeeks]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    const tableNode = tableScrollRef.current;
    const topNode = topScrollRef.current;
    const topContentNode = topScrollContentRef.current;
    if (!tableNode || !topNode || !topContentNode) return;

    const syncSizes = () => {
      const scrollWidth = tableNode.scrollWidth;
      const clientWidth = tableNode.clientWidth;
      topContentNode.style.width = `${scrollWidth}px`;
      setShowScrollRail(scrollWidth > clientWidth + 8);
      if (topNode.scrollLeft !== tableNode.scrollLeft) {
        topNode.scrollLeft = tableNode.scrollLeft;
      }
    };

    const syncFromTable = () => {
      if (syncingScrollRef.current) return;
      syncingScrollRef.current = true;
      topNode.scrollLeft = tableNode.scrollLeft;
      requestAnimationFrame(() => {
        syncingScrollRef.current = false;
      });
    };

    const syncFromTop = () => {
      if (syncingScrollRef.current) return;
      syncingScrollRef.current = true;
      tableNode.scrollLeft = topNode.scrollLeft;
      requestAnimationFrame(() => {
        syncingScrollRef.current = false;
      });
    };

    syncSizes();
    tableNode.addEventListener('scroll', syncFromTable, { passive: true });
    topNode.addEventListener('scroll', syncFromTop, { passive: true });

    const resizeObserver = new ResizeObserver(syncSizes);
    resizeObserver.observe(tableNode);
    const tableElement = tableNode.querySelector('table');
    if (tableElement) resizeObserver.observe(tableElement);
    window.addEventListener('resize', syncSizes);

    return () => {
      tableNode.removeEventListener('scroll', syncFromTable);
      topNode.removeEventListener('scroll', syncFromTop);
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncSizes);
    };
  }, [pageRows.length, viewMode, weeks.length]);

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
    const headers = [
      viewMode === 'departments' ? 'Department' : 'Employee',
      viewMode === 'departments' ? 'Employees' : 'Department',
      'Location',
      'Remote Workday',
      ...weeks.map((w) => parseLocalDate(w).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
      viewMode === 'departments' ? 'Total Office Days' : 'Total',
      'Avg/Week',
      'Score %',
      'Trend',
    ];

    const csvRows = sorted.map((r) => [
      r.label,
      r.secondary,
      r.officeLocation,
      viewMode === 'employees'
        ? (r.approvedRemoteWorkRequest
          ? 'Approved Request'
          : r.remoteWorkdayPolicyAssigned
            ? 'Policy Assigned'
            : 'Standard Policy')
        : '—',
      ...weeks.map((w) => String(r.weeks[w]?.officeDays ?? 0)),
      String(r.total),
      String(r.avgPerWeek),
      `${r.scorePct}%`,
      r.trend,
    ]);

    const csv = [headers.join(','), ...csvRows.map((row) => row.map((c) => `"${c}"`).join(','))].join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `office-attendance-${startDate}-${endDate}-${viewMode}.csv`);
  };

  const exportXLSX = async () => {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Office Attendance');

    const headers = [
      viewMode === 'departments' ? 'Department' : 'Employee',
      viewMode === 'departments' ? 'Employees' : 'Department',
      'Location',
      'Remote Workday',
      ...weeks.map((w) => parseLocalDate(w).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
      viewMode === 'departments' ? 'Total Office Days' : 'Total',
      'Avg/Week',
      'Score %',
      'Trend',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true, size: 11 };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
    });

    // Summary row (must match header column count: Employee, Email, Department, Location, ...weeks, Total, Avg, Compliant, Trend)
    const summaryRow = ws.addRow([
      viewMode === 'departments' ? `${filteredSummary.totalDepartments} departments` : `${filteredSummary.totalEmployees} employees`,
      viewMode === 'departments' ? `${filteredSummary.totalEmployees} employees` : '',
      '',
      `${filteredSummary.complianceRate}% score`,
      ...weeks.map(() => ''),
      '',
      String(filteredSummary.avgOfficeDays),
      viewMode === 'departments'
        ? `${filteredSummary.zeroOfficeDepartments} zero-office departments`
        : `${filteredSummary.zeroOfficeDaysCount} zero office days`,
      '',
    ]);
    summaryRow.font = { italic: true, size: 10, color: { argb: '6B7280' } };

    for (const r of sorted) {
      const row = ws.addRow([
        r.label, r.secondary, r.officeLocation,
        viewMode === 'employees'
          ? (r.approvedRemoteWorkRequest
            ? 'Approved Request'
            : r.remoteWorkdayPolicyAssigned
              ? 'Policy Assigned'
              : 'Standard Policy')
          : '—',
        ...weeks.map((w) => r.weeks[w]?.officeDays ?? 0),
        r.total, r.avgPerWeek,
        r.scorePct, r.trend,
      ]);

      // Color week cells
      weeks.forEach((w, i) => {
        const cell = row.getCell(5 + i); // 1-indexed, after label/secondary/location/remote-work
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
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `office-attendance-${startDate}-${endDate}-${viewMode}.xlsx`);
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
          <h2 className="text-[15px] font-semibold text-gray-900">Office Attendance</h2>
          <p className="mt-0.5 text-[12px] text-gray-500">
            {formatRangeLabel(startDate, endDate)} — office days per week (target {OFFICE_DAYS_REQUIRED})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-gray-200 bg-white p-0.5">
            {([
              { id: 'employees', label: 'Employees' },
              { id: 'departments', label: 'Departments' },
            ] as const).map((option) => (
              <button
                key={option.id}
                onClick={() => { setViewMode(option.id); setPage(0); }}
                className={`rounded-md px-3 py-1.5 text-[12px] font-medium ${
                  viewMode === option.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
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
        <div className="w-full md:w-56">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Remote Workday</label>
          <select
            value={remoteWorkFilter}
            onChange={(event) => { setRemoteWorkFilter(event.target.value as RemoteWorkFilter); setPage(0); }}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-600 focus:border-gray-300 focus:outline-none"
          >
            <option value="all">All Employees</option>
            <option value="approved">Approved Remote Work</option>
          </select>
        </div>
        {hasFilters && (
          <button
            onClick={() => { setSearch(''); setSelectedDepts([]); setSelectedLocs([]); setRemoteWorkFilter('all'); setPage(0); }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">{viewMode === 'departments' ? 'Departments' : 'Employees'}</p>
          <p className="mt-1 text-[22px] font-semibold text-gray-900">
            {viewMode === 'departments' ? filteredSummary.totalDepartments : filteredSummary.totalEmployees}
          </p>
          {viewMode === 'departments' && (
            <p className="mt-1 text-[11px] text-gray-400">{filteredSummary.totalEmployees} employees covered</p>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">
            {viewMode === 'departments' ? 'Avg Office Days/Emp/Week' : 'Avg Office Days/Week'}
          </p>
          <p className="mt-1 text-[22px] font-semibold text-gray-900">{filteredSummary.avgOfficeDays}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">Score</p>
          <p className={`mt-1 text-[22px] font-semibold ${filteredSummary.complianceRate >= 80 ? 'text-green-600' : filteredSummary.complianceRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
            {filteredSummary.complianceRate}%
          </p>
          <p className="mt-1 text-[11px] text-gray-400">0 days = 0, 1 day = 50, 2+ days = 100</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-medium text-gray-500">{viewMode === 'departments' ? 'Zero-Office Departments' : 'Zero Office Days'}</p>
          <p className={`mt-1 text-[22px] font-semibold ${
            (viewMode === 'departments' ? filteredSummary.zeroOfficeDepartments : filteredSummary.zeroOfficeDaysCount) > 0
              ? 'text-red-600'
              : 'text-gray-900'
          }`}>
            {viewMode === 'departments' ? filteredSummary.zeroOfficeDepartments : filteredSummary.zeroOfficeDaysCount}
          </p>
        </div>
      </div>

      {/* Count + pagination info */}
      <div className="flex items-center justify-between text-[12px] text-gray-500">
        <span>{sorted.length} {viewMode === 'departments' ? 'departments' : 'employees'} {hasFilters ? '(filtered)' : ''}</span>
        <span>Page {page + 1} of {totalPages}</span>
      </div>

      {showScrollRail ? (
        <div className="sticky top-20 z-20 -mb-2">
          <div className="rounded-xl border border-gray-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
            <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-gray-400">
              <span>Horizontal Scroll</span>
              <span>Drag here to move across weeks</span>
            </div>
            <div ref={topScrollRef} className="overflow-x-auto overflow-y-hidden">
              <div ref={topScrollContentRef} className="h-2 rounded-full bg-gray-200" />
            </div>
          </div>
        </div>
      ) : null}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div ref={tableScrollRef} className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                <th
                  className="sticky left-0 z-10 cursor-pointer select-none whitespace-nowrap bg-white px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900"
                  onClick={() => handleSort('name')}
                >
                  {viewMode === 'departments' ? 'Department' : 'Employee'} {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
                <SortHeader label={viewMode === 'departments' ? 'Employees' : 'Dept'} colKey="department" />
                <SortHeader label="Location" colKey="officeLocation" />
                {weeks.map((w) => {
                  const isCurrent = w === currentWeek;
                  return (
                    <th
                      key={w}
                      className={`cursor-pointer select-none whitespace-nowrap px-2 py-3 text-center text-[10px] font-medium uppercase tracking-wider hover:text-gray-900 ${isCurrent ? 'bg-gray-50 text-gray-400' : 'text-gray-500'}`}
                      onClick={() => handleSort(w)}
                    >
                      {parseLocalDate(w).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {isCurrent && <span className="ml-0.5 normal-case tracking-normal">*</span>}
                      {sortKey === w ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </th>
                  );
                })}
                <SortHeader label="Total" colKey="total" align="center" />
                <SortHeader label="Avg" colKey="avgPerWeek" align="center" />
                <SortHeader label="Score" colKey="status" align="center" />
                <SortHeader label="Trend" colKey="trend" align="center" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2 group-hover:bg-gray-50">
                    {row.email ? (
                      <button
                        type="button"
                        onClick={() => setDetail({ row })}
                        className="whitespace-nowrap text-[13px] font-medium text-gray-900 hover:underline"
                      >
                        {row.label}
                      </button>
                    ) : (
                      <span className="whitespace-nowrap text-[13px] font-medium text-gray-900">{row.label}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[12px] text-gray-500">{row.secondary}</td>
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
                          <span className={`inline-flex min-h-6 min-w-8 cursor-default items-center justify-center rounded px-1 text-[11px] font-medium ${color}`}>
                            {office}
                          </span>
                          <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                            <div className="text-left text-[11px]">
                              {viewMode === 'departments' ? (
                                <div className="space-y-1 text-gray-600">
                                  <div className="flex justify-between gap-3"><span>Employees</span><span className="font-medium text-gray-900">{row.employeeCount ?? 0}</span></div>
                                  <div className="flex justify-between gap-3"><span>Office Days</span><span className="font-medium text-gray-900">{office}</span></div>
                                  <div className="flex justify-between gap-3"><span>Remote Days</span><span className="font-medium text-gray-900">{remote}</span></div>
                                  <div className="flex justify-between gap-3"><span>PTO Days</span><span className="font-medium text-gray-900">{pto}</span></div>
                                </div>
                              ) : cell && cell.days.length > 0 ? (
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
                                      }`}>
                                        {d.location === 'PTO' && d.ptoType ? `${d.location} • ${d.ptoType}` : d.location}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-gray-400">No activity</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-3 py-1.5 text-center text-[13px] font-semibold text-gray-900">{row.total}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-center text-[12px] text-gray-600">{row.avgPerWeek}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-center">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${scoreTone(row.scorePct)}`}>
                      {row.scorePct}%
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
            <div className="p-12 text-center text-[13px] text-gray-500">No {viewMode === 'departments' ? 'departments' : 'employees'} match filters.</div>
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
        <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.pto}`} /> PTO week overlay</span>
        {currentWeek && <span className="flex items-center gap-1.5"><span className="text-gray-400">*</span> Current week (in progress, excluded from score)</span>}
      </div>

      {detail ? (
        <AttendanceDetailModal
          row={detail.row}
          weeks={weeks}
          scoredWeeks={scoredWeeks}
          returnTo={returnTo}
          onClose={closeDetail}
        />
      ) : null}
    </div>
  );
}

function AttendanceDetailModal({
  row,
  weeks,
  scoredWeeks,
  returnTo,
  onClose,
}: {
  row: DisplayRow;
  weeks: string[];
  scoredWeeks: string[];
  returnTo: string;
  onClose: () => void;
}) {
  const weekSummaries = weeks.map((week) => {
    const cell = row.weeks[week] || { officeDays: 0, remoteDays: 0, ptoDays: 0, days: [] };
    return {
      week,
      label: getWeekLabel(week),
      officeDays: cell.officeDays ?? 0,
      remoteDays: cell.remoteDays ?? 0,
      ptoDays: cell.ptoDays ?? 0,
      scorePct: getWeekPointCapacity(cell) > 0
        ? Math.round((getWeekPoints(cell) / getWeekPointCapacity(cell)) * 100)
        : 0,
      days: [...(cell.days ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    };
  });

  const allDays = weekSummaries.flatMap((weekSummary) =>
    weekSummary.days.map((day) => ({ ...day, weekLabel: weekSummary.label })),
  );
  const officeDays = allDays.filter((day) => day.location === 'Office').length;
  const remoteDays = allDays.filter((day) => day.location === 'Remote').length;
  const ptoDays = allDays.filter((day) => day.location === 'PTO').length;
  const unknownDays = allDays.filter((day) => day.location === 'Unknown').length;
  const activeWeeks = scoredWeeks.filter((week) => {
    const cell = row.weeks[week];
    return (cell?.officeDays ?? 0) > 0 || (cell?.remoteDays ?? 0) > 0 || (cell?.ptoDays ?? 0) > 0;
  }).length;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/40 px-4 py-6" onClick={onClose}>
      <div
        className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6 border-b border-gray-100 px-6 py-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">Employee Attendance Detail</p>
            <h3 className="mt-1 text-[24px] font-semibold text-gray-900">{row.label}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-gray-500">
              <span>{row.secondary} • {row.officeLocation}</span>
              {row.approvedRemoteWorkRequest ? (
                <span className="inline-flex rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
                  Approved Remote Work Request
                </span>
              ) : null}
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                row.remoteWorkdayPolicyAssigned ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {row.remoteWorkdayPolicyAssigned ? 'Remote Workday Policy Assigned' : 'Standard Policy'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {row.email ? (
              <Link
                href={`/dashboard/employee/${encodeURIComponent(row.email)}?returnTo=${encodeURIComponent(returnTo)}`}
                className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
              >
                Open Full Profile
              </Link>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>

        <div className="grid gap-4 border-b border-gray-100 bg-gray-50/70 px-6 py-4 md:grid-cols-5">
          <MetricCard label="Score" value={`${row.scorePct}%`} tone={scoreTone(row.scorePct)} />
          <MetricCard label="Office Days" value={String(officeDays)} />
          <MetricCard label="Remote Days" value={String(remoteDays)} />
          <MetricCard label="PTO Days" value={String(ptoDays)} />
          <MetricCard label="Weeks With Activity" value={String(activeWeeks)} />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">Weekly Breakdown</h4>
                  <p className="mt-1 text-[12px] text-gray-400">Each completed week uses the same scoring model as the main report.</p>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-gray-200">
                <div className="max-h-[28rem] overflow-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10 bg-white">
                      <tr className="border-b border-gray-100">
                        <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Week</th>
                        <th className="px-3 py-3 text-center text-[11px] font-medium uppercase tracking-wider text-gray-500">Office</th>
                        <th className="px-3 py-3 text-center text-[11px] font-medium uppercase tracking-wider text-gray-500">Remote</th>
                        <th className="px-3 py-3 text-center text-[11px] font-medium uppercase tracking-wider text-gray-500">PTO</th>
                        <th className="px-3 py-3 text-center text-[11px] font-medium uppercase tracking-wider text-gray-500">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {weekSummaries.map((weekSummary) => (
                        <tr key={weekSummary.week} className="bg-white">
                          <td className="px-4 py-3">
                            <p className="text-[13px] font-medium text-gray-900">{weekSummary.label}</p>
                            <p className="text-[11px] text-gray-400">{weekSummary.days.length} tracked days</p>
                          </td>
                          <td className="px-3 py-3 text-center text-[13px] font-medium text-gray-900">{weekSummary.officeDays}</td>
                          <td className="px-3 py-3 text-center text-[13px] text-gray-600">{weekSummary.remoteDays}</td>
                          <td className="px-3 py-3 text-center text-[13px] text-blue-600">{weekSummary.ptoDays}</td>
                          <td className="px-3 py-3 text-center">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${scoreTone(weekSummary.scorePct)}`}>
                              {weekSummary.scorePct}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div>
                <h4 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">Daily Activity</h4>
                <p className="mt-1 text-[12px] text-gray-400">Expanded office, remote, PTO, and unknown days from the selected range.</p>
              </div>
              <div className="overflow-hidden rounded-2xl border border-gray-200">
                <div className="max-h-[28rem] overflow-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10 bg-white">
                      <tr className="border-b border-gray-100">
                        <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Date</th>
                        <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Week</th>
                        <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Location</th>
                        <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">PTO</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {allDays.length > 0 ? allDays.map((day) => (
                        <tr key={day.date} className="bg-white">
                          <td className="px-4 py-3 text-[13px] font-medium text-gray-900">{formatDayLabel(day.date)}</td>
                          <td className="px-3 py-3 text-[12px] text-gray-500">{day.weekLabel}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              day.location === 'Office'
                                ? 'bg-green-50 text-green-700'
                                : day.location === 'Remote'
                                  ? 'bg-gray-100 text-gray-700'
                                  : day.location === 'PTO'
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'bg-amber-50 text-amber-700'
                            }`}>
                              {day.location}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-[12px] text-gray-500">{day.ptoType ?? '—'}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-[13px] text-gray-500">No day-level activity in this range.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label="Unknown Days" value={String(unknownDays)} />
                <MetricCard label="Avg Office / Week" value={String(row.avgPerWeek)} />
                <MetricCard label="Trend" value={row.trend === 'flat' ? 'Flat' : row.trend === 'up' ? 'Up' : 'Down'} />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white p-4 ${tone ?? ''}`}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-2 text-[24px] font-semibold text-gray-900">{value}</p>
    </div>
  );
}

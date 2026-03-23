'use client';

import { Download, Filter, X } from 'lucide-react';
import { useState, useMemo, useRef, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  CELL_COLORS,
  CELL_HEX,
  DEFAULT_OFFICE_ATTENDANCE_LOOKBACK_WEEKS,
  LOOKBACK_OPTIONS,
  OFFICE_DAYS_REQUIRED,
} from '@/lib/constants';
import { OFFICE_ATTENDANCE_VIEW_OPTIONS, type OfficeAttendanceViewKey } from '@/lib/dashboard-nav-config';
import { getOfficeAttendanceDefaultRange, toDateParam } from '@/lib/report-date-defaults';
import {
  arraysEqual,
  parseEnumParam,
  parseListParam,
  parsePageParam,
  type SearchParamReader,
} from '@/lib/search-params';
import type { AttendanceRemoteWorkRequest, AttendanceRow, AttendanceSummary, DayDetail, WeekCell } from '@/lib/types/attendance';
import { useUrlStateSync, type UrlStateField } from '@/lib/use-url-state-sync';

interface Props {
  rows: AttendanceRow[];
  remoteWorkRequests: AttendanceRemoteWorkRequest[];
  weeks: string[];
  /** Completed weeks with actual data — used for avg/compliance (subset of weeks) */
  dataWeeks?: string[];
  currentWeek?: string | null;
  departments: string[];
  locations: string[];
  summary: AttendanceSummary;
  startDate: string;
  endDate: string;
}

type SortKey = 'name' | 'department' | 'officeLocation' | 'total' | 'avgPerWeek' | 'trend' | string;
type SortDir = 'asc' | 'desc';
type ViewMode = OfficeAttendanceViewKey;
type DateFilterMode = 'quick' | 'custom';
const DEFAULT_EMPLOYEE_LOCATION = 'Quebec (Montreal Head Office)';

function getInitialViewMode(searchParams: SearchParamReader): ViewMode {
  const view = searchParams.get('view');
  if (view === 'employees' || view === 'departments' || view === 'managers' || view === 'approved-remote-work') {
    return view;
  }
  if (searchParams.get('remoteWork') === 'approved') {
    return 'approved-remote-work';
  }
  return 'employees';
}

function getDefaultLocationSelection(
  viewMode: ViewMode,
  searchParams: SearchParamReader,
  locations: string[],
): string[] {
  if (searchParams.has('locations')) return parseListParam(searchParams.get('locations'));
  if (viewMode !== 'employees') return [];
  return locations.includes(DEFAULT_EMPLOYEE_LOCATION) ? [DEFAULT_EMPLOYEE_LOCATION] : [];
}

interface GroupRow {
  id: string;
  groupLabel: string;
  employeeCount: number;
  quebecEmployeeCount: number;
  remoteEmployeeCount: number;
  managerName?: string;
  managerEmail?: string | null;
  officeLocation: string;
  weeks: Record<string, WeekCell>;
  weeklyCompliance: Record<string, {
    compliantEmployees: number;
    eligibleEmployees: number;
    compliancePct: number;
    compliantNames: string[];
    nonCompliantNames: string[];
    fullyRemoteNames: string[];
  }>;
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
  remoteWorkStatusLabel: string;
  weeks: Record<string, WeekCell>;
  total: number;
  avgPerWeek: number;
  scorePct: number;
  trend: 'up' | 'down' | 'flat';
  employeeCount?: number;
  quebecEmployeeCount?: number;
  remoteEmployeeCount?: number;
  weeklyCompliance?: Record<string, {
    compliantEmployees: number;
    eligibleEmployees: number;
    compliancePct: number;
    compliantNames: string[];
    nonCompliantNames: string[];
    fullyRemoteNames: string[];
  }>;
  managerName?: string;
  managerEmail?: string | null;
  email?: string;
}

interface DetailState {
  row: DisplayRow;
}

interface CalendarMonth {
  key: string;
  label: string;
  days: Array<{
    date: Date;
    dateKey: string;
    activity: (DayDetail & { weekLabel: string }) | null;
  } | null>;
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

function complianceValueTone(scorePct: number, eligibleEmployees: number): string {
  if (eligibleEmployees <= 0) return 'bg-gray-100 text-gray-400';
  return scoreTone(scorePct);
}

function formatNameBucket(names: string[]): string {
  return names.length > 0 ? names.join(', ') : '—';
}

function formatRangeLabel(startDate: string, endDate: string): string {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function getActiveLookbackWeeks(startDate: string, endDate: string): number | null {
  for (const weeksBack of LOOKBACK_OPTIONS) {
    const range = getOfficeAttendanceDefaultRange(weeksBack);
    if (toDateParam(range.startDate) === startDate && toDateParam(range.endDate) === endDate) {
      return weeksBack;
    }
  }

  return null;
}

function getAppliedDateFilterMode(
  searchParams: SearchParamReader,
  activeLookbackWeeks: number | null,
): DateFilterMode {
  const explicitMode = searchParams.get('dateMode');
  if (explicitMode === 'custom') return 'custom';
  if (explicitMode === 'quick') return 'quick';

  if ((searchParams.has('startDate') || searchParams.has('endDate')) && activeLookbackWeeks === null) {
    return 'custom';
  }

  return 'quick';
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

function formatOptionalDate(date: string | null): string {
  if (!date) return '—';
  return parseLocalDate(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatCompactHours(value?: number | null): string {
  const hours = value ?? 0;
  return `${hours.toFixed(1)}h`;
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function getMonthCalendarDays(monthDate: Date): Array<Date | null> {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const days: Array<Date | null> = [];

  for (let index = 0; index < startOffset; index += 1) {
    days.push(null);
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    days.push(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

export function AttendanceClient({
  rows,
  remoteWorkRequests,
  weeks,
  dataWeeks,
  currentWeek = null,
  departments,
  locations,
  summary,
  startDate,
  endDate,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewMode = getInitialViewMode(searchParams);

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [selectedDepts, setSelectedDepts] = useState<string[]>(() => parseListParam(searchParams.get('departments')));
  const [selectedLocs, setSelectedLocs] = useState<string[]>(() => getDefaultLocationSelection(viewMode, searchParams, locations));
  const [includeApprovedRemoteWork, setIncludeApprovedRemoteWork] = useState(() => searchParams.get('approvedRemoteWork') === 'include');
  const [deptOpen, setDeptOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(() => searchParams.get('sortKey') || 'name');
  const [sortDir, setSortDir] = useState<SortDir>(() => parseEnumParam(searchParams.get('sortDir'), ['asc', 'desc'] as const, 'asc'));
  const [page, setPage] = useState(() => parsePageParam(searchParams.get('page')));
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [showScrollRail, setShowScrollRail] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

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
  const syncedFields = useMemo<UrlStateField[]>(() => ([
    {
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
      read: (params) => parseListParam(params.get('departments')),
      sync: (nextValue) => {
        const nextDepts = nextValue as string[];
        setSelectedDepts((previous) => (arraysEqual(previous, nextDepts) ? previous : nextDepts));
      },
      write: (params) => {
        if (selectedDepts.length > 0) params.set('departments', selectedDepts.join(','));
        else params.delete('departments');
      },
    },
    {
      read: (params) => getDefaultLocationSelection(viewMode, params, locations),
      sync: (nextValue) => {
        const nextLocs = nextValue as string[];
        setSelectedLocs((previous) => (arraysEqual(previous, nextLocs) ? previous : nextLocs));
      },
      write: (params) => {
        if (selectedLocs.length > 0) params.set('locations', selectedLocs.join(','));
        else params.delete('locations');
      },
    },
    {
      read: (params) => params.get('approvedRemoteWork') === 'include',
      sync: (nextValue) => {
        const nextIncludeApprovedRemoteWork = nextValue as boolean;
        setIncludeApprovedRemoteWork((previous) => (
          previous === nextIncludeApprovedRemoteWork ? previous : nextIncludeApprovedRemoteWork
        ));
      },
      write: (params) => {
        if (includeApprovedRemoteWork) params.set('approvedRemoteWork', 'include');
        else params.delete('approvedRemoteWork');
        params.delete('remoteWork');
      },
    },
    {
      read: (params) => params.get('sortKey') || 'name',
      sync: (nextValue) => {
        const nextSortKey = nextValue as SortKey;
        setSortKey((previous) => (previous === nextSortKey ? previous : nextSortKey));
      },
      write: (params) => {
        if (sortKey !== 'name') params.set('sortKey', String(sortKey));
        else params.delete('sortKey');
      },
    },
    {
      read: (params) => parseEnumParam(params.get('sortDir'), ['asc', 'desc'] as const, 'asc'),
      sync: (nextValue) => {
        const nextSortDir = nextValue as SortDir;
        setSortDir((previous) => (previous === nextSortDir ? previous : nextSortDir));
      },
      write: (params) => {
        if (sortDir !== 'asc') params.set('sortDir', sortDir);
        else params.delete('sortDir');
      },
    },
    {
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
  ]), [
    includeApprovedRemoteWork,
    locations,
    page,
    search,
    selectedDepts,
    selectedLocs,
    sortDir,
    sortKey,
    viewMode,
  ]);
  const buildStateParams = useUrlStateSync({
    pathname,
    router,
    searchParams,
    fields: syncedFields,
  });
  const returnTo = useMemo(() => buildReturnTo(pathname, buildStateParams), [buildStateParams, pathname]);
  const isDepartmentView = viewMode === 'departments';
  const isManagerView = viewMode === 'managers';
  const isAggregateView = isDepartmentView || isManagerView;
  const isApprovedRemoteWorkView = viewMode === 'approved-remote-work';
  const aggregateLabel = isManagerView ? 'Manager' : 'Department';
  const aggregatePluralLabel = isManagerView ? 'managers' : 'departments';
  const currentView = OFFICE_ATTENDANCE_VIEW_OPTIONS.find((option) => option.id === viewMode) ?? OFFICE_ATTENDANCE_VIEW_OPTIONS[0]!;
  const activeLookbackWeeks = useMemo(
    () => getActiveLookbackWeeks(startDate, endDate),
    [endDate, startDate],
  );
  const appliedDateFilterMode = useMemo(
    () => getAppliedDateFilterMode(searchParams, activeLookbackWeeks),
    [activeLookbackWeeks, searchParams],
  );
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>(() => appliedDateFilterMode);
  const [quickRangeDraft, setQuickRangeDraft] = useState<string>(
    () => String(activeLookbackWeeks ?? DEFAULT_OFFICE_ATTENDANCE_LOOKBACK_WEEKS),
  );
  const [customStartDate, setCustomStartDate] = useState(startDate);
  const [customEndDate, setCustomEndDate] = useState(endDate);

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
    setDateFilterMode(appliedDateFilterMode);
    setQuickRangeDraft(String(activeLookbackWeeks ?? DEFAULT_OFFICE_ATTENDANCE_LOOKBACK_WEEKS));
    setCustomStartDate(startDate);
    setCustomEndDate(endDate);
  }, [activeLookbackWeeks, appliedDateFilterMode, endDate, startDate]);

  useEffect(() => {
    setMobileFiltersOpen(false);
  }, [searchParams, viewMode]);

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

  useEffect(() => {
    if (!mobileFiltersOpen || typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileFiltersOpen]);

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
    if (!LOOKBACK_OPTIONS.includes(weeksBack as (typeof LOOKBACK_OPTIONS)[number])) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('dateMode', 'quick');
    params.set('lookbackWeeks', String(weeksBack));
    params.delete('startDate');
    params.delete('endDate');
    router.push(`/dashboard/office-attendance?${params.toString()}`, { scroll: false });
  };

  const changeDates = (nextStart: string, nextEnd: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('dateMode', 'custom');
    params.delete('lookbackWeeks');
    params.set('startDate', nextStart);
    params.set('endDate', nextEnd);
    router.push(`/dashboard/office-attendance?${params.toString()}`, { scroll: false });
  };

  const applyCustomDates = () => {
    if (!customStartDate || !customEndDate) return;
    changeDates(customStartDate, customEndDate);
  };

  const hasFilters =
    Boolean(search) ||
    selectedDepts.length > 0 ||
    selectedLocs.length > 0 ||
    includeApprovedRemoteWork;
  const quickRangeChanged =
    quickRangeDraft !== String(activeLookbackWeeks ?? DEFAULT_OFFICE_ATTENDANCE_LOOKBACK_WEEKS)
    || appliedDateFilterMode !== 'quick';
  const customRangeChanged =
    customStartDate !== startDate
    || customEndDate !== endDate
    || appliedDateFilterMode !== 'custom';

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
    if (isApprovedRemoteWorkView) {
      list = list.filter((r) => r.approvedRemoteWorkRequest);
    } else if (!isAggregateView && !includeApprovedRemoteWork) {
      list = list.filter((r) => !r.approvedRemoteWorkRequest);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.managerName.toLowerCase().includes(q) ||
        (r.managerEmail || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [includeApprovedRemoteWork, isApprovedRemoteWorkView, isAggregateView, rows, search, selectedDepts, selectedLocs]);

  const groupedRows = useMemo<GroupRow[]>(() => {
    const grouped = new Map<string, GroupRow>();
    const groupMembersByKey = new Map<string, Set<string>>();
    const normalizeEmail = (email: string | null | undefined) => email?.toLowerCase().trim() || null;

    const addEmployeeToGroup = (group: GroupRow, row: AttendanceRow) => {
      const isQuebecEmployee = row.officeLocation === DEFAULT_EMPLOYEE_LOCATION;
      const isEligibleEmployee = isQuebecEmployee && !row.approvedRemoteWorkRequest;

      group.employeeCount += 1;
      if (isEligibleEmployee) {
        group.quebecEmployeeCount += 1;
        group.total += row.total;
      } else {
        group.remoteEmployeeCount += 1;
      }
      if (group.officeLocation !== row.officeLocation) {
        group.officeLocation = 'Mixed';
      }

      for (const week of weeks) {
        const cell = row.weeks[week];
        if (!group.weeklyCompliance[week]) {
          group.weeklyCompliance[week] = {
            compliantEmployees: 0,
            eligibleEmployees: 0,
            compliancePct: 0,
            compliantNames: [],
            nonCompliantNames: [],
            fullyRemoteNames: [],
          };
        }

        if (!isEligibleEmployee) {
          group.weeklyCompliance[week]!.fullyRemoteNames.push(row.name);
          continue;
        }

        group.weeklyCompliance[week]!.eligibleEmployees += 1;
        if ((cell?.officeDays ?? 0) >= OFFICE_DAYS_REQUIRED) {
          group.weeklyCompliance[week]!.compliantEmployees += 1;
          group.weeklyCompliance[week]!.compliantNames.push(row.name);
        } else {
          group.weeklyCompliance[week]!.nonCompliantNames.push(row.name);
        }

        const current = group.weeks[week] || {
          officeDays: 0,
          remoteDays: 0,
          ptoDays: 0,
          days: [],
        };
        current.officeDays += cell?.officeDays ?? 0;
        current.remoteDays += cell?.remoteDays ?? 0;
        current.ptoDays += cell?.ptoDays ?? 0;
        group.weeks[week] = current;
      }
    };

    for (const row of filtered) {
      const key = isManagerView
        ? (row.managerEmail || `manager:${row.managerName || 'Unassigned'}`)
        : (row.department || 'Unknown');
      const groupLabel = isManagerView ? (row.managerName || 'Unassigned') : (row.department || 'Unknown');
      const existing = grouped.get(key) || {
        id: key,
        groupLabel,
        employeeCount: 0,
        quebecEmployeeCount: 0,
        remoteEmployeeCount: 0,
        managerName: isManagerView ? groupLabel : undefined,
        managerEmail: isManagerView ? (row.managerEmail || null) : undefined,
        officeLocation: row.officeLocation || 'Unknown',
        weeks: {},
        weeklyCompliance: {},
        total: 0,
        avgPerWeek: 0,
        scorePct: 0,
        trend: 'flat',
      };

      addEmployeeToGroup(existing, row);
      grouped.set(key, existing);
      if (!groupMembersByKey.has(key)) groupMembersByKey.set(key, new Set());
      const normalizedRowEmail = normalizeEmail(row.email);
      if (normalizedRowEmail) {
        groupMembersByKey.get(key)!.add(normalizedRowEmail);
      }
    }

    if (isManagerView) {
      const employeeByEmail = new Map<string, AttendanceRow>();
      for (const row of filtered) {
        const normalizedEmail = normalizeEmail(row.email);
        if (!normalizedEmail) continue;
        if (!employeeByEmail.has(normalizedEmail)) {
          employeeByEmail.set(normalizedEmail, row);
        }
      }
      for (const [key, group] of grouped) {
        const managerEmail = normalizeEmail(group.managerEmail);
        const managerEmployee = managerEmail ? employeeByEmail.get(managerEmail) : null;
        if (!groupMembersByKey.has(key)) groupMembersByKey.set(key, new Set());
        if (managerEmployee) {
          const normalizedManagerEmail = normalizeEmail(managerEmployee.email);
          if (normalizedManagerEmail && groupMembersByKey.get(key)!.has(normalizedManagerEmail)) continue;
          addEmployeeToGroup(group, managerEmployee);
          if (normalizedManagerEmail) {
            groupMembersByKey.get(key)!.add(normalizedManagerEmail);
          }
        } else if (managerEmail) {
          group.employeeCount += 1;
          group.remoteEmployeeCount += 1;
          for (const week of weeks) {
            if (!group.weeklyCompliance[week]) {
              group.weeklyCompliance[week] = {
                compliantEmployees: 0,
                eligibleEmployees: 0,
                compliancePct: 0,
                compliantNames: [],
                nonCompliantNames: [],
                fullyRemoteNames: [],
              };
            }
            group.weeklyCompliance[week]!.fullyRemoteNames.push(group.groupLabel);
          }
        }
        grouped.set(key, group);
      }
    }

    return [...grouped.values()].map((row) => {
      for (const week of weeks) {
        const compliance = row.weeklyCompliance[week] || {
          compliantEmployees: 0,
          eligibleEmployees: 0,
          compliancePct: 0,
          compliantNames: [],
          nonCompliantNames: [],
          fullyRemoteNames: [],
        };
        compliance.compliancePct = compliance.eligibleEmployees > 0
          ? Math.round((compliance.compliantEmployees / compliance.eligibleEmployees) * 100)
          : 0;
        compliance.compliantNames.sort((a, b) => a.localeCompare(b));
        compliance.nonCompliantNames.sort((a, b) => a.localeCompare(b));
        compliance.fullyRemoteNames.sort((a, b) => a.localeCompare(b));
        row.weeklyCompliance[week] = compliance;
      }

      const avgPerWeek = scoredWeeks.length > 0
        ? Math.round((row.total / Math.max(1, row.quebecEmployeeCount) / scoredWeeks.length) * 10) / 10
        : 0;
      const scorePct = scoredWeeks.length > 0
        ? Math.round(
          scoredWeeks.reduce((sum, week) => sum + (row.weeklyCompliance[week]?.compliancePct ?? 0), 0) / scoredWeeks.length,
        )
        : 0;
      let trend: 'up' | 'down' | 'flat' = 'flat';
      if (scoredWeeks.length >= 2) {
        const prevWeek = scoredWeeks[scoredWeeks.length - 2]!;
        const lastWeek = scoredWeeks[scoredWeeks.length - 1]!;
        const prevCompliance = row.weeklyCompliance[prevWeek]?.compliancePct ?? 0;
        const lastCompliance = row.weeklyCompliance[lastWeek]?.compliancePct ?? 0;
        if (lastCompliance > prevCompliance) trend = 'up';
        else if (lastCompliance < prevCompliance) trend = 'down';
      }
      return {
        ...row,
        avgPerWeek,
        scorePct,
        trend,
      };
    });
  }, [filtered, isManagerView, scoredWeeks, weeks]);

  const displayRows = useMemo<DisplayRow[]>(() => {
    const employeeRows: DisplayRow[] = filtered.map((row) => ({
      id: row.email,
      label: row.name,
      secondary: row.department,
      officeLocation: row.officeLocation,
      approvedRemoteWorkRequest: row.approvedRemoteWorkRequest,
      remoteWorkStatusLabel: row.remoteWorkStatusLabel,
      weeks: row.weeks,
      total: row.total,
      avgPerWeek: row.avgPerWeek,
      scorePct: calculateScorePct(row.weeks, scoredWeeks),
      trend: row.trend,
      managerName: row.managerName,
      managerEmail: row.managerEmail,
      email: row.email,
    }));

    const aggregateDisplayRows: DisplayRow[] = groupedRows.map((row) => ({
      id: row.id,
      label: row.groupLabel,
      secondary: String(row.employeeCount),
      officeLocation: row.officeLocation,
      approvedRemoteWorkRequest: false,
      remoteWorkStatusLabel: '—',
      weeks: Object.fromEntries(
        weeks.map((week) => {
          const cell = row.weeks[week];
          const compliance = row.weeklyCompliance[week];
          const employeeCount = Math.max(1, row.quebecEmployeeCount);
          return [week, {
            officeDays: compliance?.compliancePct ?? 0,
            remoteDays: compliance?.compliantEmployees ?? 0,
            ptoDays: compliance?.eligibleEmployees ?? 0,
            days: [],
          }];
        }),
      ),
      total: row.total,
      avgPerWeek: row.avgPerWeek,
      scorePct: row.scorePct,
      trend: row.trend,
      employeeCount: row.employeeCount,
      quebecEmployeeCount: row.quebecEmployeeCount,
      remoteEmployeeCount: row.remoteEmployeeCount,
      weeklyCompliance: row.weeklyCompliance,
    }));

    return isAggregateView ? aggregateDisplayRows : employeeRows;
  }, [filtered, groupedRows, isAggregateView, scoredWeeks, weeks]);

  const sorted = useMemo(() => {
    const arr = [...displayRows];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === 'name') return dir * a.label.localeCompare(b.label);
      if (sortKey === 'department') {
        if (isAggregateView) return dir * ((Number(a.secondary) || 0) - (Number(b.secondary) || 0));
        return dir * a.secondary.localeCompare(b.secondary);
      }
      if (sortKey === 'quebecEmployeeCount') return dir * ((a.quebecEmployeeCount ?? 0) - (b.quebecEmployeeCount ?? 0));
      if (sortKey === 'remoteEmployeeCount') return dir * ((a.remoteEmployeeCount ?? 0) - (b.remoteEmployeeCount ?? 0));
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
  }, [displayRows, isAggregateView, sortDir, sortKey]);

  const filteredSummary = useMemo(() => {
    const totalEmployees = filtered.length;
    const totalGroups = groupedRows.length;
    const numCompletedWeeks = scoredWeeks.length;
    const totalEligibleQuebecEmployees = groupedRows.reduce((sum, row) => sum + row.quebecEmployeeCount, 0);
    let zeroCount = 0;
    let sumOfficeDays = 0;
    let sumScorePct = 0;

    if (isAggregateView) {
      for (const row of groupedRows) {
        if (row.total === 0) zeroCount++;
        sumScorePct += row.scorePct;
        for (const week of scoredWeeks) {
          sumOfficeDays += row.weeks[week]?.officeDays ?? 0;
        }
      }
    } else {
      for (const row of filtered) {
        if (row.total === 0) zeroCount++;
        sumScorePct += calculateScorePct(row.weeks, scoredWeeks);
        for (const week of scoredWeeks) {
          sumOfficeDays += row.weeks[week]?.officeDays ?? 0;
        }
      }
    }

    const avgOfficeDays = (isAggregateView ? totalEligibleQuebecEmployees : totalEmployees) > 0 && numCompletedWeeks > 0
      ? Math.round((sumOfficeDays / Math.max(1, isAggregateView ? totalEligibleQuebecEmployees : totalEmployees) / numCompletedWeeks) * 10) / 10
      : 0;
    const complianceRate = (isAggregateView ? totalGroups : totalEmployees) > 0
      ? Math.round(sumScorePct / Math.max(1, isAggregateView ? totalGroups : totalEmployees))
      : 0;
    const zeroOfficeDepartments = groupedRows.filter((row) => row.total === 0).length;

    return {
      totalEmployees,
      totalDepartments: totalGroups,
      avgOfficeDays,
      complianceRate,
      zeroOfficeDaysCount: zeroCount,
      zeroOfficeDepartments,
    };
  }, [filtered, groupedRows, isAggregateView, scoredWeeks]);

  const filteredRemoteWorkRequests = useMemo(() => {
    let list = [...remoteWorkRequests];
    if (selectedDepts.length > 0) {
      const deptSet = new Set(selectedDepts);
      list = list.filter((request) => deptSet.has(request.department));
    }
    if (selectedLocs.length > 0) {
      const locSet = new Set(selectedLocs);
      list = list.filter((request) => locSet.has(request.officeLocation));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((request) =>
        request.employeeName.toLowerCase().includes(q) ||
        request.department.toLowerCase().includes(q) ||
        (request.remoteWorkType || '').toLowerCase().includes(q) ||
        (request.managerName || '').toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      const aDate = a.remoteWorkStartDate;
      const bDate = b.remoteWorkStartDate;
      if (sortDir === 'asc') {
        return aDate.localeCompare(bDate) || a.employeeName.localeCompare(b.employeeName);
      }
      return bDate.localeCompare(aDate) || a.employeeName.localeCompare(b.employeeName);
    });
    return list;
  }, [remoteWorkRequests, search, selectedDepts, selectedLocs, sortDir]);

  const remoteWorkSummary = useMemo(() => {
    const uniqueEmployees = new Set(filteredRemoteWorkRequests.map((request) => request.email || request.employeeId));
    const permanentRequests = filteredRemoteWorkRequests.filter((request) => (request.remoteWorkType || '').toLowerCase() === 'permanent').length;
    const alternateOfficeDates = filteredRemoteWorkRequests.filter((request) =>
      request.alternateInOfficeWorkDate &&
      request.alternateInOfficeWorkDate !== 'Not Applicable',
    ).length;
    return {
      totalRequests: filteredRemoteWorkRequests.length,
      uniqueEmployees: uniqueEmployees.size,
      permanentRequests,
      alternateOfficeDates,
    };
  }, [filteredRemoteWorkRequests]);

  const activeRowsCount = isApprovedRemoteWorkView ? filteredRemoteWorkRequests.length : sorted.length;
  const totalPages = Math.max(1, Math.ceil(activeRowsCount / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageRemoteWorkRows = filteredRemoteWorkRequests.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const activeFilterCount =
    (search ? 1 : 0) +
    (selectedDepts.length > 0 ? 1 : 0) +
    (selectedLocs.length > 0 ? 1 : 0) +
    (includeApprovedRemoteWork ? 1 : 0);

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
    if (isApprovedRemoteWorkView) {
      const headers = [
        'Bamboo Row ID',
        'Employee ID',
        'Employee Name',
        'Department',
        'Office Location',
        'Request Date',
        'Remote Work Start Date',
        'Remote Work End Date',
        'Remote Work Type',
        'Supporting Documentation Submitted',
        'Alternate In-Office Work Date',
        'Manager Approval Received',
        'Manager Name',
      ];

      const csvRows = filteredRemoteWorkRequests.map((request) => [
        String(request.bambooRowId),
        request.employeeId,
        request.employeeName,
        request.department,
        request.officeLocation,
        request.requestDate || '',
        request.remoteWorkStartDate,
        request.remoteWorkEndDate || '',
        request.remoteWorkType || '',
        request.supportingDocumentationSubmitted || '',
        request.alternateInOfficeWorkDate || '',
        request.managerApprovalReceived || '',
        request.managerName || '',
      ]);

      const csv = [headers.join(','), ...csvRows.map((row) => row.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(','))].join('\n');
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `office-attendance-approved-remote-work-${startDate}-${endDate}.csv`);
      return;
    }

    const headers = [
      isAggregateView ? aggregateLabel : 'Employee',
      isAggregateView ? 'Employees' : 'Department',
      ...(isAggregateView ? ['Quebec Employees', 'Remote/Exempt Employees'] : []),
      'Location',
      'Remote Workday',
      ...weeks.map((w) => getWeekLabel(w)),
      isAggregateView ? 'Total Office Days' : 'Total',
      'Avg/Week',
      'Score %',
      'Trend',
    ];

    const csvRows = sorted.map((r) => [
      r.label,
      r.secondary,
      ...(isAggregateView ? [String(r.quebecEmployeeCount ?? 0), String(r.remoteEmployeeCount ?? 0)] : []),
      r.officeLocation,
      isAggregateView ? '—' : r.remoteWorkStatusLabel,
      ...weeks.map((w) => isAggregateView ? `${r.weeklyCompliance?.[w]?.compliancePct ?? 0}%` : String(r.weeks[w]?.officeDays ?? 0)),
      String(r.total),
      String(r.avgPerWeek),
      `${r.scorePct}%`,
      r.trend,
    ]);

    const csvLines = [headers.join(','), ...csvRows.map((row) => row.map((c) => `"${c}"`).join(','))];

    if (isAggregateView) {
      csvLines.push('');
      csvLines.push('Weekly Breakdown');
      const detailHeaders = ['Group', 'Week', 'Compliance %', 'Eligible Quebec', 'Compliant Count', 'Compliant', 'Non-compliant', 'Fully remote'];
      csvLines.push(detailHeaders.join(','));
      for (const row of sorted) {
        for (const week of weeks) {
          const compliance = row.weeklyCompliance?.[week];
          if (!compliance) continue;
          csvLines.push([
            row.label,
            getWeekLabel(week),
            `${compliance.compliancePct}%`,
            String(compliance.eligibleEmployees),
            String(compliance.compliantEmployees),
            formatNameBucket(compliance.compliantNames),
            formatNameBucket(compliance.nonCompliantNames),
            formatNameBucket(compliance.fullyRemoteNames),
          ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
        }
      }
    }

    const csv = csvLines.join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `office-attendance-${startDate}-${endDate}-${viewMode}.csv`);
  };

  const exportXLSX = async () => {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Office Attendance');

    if (isApprovedRemoteWorkView) {
      const headers = [
        'Bamboo Row ID',
        'Employee ID',
        'Employee Name',
        'Department',
        'Office Location',
        'Request Date',
        'Remote Work Start Date',
        'Remote Work End Date',
        'Remote Work Type',
        'Supporting Documentation Submitted',
        'Alternate In-Office Work Date',
        'Manager Approval Received',
        'Manager Name',
      ];
      const headerRow = ws.addRow(headers);
      headerRow.font = { bold: true, size: 11 };
      headerRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
      });

      for (const request of filteredRemoteWorkRequests) {
        ws.addRow([
          request.bambooRowId,
          request.employeeId,
          request.employeeName,
          request.department,
          request.officeLocation,
          request.requestDate || '',
          request.remoteWorkStartDate,
          request.remoteWorkEndDate || '',
          request.remoteWorkType || '',
          request.supportingDocumentationSubmitted || '',
          request.alternateInOfficeWorkDate || '',
          request.managerApprovalReceived || '',
          request.managerName || '',
        ]);
      }

      ws.columns.forEach((col, index) => {
        col.width = index === 2 || index === 3 || index === 11 ? 24 : 18;
      });

      const buffer = await wb.xlsx.writeBuffer();
      downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `office-attendance-approved-remote-work-${startDate}-${endDate}.xlsx`);
      return;
    }

    const headers = [
      isAggregateView ? aggregateLabel : 'Employee',
      isAggregateView ? 'Employees' : 'Department',
      ...(isAggregateView ? ['Quebec Employees', 'Remote/Exempt Employees'] : []),
      'Location',
      'Remote Workday',
      ...weeks.map((w) => getWeekLabel(w)),
      isAggregateView ? 'Total Office Days' : 'Total',
      'Avg/Week',
      'Score %',
      'Trend',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true, size: 11 };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
    });

    const summaryRow = ws.addRow([
      isAggregateView ? `${filteredSummary.totalDepartments} ${aggregatePluralLabel}` : `${filteredSummary.totalEmployees} employees`,
      isAggregateView ? `${filteredSummary.totalEmployees} employees` : '',
      ...(isAggregateView ? ['', ''] : []),
      '',
      `${filteredSummary.complianceRate}% score`,
      ...weeks.map(() => ''),
      '',
      String(filteredSummary.avgOfficeDays),
      isAggregateView
        ? `${filteredSummary.zeroOfficeDepartments} zero-office ${aggregatePluralLabel}`
        : `${filteredSummary.zeroOfficeDaysCount} zero office days`,
      '',
    ]);
    summaryRow.font = { italic: true, size: 10, color: { argb: '6B7280' } };

    for (const r of sorted) {
      const row = ws.addRow([
        r.label,
        r.secondary,
        ...(isAggregateView ? [r.quebecEmployeeCount ?? 0, r.remoteEmployeeCount ?? 0] : []),
        r.officeLocation,
        isAggregateView ? '—' : r.remoteWorkStatusLabel,
        ...weeks.map((w) => isAggregateView ? `${r.weeklyCompliance?.[w]?.compliancePct ?? 0}%` : (r.weeks[w]?.officeDays ?? 0)),
        r.total, r.avgPerWeek,
        r.scorePct, r.trend,
      ]);

      weeks.forEach((w, i) => {
        const weekColumnIndex = (isAggregateView ? 7 : 5) + i;
        const cell = row.getCell(weekColumnIndex);
        const wc = r.weeks[w];
        const compliance = r.weeklyCompliance?.[w];
        const hex = isAggregateView
          ? (compliance?.eligibleEmployees ?? 0) <= 0
              ? 'F3F4F6'
              : (compliance?.compliancePct ?? 0) >= 80
                  ? 'DCFCE7'
                  : (compliance?.compliancePct ?? 0) >= 50
                      ? 'FEF3C7'
                      : 'FEE2E2'
          : getCellHex(wc?.officeDays ?? 0, wc?.ptoDays ?? 0);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex } };
      });
    }

    if (isAggregateView) {
      const detailSheet = wb.addWorksheet('Weekly Breakdown');
      const detailHeaders = ['Group', 'Week', 'Compliance %', 'Eligible Quebec', 'Compliant Count', 'Compliant', 'Non-compliant', 'Fully remote'];
      const detailHeaderRow = detailSheet.addRow(detailHeaders);
      detailHeaderRow.font = { bold: true, size: 11 };
      detailHeaderRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
      });

      for (const row of sorted) {
        for (const week of weeks) {
          const compliance = row.weeklyCompliance?.[week];
          if (!compliance) continue;
          detailSheet.addRow([
            row.label,
            getWeekLabel(week),
            `${compliance.compliancePct}%`,
            compliance.eligibleEmployees,
            compliance.compliantEmployees,
            formatNameBucket(compliance.compliantNames),
            formatNameBucket(compliance.nonCompliantNames),
            formatNameBucket(compliance.fullyRemoteNames),
          ]);
        }
      }

      detailSheet.columns.forEach((col, index) => {
        col.width = index >= 5 ? 42 : index === 0 ? 28 : 18;
      });
    }

    ws.columns.forEach((col) => {
      col.width = 14;
    });
    if (ws.columns[0]) ws.columns[0].width = 24;

    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `office-attendance-${startDate}-${endDate}-${viewMode}.xlsx`);
  };

  const resultLabel = isApprovedRemoteWorkView ? 'requests' : isAggregateView ? aggregatePluralLabel : 'employees';
  const primaryMetricLabel = isApprovedRemoteWorkView
    ? 'Approved Requests'
    : isAggregateView
      ? currentView.label
      : 'Employees';
  const averageMetricLabel = isApprovedRemoteWorkView ? 'Employees' : isAggregateView ? 'Avg Office Days/Emp/Week' : 'Avg Office Days/Week';
  const zeroMetricLabel = isApprovedRemoteWorkView ? 'Permanent Requests' : isAggregateView ? `Zero-Office ${aggregateLabel}s` : 'Zero Office Days';

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
      <div className="space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-gray-900">{currentView.label}</h2>
              <p className="mt-0.5 text-[12px] text-gray-500">
                {isApprovedRemoteWorkView
                  ? 'All remote-work request records from Oracle. Use Manager Approval to see the request status.'
                  : isAggregateView
                    ? `Weekly compliance is based on Quebec, non-exempt employees meeting the ${OFFICE_DAYS_REQUIRED}-day target.`
                    : `${currentView.description} Target ${OFFICE_DAYS_REQUIRED} office days per week.`}
              </p>
              <p className="mt-1 text-[11px] text-gray-400">
                Applied: {appliedDateFilterMode === 'quick' ? `Quick range (${activeLookbackWeeks ?? DEFAULT_OFFICE_ATTENDANCE_LOOKBACK_WEEKS} weeks)` : 'Custom dates'} · {formatRangeLabel(startDate, endDate)}
              </p>
            </div>
            <div className="hidden items-center gap-2 md:flex">
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

          <div className="grid gap-2 md:hidden">
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                <button
                  type="button"
                  onClick={() => setDateFilterMode('quick')}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                    dateFilterMode === 'quick'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Quick Range
                </button>
                <button
                  type="button"
                  onClick={() => setDateFilterMode('custom')}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                    dateFilterMode === 'custom'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Custom Dates
                </button>
              </div>

              {dateFilterMode === 'quick' ? (
                <div className="mt-3 grid gap-2">
                  <label className="space-y-1">
                    <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-500">Quick Range</span>
                    <select
                      value={quickRangeDraft}
                      onChange={(e) => setQuickRangeDraft(e.target.value)}
                      className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
                    >
                      {LOOKBACK_OPTIONS.map((w) => (
                        <option key={w} value={w}>{w} weeks</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => changeLookback(quickRangeDraft)}
                    disabled={!quickRangeChanged}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Apply Quick Range
                  </button>
                </div>
              ) : (
                <div className="mt-3 grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-500">Start</span>
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value || customStartDate)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-500">End</span>
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value || customEndDate)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={applyCustomDates}
                    disabled={!customRangeChanged || !customStartDate || !customEndDate}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Apply Custom Dates
                  </button>
                </div>
              )}
            </div>
            <div>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
              >
                <Filter className="size-3.5" />
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={exportCSV}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
              >
                <Download className="size-3.5" />
                CSV
              </button>
              <button
                onClick={exportXLSX}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
              >
                <Download className="size-3.5" />
                XLSX
              </button>
            </div>
          </div>

          <div className="hidden rounded-xl border border-gray-200 bg-white p-4 md:block">
            <div className="flex items-center justify-between gap-4">
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                <button
                  type="button"
                  onClick={() => setDateFilterMode('quick')}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                    dateFilterMode === 'quick'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Quick Range
                </button>
                <button
                  type="button"
                  onClick={() => setDateFilterMode('custom')}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                    dateFilterMode === 'custom'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Custom Dates
                </button>
              </div>
              <p className="text-[11px] text-gray-400">
                Only one date mode is active at a time.
              </p>
            </div>

            {dateFilterMode === 'quick' ? (
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,220px),auto,1fr] md:items-end">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Quick Range</label>
                  <select
                    value={quickRangeDraft}
                    onChange={(e) => setQuickRangeDraft(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
                  >
                    {LOOKBACK_OPTIONS.map((w) => (
                      <option key={w} value={w}>{w} weeks</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => changeLookback(quickRangeDraft)}
                  disabled={!quickRangeChanged}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Apply Quick Range
                </button>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,180px),minmax(0,180px),auto,1fr] md:items-end">
                <label>
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Start</span>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value || customStartDate)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">End</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value || customEndDate)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={applyCustomDates}
                  disabled={!customRangeChanged || !customStartDate || !customEndDate}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Apply Custom Dates
                </button>
              </div>
            )}
          </div>

          <div className="hidden flex-col gap-3 md:flex md:flex-row md:items-end">
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
            {!isAggregateView && !isApprovedRemoteWorkView && (
              <div className="w-full md:w-56">
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Approved Remote Work</label>
                <select
                  value={includeApprovedRemoteWork ? 'include' : 'exclude'}
                  onChange={(e) => {
                    setIncludeApprovedRemoteWork(e.target.value === 'include');
                    setPage(0);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
                >
                  <option value="exclude">Exclude Approved Remote Work</option>
                  <option value="include">Include Approved Remote Work</option>
                </select>
              </div>
            )}
            {hasFilters && (
              <button
                onClick={() => {
                  setSearch('');
                  setSelectedDepts([]);
                  setSelectedLocs(viewMode === 'employees' && locations.includes(DEFAULT_EMPLOYEE_LOCATION) ? [DEFAULT_EMPLOYEE_LOCATION] : []);
                  setIncludeApprovedRemoteWork(false);
                  setPage(0);
                }}
                className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-50"
              >
                Reset
              </button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[11px] font-medium text-gray-500">{primaryMetricLabel}</p>
              <p className="mt-1 text-[22px] font-semibold text-gray-900">
                {isApprovedRemoteWorkView
                  ? remoteWorkSummary.totalRequests
                  : isAggregateView
                    ? filteredSummary.totalDepartments
                    : filteredSummary.totalEmployees}
              </p>
              {isApprovedRemoteWorkView ? (
                <p className="mt-1 text-[11px] text-gray-400">All remote-work request records from `TL_REMOTE_WORK_REQUESTS`. See `Manager Approval` for status.</p>
              ) : isAggregateView ? (
                <p className="mt-1 text-[11px] text-gray-400">{filteredSummary.totalEmployees} employees covered</p>
              ) : null}
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[11px] font-medium text-gray-500">{averageMetricLabel}</p>
              <p className="mt-1 text-[22px] font-semibold text-gray-900">
                {isApprovedRemoteWorkView ? remoteWorkSummary.uniqueEmployees : filteredSummary.avgOfficeDays}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[11px] font-medium text-gray-500">{isApprovedRemoteWorkView ? 'Alternate Office Dates' : 'Score'}</p>
              {isApprovedRemoteWorkView ? (
                <p className="mt-1 text-[22px] font-semibold text-gray-900">{remoteWorkSummary.alternateOfficeDates}</p>
              ) : (
                <>
                  <p className={`mt-1 text-[22px] font-semibold ${filteredSummary.complianceRate >= 80 ? 'text-green-600' : filteredSummary.complianceRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                    {filteredSummary.complianceRate}%
                  </p>
                  <p className="mt-1 text-[11px] text-gray-400">0 days = 0, 1 day = 50, 2+ days = 100</p>
                </>
              )}
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[11px] font-medium text-gray-500">{zeroMetricLabel}</p>
              {isApprovedRemoteWorkView ? (
                <p className="mt-1 text-[22px] font-semibold text-gray-900">{remoteWorkSummary.permanentRequests}</p>
              ) : (
                <p className={`mt-1 text-[22px] font-semibold ${
                  (isAggregateView ? filteredSummary.zeroOfficeDepartments : filteredSummary.zeroOfficeDaysCount) > 0
                    ? 'text-red-600'
                    : 'text-gray-900'
                }`}>
                  {isAggregateView ? filteredSummary.zeroOfficeDepartments : filteredSummary.zeroOfficeDaysCount}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between text-[12px] text-gray-500">
            <span>{activeRowsCount} {resultLabel} {hasFilters ? '(filtered)' : ''}</span>
            <span>Page {page + 1} of {totalPages}</span>
          </div>

          {showScrollRail && !isApprovedRemoteWorkView ? (
            <div className="sticky top-20 z-20 -mb-2 hidden md:block">
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

          {isApprovedRemoteWorkView ? (
            <div className="rounded-xl border border-gray-200 bg-white md:hidden">
              {filteredRemoteWorkRequests.length === 0 ? (
                <div className="p-12 text-center text-[13px] text-gray-500">No {resultLabel} match filters.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {pageRemoteWorkRows.map((request) => (
                    <article key={request.bambooRowId} className="space-y-4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-[14px] font-semibold text-gray-900">{request.employeeName}</h3>
                          <p className="mt-1 text-[12px] text-gray-500">{request.email}</p>
                          <p className="mt-0.5 text-[12px] text-gray-500">{request.department}</p>
                        </div>
                        <span className="inline-flex rounded-full bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-700">
                          {request.remoteWorkType || 'Approved'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Request Date</p>
                          <p className="mt-1 text-[12px] font-semibold text-gray-900">{formatOptionalDate(request.requestDate)}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Start</p>
                          <p className="mt-1 text-[12px] font-semibold text-gray-900">{formatOptionalDate(request.remoteWorkStartDate)}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">End</p>
                          <p className="mt-1 text-[12px] font-semibold text-gray-900">{formatOptionalDate(request.remoteWorkEndDate)}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Manager Approval</p>
                          <p className="mt-1 text-[12px] font-semibold text-gray-900">{request.managerApprovalReceived || '—'}</p>
                        </div>
                      </div>

                      <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-3 text-[12px] text-gray-600">
                        <div><span className="font-medium text-gray-900">Supporting Docs:</span> {request.supportingDocumentationSubmitted || '—'}</div>
                        <div><span className="font-medium text-gray-900">Alternate In-Office Date:</span> {request.alternateInOfficeWorkDate || '—'}</div>
                        <div><span className="font-medium text-gray-900">Manager:</span> {request.managerName || '—'}</div>
                        <div><span className="font-medium text-gray-900">Office Location:</span> {request.officeLocation}</div>
                        <div><span className="font-medium text-gray-900">Bamboo Row ID:</span> {request.bambooRowId}</div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {!isApprovedRemoteWorkView ? (
            <div className="rounded-xl border border-gray-200 bg-white md:hidden">
              {sorted.length === 0 ? (
              <div className="p-12 text-center text-[13px] text-gray-500">No {resultLabel} match filters.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {pageRows.map((row) => (
                  <article key={row.id} className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {row.email ? (
                          <button
                            type="button"
                            onClick={() => setDetail({ row })}
                            className="truncate text-left text-[14px] font-semibold text-gray-900 hover:underline"
                          >
                            {row.label}
                          </button>
                        ) : (
                          <h3 className="text-[14px] font-semibold text-gray-900">{row.label}</h3>
                        )}
                        <p className="mt-1 text-[12px] text-gray-500">
                          {isAggregateView ? `${row.secondary} employees` : row.secondary}
                        </p>
                        <p className="mt-0.5 text-[12px] text-gray-500">{row.officeLocation}</p>
                      </div>
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${scoreTone(row.scorePct)}`}>
                        {row.scorePct}%
                      </span>
                    </div>

                    {!isAggregateView ? (
                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${row.approvedRemoteWorkRequest ? 'bg-sky-50 text-sky-700' : 'bg-gray-100 text-gray-600'}`}>
                          {row.remoteWorkStatusLabel}
                        </span>
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-600">
                          {row.email}
                        </span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Quebec</p>
                          <p className="mt-1 text-[14px] font-semibold text-gray-900">{row.quebecEmployeeCount ?? 0}</p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Remote/Exempt</p>
                          <p className="mt-1 text-[14px] font-semibold text-gray-900">{row.remoteEmployeeCount ?? 0}</p>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Total</p>
                        <p className="mt-1 text-[16px] font-semibold text-gray-900">{row.total}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Avg/Week</p>
                        <p className="mt-1 text-[16px] font-semibold text-gray-900">{row.avgPerWeek}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Trend</p>
                        <p className="mt-1 text-[16px] font-semibold text-gray-900">
                          {row.trend === 'up' ? 'Up' : row.trend === 'down' ? 'Down' : 'Flat'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{isAggregateView ? 'Compliance' : 'Weeks'}</p>
                        <p className="mt-1 text-[16px] font-semibold text-gray-900">
                          {isAggregateView ? `${row.scorePct}%` : weeks.length}
                        </p>
                      </div>
                    </div>

                    <details className="rounded-lg border border-gray-200 bg-gray-50/80">
                      <summary className="cursor-pointer list-none px-3 py-2 text-[12px] font-medium text-gray-700">
                        Weekly breakdown
                      </summary>
                      <div className="space-y-2 border-t border-gray-200 px-3 py-3">
                        {weeks.map((week) => {
                          const cell = row.weeks[week];
                          const office = cell?.officeDays ?? 0;
                          const remote = cell?.remoteDays ?? 0;
                          const pto = cell?.ptoDays ?? 0;
                          const departmentCompliance = row.weeklyCompliance?.[week];
                          return (
                            <div key={week} className="rounded-lg bg-white px-3 py-2 shadow-sm">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-[12px] font-medium text-gray-900">{getWeekLabel(week)}</p>
                              <span className={`inline-flex min-h-6 min-w-12 items-center justify-center rounded px-2 text-[11px] font-medium ${
                                  isAggregateView
                                    ? complianceValueTone(departmentCompliance?.compliancePct ?? 0, departmentCompliance?.eligibleEmployees ?? 0)
                                    : getCellColor(office, pto)
                                }`}>
                                  {isAggregateView ? `${departmentCompliance?.compliancePct ?? 0}%` : office}
                                </span>
                              </div>
                              {isAggregateView ? (
                                <div className="mt-2 space-y-3 text-[11px] text-gray-500">
                                  <div className="grid grid-cols-3 gap-2">
                                    <div>
                                      <p className="uppercase tracking-wider text-gray-400">Eligible</p>
                                      <p className="mt-1 font-medium text-gray-700">{departmentCompliance?.eligibleEmployees ?? 0}</p>
                                    </div>
                                    <div>
                                      <p className="uppercase tracking-wider text-gray-400">Compliant</p>
                                      <p className="mt-1 font-medium text-gray-700">{departmentCompliance?.compliantEmployees ?? 0}</p>
                                    </div>
                                    <div>
                                      <p className="uppercase tracking-wider text-gray-400">Office Days</p>
                                      <p className="mt-1 font-medium text-gray-700">{office}</p>
                                    </div>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-wider text-gray-400">Compliant</p>
                                    <p className="mt-1 leading-5 text-gray-600">{formatNameBucket(departmentCompliance?.compliantNames ?? [])}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-wider text-gray-400">Non-compliant</p>
                                    <p className="mt-1 leading-5 text-gray-600">{formatNameBucket(departmentCompliance?.nonCompliantNames ?? [])}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-wider text-gray-400">Fully remote</p>
                                    <p className="mt-1 leading-5 text-gray-600">{formatNameBucket(departmentCompliance?.fullyRemoteNames ?? [])}</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-gray-500">
                                  <div>
                                    <p className="uppercase tracking-wider text-gray-400">Office</p>
                                    <p className="mt-1 font-medium text-gray-700">{office}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-wider text-gray-400">Remote</p>
                                    <p className="mt-1 font-medium text-gray-700">{remote}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-wider text-gray-400">PTO</p>
                                    <p className="mt-1 font-medium text-gray-700">{pto}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </article>
                ))}
              </div>
              )}
            </div>
          ) : null}

          {isApprovedRemoteWorkView ? (
            <div className="hidden rounded-xl border border-gray-200 bg-white md:block">
              <div className="max-h-[70vh] overflow-auto">
                <table className="min-w-[1200px] border-collapse">
                  <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-white/95 [&_th]:backdrop-blur">
                    <tr className="border-b border-gray-100">
                      <th className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Employee</th>
                      <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Department</th>
                      <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Request Date</th>
                      <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Start Date</th>
                      <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">End Date</th>
                      <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Type</th>
                      <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Supporting Docs</th>
                      <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Alternate In-Office Date</th>
                      <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Manager Approval</th>
                      <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Manager</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pageRemoteWorkRows.map((request) => (
                      <tr key={request.bambooRowId} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-[13px] font-medium text-gray-900">
                          <div>{request.employeeName}</div>
                          <div className="mt-1 text-[11px] text-gray-400">Row {request.bambooRowId} • {request.officeLocation}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{request.department}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{formatOptionalDate(request.requestDate)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-900">{formatOptionalDate(request.remoteWorkStartDate)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{formatOptionalDate(request.remoteWorkEndDate)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{request.remoteWorkType || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{request.supportingDocumentationSubmitted || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{request.alternateInOfficeWorkDate || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{request.managerApprovalReceived || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{request.managerName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredRemoteWorkRequests.length === 0 ? (
                  <div className="p-12 text-center text-[13px] text-gray-500">No {resultLabel} match filters.</div>
                ) : null}
              </div>
            </div>
          ) : null}

          {!isApprovedRemoteWorkView ? (
            <div className="hidden rounded-xl border border-gray-200 bg-white md:block">
              <div ref={tableScrollRef} className="max-h-[70vh] overflow-auto">
              <table className="w-full border-collapse">
                <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-white/95 [&_th]:backdrop-blur">
                  <tr className="border-b border-gray-100">
                    <th
                      className="sticky left-0 z-10 cursor-pointer select-none whitespace-nowrap bg-white px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900"
                      onClick={() => handleSort('name')}
                    >
                      {isAggregateView ? aggregateLabel : 'Employee'} {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <SortHeader label={isAggregateView ? 'Employees' : 'Dept'} colKey="department" />
                    {isAggregateView ? <SortHeader label="Quebec" colKey="quebecEmployeeCount" align="center" /> : null}
                    {isAggregateView ? <SortHeader label="Remote/Exempt" colKey="remoteEmployeeCount" align="center" /> : null}
                    <SortHeader label="Location" colKey="officeLocation" />
                    {weeks.map((w) => {
                      const isCurrent = w === currentWeek;
                      return (
                        <th
                          key={w}
                          className={`cursor-pointer select-none whitespace-nowrap px-2 py-3 text-center text-[10px] font-medium uppercase tracking-wider hover:text-gray-900 ${isCurrent ? 'bg-gray-50 text-gray-400' : 'text-gray-500'}`}
                          onClick={() => handleSort(w)}
                        >
                          {getWeekLabel(w)}
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
                      {isAggregateView ? (
                        <td className="whitespace-nowrap px-3 py-2 text-center text-[12px] text-gray-600">{row.quebecEmployeeCount ?? 0}</td>
                      ) : null}
                      {isAggregateView ? (
                        <td className="whitespace-nowrap px-3 py-2 text-center text-[12px] text-gray-600">{row.remoteEmployeeCount ?? 0}</td>
                      ) : null}
                      <td className="whitespace-nowrap px-3 py-2 text-[12px] text-gray-500">{row.officeLocation}</td>
                      {weeks.map((w) => {
                        const cell = row.weeks[w];
                        const office = cell?.officeDays ?? 0;
                        const remote = cell?.remoteDays ?? 0;
                        const pto = cell?.ptoDays ?? 0;
                        const departmentCompliance = row.weeklyCompliance?.[w];
                        const color = isAggregateView
                          ? complianceValueTone(departmentCompliance?.compliancePct ?? 0, departmentCompliance?.eligibleEmployees ?? 0)
                          : getCellColor(office, pto);
                        return (
                          <td key={w} className="px-2 py-1.5 text-center">
                            <div className="group relative inline-flex">
                              <span className={`inline-flex min-h-6 min-w-8 cursor-default items-center justify-center rounded px-1 text-[11px] font-medium ${color}`}>
                                {isAggregateView ? `${departmentCompliance?.compliancePct ?? 0}%` : office}
                              </span>
                              <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-80 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                                <div className="text-left text-[11px]">
                                  {isAggregateView ? (
                                    <div className="space-y-3 text-gray-600">
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                        <div className="flex justify-between gap-3"><span>Eligible Quebec</span><span className="font-medium text-gray-900">{departmentCompliance?.eligibleEmployees ?? 0}</span></div>
                                        <div className="flex justify-between gap-3"><span>Compliant</span><span className="font-medium text-gray-900">{departmentCompliance?.compliantEmployees ?? 0}</span></div>
                                        <div className="flex justify-between gap-3"><span>Compliance</span><span className="font-medium text-gray-900">{departmentCompliance?.compliancePct ?? 0}%</span></div>
                                        <div className="flex justify-between gap-3"><span>Office Days</span><span className="font-medium text-gray-900">{office}</span></div>
                                      </div>
                                      <div>
                                        <p className="uppercase tracking-wider text-gray-400">Compliant</p>
                                        <p className="mt-1 leading-5">{formatNameBucket(departmentCompliance?.compliantNames ?? [])}</p>
                                      </div>
                                      <div>
                                        <p className="uppercase tracking-wider text-gray-400">Non-compliant</p>
                                        <p className="mt-1 leading-5">{formatNameBucket(departmentCompliance?.nonCompliantNames ?? [])}</p>
                                      </div>
                                      <div>
                                        <p className="uppercase tracking-wider text-gray-400">Fully remote</p>
                                        <p className="mt-1 leading-5">{formatNameBucket(departmentCompliance?.fullyRemoteNames ?? [])}</p>
                                      </div>
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
                <div className="p-12 text-center text-[13px] text-gray-500">No {resultLabel} match filters.</div>
              )}
            </div>
            </div>
          ) : null}
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
      {!isApprovedRemoteWorkView ? (
        <div className="flex flex-wrap gap-4 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.compliant}`} /> {OFFICE_DAYS_REQUIRED}+ days</span>
          <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.partial}`} /> 1 day</span>
          <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.absent}`} /> 0 days</span>
          <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.pto}`} /> PTO week overlay</span>
          {currentWeek && <span className="flex items-center gap-1.5"><span className="text-gray-400">*</span> Current week (in progress, excluded from score)</span>}
        </div>
      ) : null}

      {detail ? (
        <AttendanceDetailModal
          row={detail.row}
          weeks={weeks}
          scoredWeeks={scoredWeeks}
          returnTo={returnTo}
          onClose={closeDetail}
        />
      ) : null}

      {mobileFiltersOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-gray-950/35"
            onClick={() => setMobileFiltersOpen(false)}
            aria-label="Close filters"
          />
          <div className="absolute inset-x-0 bottom-0 top-16 overflow-y-auto rounded-t-3xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-4">
              <div>
                <h3 className="text-[14px] font-semibold text-gray-900">Filters</h3>
                <p className="mt-0.5 text-[12px] text-gray-500">{activeFilterCount} active</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-500"
                aria-label="Close filters"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-5 px-4 py-4">
              <div>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Search</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  placeholder="Name, email, or department..."
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-gray-300 focus:outline-none"
                />
              </div>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Location</h4>
                  <span className="text-[11px] text-gray-400">{selectedLocs.length || 'All'}</span>
                </div>
                <div className="space-y-2">
                  {locations.map((location) => (
                    <label key={location} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedLocs.includes(location)}
                        onChange={() => toggleLoc(location)}
                        className="h-4 w-4 rounded border-gray-300 text-gray-900"
                      />
                      <span className="text-[12px] text-gray-700">{location}</span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Department</h4>
                  <span className="text-[11px] text-gray-400">{selectedDepts.length || 'All'}</span>
                </div>
                <div className="space-y-2">
                  {departments.map((department) => (
                    <label key={department} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedDepts.includes(department)}
                        onChange={() => toggleDept(department)}
                        className="h-4 w-4 rounded border-gray-300 text-gray-900"
                      />
                      <span className="text-[12px] text-gray-700">{department}</span>
                    </label>
                  ))}
                </div>
              </section>

              {!isAggregateView && !isApprovedRemoteWorkView ? (
                <div>
                  <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Approved Remote Work</label>
                  <select
                    value={includeApprovedRemoteWork ? 'include' : 'exclude'}
                    onChange={(e) => {
                      setIncludeApprovedRemoteWork(e.target.value === 'include');
                      setPage(0);
                    }}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
                  >
                    <option value="exclude">Exclude Approved Remote Work</option>
                    <option value="include">Include Approved Remote Work</option>
                  </select>
                </div>
              ) : null}
            </div>

            <div className="sticky bottom-0 border-t border-gray-200 bg-white px-4 py-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setSelectedDepts([]);
                    setSelectedLocs(viewMode === 'employees' && locations.includes(DEFAULT_EMPLOYEE_LOCATION) ? [DEFAULT_EMPLOYEE_LOCATION] : []);
                    setIncludeApprovedRemoteWork(false);
                    setPage(0);
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(false)}
                  className="rounded-lg bg-gray-900 px-3 py-2 text-[12px] font-medium text-white hover:bg-gray-800"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
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
  const daysByDate = new Map(allDays.map((day) => [day.date, day]));
  const officeDays = allDays.filter((day) => day.location === 'Office').length;
  const remoteDays = allDays.filter((day) => day.location === 'Remote').length;
  const ptoDays = allDays.filter((day) => day.location === 'PTO').length;
  const unknownDays = allDays.filter((day) => day.location === 'Unknown').length;
  const activeWeeks = scoredWeeks.filter((week) => {
    const cell = row.weeks[week];
    return (cell?.officeDays ?? 0) > 0 || (cell?.remoteDays ?? 0) > 0 || (cell?.ptoDays ?? 0) > 0;
  }).length;
  const calendarMonths = useMemo<CalendarMonth[]>(() => {
    const monthStarts: Date[] = [];
    const firstWeek = weeks[0];
    const lastWeek = weeks[weeks.length - 1];
    if (!firstWeek || !lastWeek) return [];

    const cursor = parseLocalDate(firstWeek);
    cursor.setDate(1);
    const lastDate = parseLocalDate(lastWeek);
    lastDate.setDate(lastDate.getDate() + 4);

    while (cursor <= lastDate) {
      monthStarts.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }

    return monthStarts.map((monthStart) => ({
      key: `${monthStart.getFullYear()}-${monthStart.getMonth()}`,
      label: formatMonthLabel(monthStart),
      days: getMonthCalendarDays(monthStart).map((date) => {
        if (!date) return null;
        const dateKey = toDateParam(date);
        return {
          date,
          dateKey,
          activity: daysByDate.get(dateKey) ?? null,
        };
      }),
    }));
  }, [daysByDate, weeks]);

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
                row.approvedRemoteWorkRequest ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {row.remoteWorkStatusLabel}
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
          <div className="grid gap-6 xl:grid-cols-[1.25fr,0.75fr]">
            <section className="space-y-4 xl:col-span-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">Monthly Calendar</h4>
                  <p className="mt-1 text-[12px] text-gray-400">Office days are green, time off is blue, remote days stay neutral.</p>
                </div>
              </div>
              <div className="space-y-4">
                {calendarMonths.map((month) => (
                  <div key={month.key} className="overflow-hidden rounded-2xl border border-gray-200">
                    <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
                      <h5 className="text-[14px] font-semibold text-gray-900">{month.label}</h5>
                    </div>
                    <div className="grid grid-cols-7 border-b border-gray-100 bg-white">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => (
                        <div key={weekday} className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-gray-400">
                          {weekday}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 bg-white">
                      {month.days.map((entry, index) => {
                        if (!entry) {
                          return <div key={`empty-${month.key}-${index}`} className="min-h-24 border-t border-r border-gray-100 bg-gray-50/50" />;
                        }

                        const activity = entry.activity;
                        const tone =
                          activity?.location === 'Office'
                            ? 'bg-green-50 text-green-800'
                            : activity?.location === 'PTO'
                              ? 'bg-blue-50 text-blue-800'
                              : activity?.location === 'Remote'
                                ? 'bg-gray-100 text-gray-700'
                                : activity?.location === 'Unknown'
                                  ? 'bg-amber-50 text-amber-800'
                                  : 'bg-white text-gray-900';

                        return (
                          <div key={entry.dateKey} className="flex min-h-28 flex-col border-t border-r border-gray-100 p-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[12px] font-semibold text-gray-800">{entry.date.getDate()}</span>
                              {activity?.location === 'Office' ? (
                                <span className="text-[12px] font-semibold text-green-600">●</span>
                              ) : activity?.location === 'PTO' ? (
                                <span className="text-[12px] font-semibold text-blue-600">●</span>
                              ) : null}
                            </div>
                            {activity ? (
                              <div className={`mt-2 rounded-lg px-2 py-1.5 text-[11px] font-medium ${tone}`}>
                                <div>{activity.location}</div>
                                {activity.ptoType ? <div className="mt-1 text-[10px] font-medium">{activity.ptoType}</div> : null}
                              </div>
                            ) : (
                              <div className="mt-2 rounded-lg border border-dashed border-gray-200 px-2 py-1.5 text-[11px] text-gray-300">
                                No data
                              </div>
                            )}
                            <div className="mt-auto flex items-end justify-between gap-2 pt-3 text-[10px] font-medium tabular-nums">
                              <span className={(activity?.tbsReportedHours ?? 0) > 0 ? 'text-gray-700' : 'text-gray-300'}>
                                TBS {formatCompactHours(activity?.tbsReportedHours)}
                              </span>
                              <span className={(activity?.activeHours ?? 0) > 0 ? 'text-gray-700' : 'text-gray-300'}>
                                Active {formatCompactHours(activity?.activeHours)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <div>
                <h4 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">Weekly Compliance</h4>
                <p className="mt-1 text-[12px] text-gray-400">Weeks with at least 2 office days get a green check.</p>
              </div>
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <div className="divide-y divide-gray-100">
                  {weekSummaries.map((weekSummary) => {
                    const compliantWeek = weekSummary.officeDays >= OFFICE_DAYS_REQUIRED;
                    return (
                      <div key={weekSummary.week} className="flex items-center justify-between gap-4 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-gray-900">{weekSummary.label}</p>
                          <p className="mt-1 text-[11px] text-gray-400">
                            {weekSummary.officeDays} office • {weekSummary.remoteDays} remote • {weekSummary.ptoDays} PTO
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {compliantWeek ? (
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-100 text-[14px] font-semibold text-green-700">
                              ✓
                            </span>
                          ) : (
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-[14px] font-semibold text-gray-400">
                              —
                            </span>
                          )}
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${scoreTone(weekSummary.scorePct)}`}>
                            {weekSummary.scorePct}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
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
                        <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">TBS</th>
                        <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">Active</th>
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
                          <td className="px-3 py-3 text-right text-[12px] font-medium tabular-nums text-gray-600">
                            {formatCompactHours(day.tbsReportedHours)}
                          </td>
                          <td className="px-4 py-3 text-right text-[12px] font-medium tabular-nums text-gray-600">
                            {formatCompactHours(day.activeHours)}
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-[13px] text-gray-500">No day-level activity in this range.</td>
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

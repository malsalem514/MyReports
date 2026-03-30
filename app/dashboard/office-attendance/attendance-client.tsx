'use client';

import { Download, Filter, House, Plane, X } from 'lucide-react';
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
  serializeListParam,
  type SearchParamReader,
} from '@/lib/search-params';
import type { AttendanceRemoteWorkRequest, AttendanceRow, AttendanceSummary, AttendanceWorkAbroadRequest, DayDetail, WeekCell } from '@/lib/types/attendance';
import { useUrlStateSync, type UrlStateField } from '@/lib/use-url-state-sync';

interface Props {
  rows: AttendanceRow[];
  remoteWorkRequests: AttendanceRemoteWorkRequest[];
  workAbroadRequests: AttendanceWorkAbroadRequest[];
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
type WfhFilterMode = 'all' | 'standard-only' | 'approved-only';
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

function getInitialWfhFilter(searchParams: SearchParamReader): WfhFilterMode {
  const filter = searchParams.get('wfhFilter');
  if (filter === 'standard-only' || filter === 'approved-only' || filter === 'all') {
    return filter;
  }
  if (searchParams.get('approvedRemoteWork') === 'include') {
    return 'all';
  }
  return 'all';
}

interface GroupRow {
  id: string;
  groupLabel: string;
  employeeCount: number;
  quebecEmployeeCount: number;
  remoteEmployeeCount: number;
  unknownCoverageCount: number;
  managerName?: string;
  managerEmail?: string | null;
  officeLocation: string;
  weeks: Record<string, WeekCell>;
  weeklyCompliance: Record<string, WeeklyCompliance>;
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
  hasActivTrakCoverage: boolean;
  approvedRemoteWorkRequest: boolean;
  hasStandingWfhPolicy: boolean;
  hasApprovedRemoteRequestInRange: boolean;
  hasApprovedWorkAbroadRequestInRange: boolean;
  hasAnyApprovedWfhCoverageInRange: boolean;
  remoteWorkStatusLabel: string;
  weeks: Record<string, WeekCell>;
  total: number;
  avgPerWeek: number;
  scorePct: number;
  trend: 'up' | 'down' | 'flat';
  employeeCount?: number;
  quebecEmployeeCount?: number;
  remoteEmployeeCount?: number;
  unknownCoverageCount?: number;
  weeklyCompliance?: Record<string, WeeklyCompliance>;
  managerName?: string;
  managerEmail?: string | null;
  email?: string;
  exemptWeekCount?: number;
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

interface WeeklyCompliance {
  compliantEmployees: number;
  eligibleEmployees: number;
  exemptEmployees: number;
  excusedEmployees: number;
  unknownEmployees: number;
  compliancePct: number;
  compliantNames: string[];
  nonCompliantNames: string[];
  exemptNames: string[];
  excusedNames: string[];
}

interface ApprovalRequestRow {
  source: 'remote-work' | 'work-abroad';
  sourceLabel: string;
  bambooRowId: number;
  employeeId: string;
  employeeName: string;
  email: string;
  department: string;
  officeLocation: string;
  requestDate: string | null;
  startDate: string;
  endDate: string | null;
  category: string | null;
  approvalStatus: string | null;
  approver: string | null;
  reason: string | null;
  address: string | null;
  schedule: string | null;
  supportingDocumentationSubmitted: string | null;
  alternateInOfficeWorkDate: string | null;
}

const PAGE_SIZE = 50;
const UNKNOWN_DISPLAY_VALUE = '—';

/** Parse YYYY-MM-DD as local date (avoids UTC timezone shift) */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function getEmployeeCellColor(cell?: WeekCell): string {
  if (cell?.isPtoExcused) return CELL_COLORS.pto;
  if (cell?.adjustedCompliant) return CELL_COLORS.compliant;
  if ((cell?.officeDays ?? 0) >= 1) return CELL_COLORS.partial;
  return CELL_COLORS.absent;
}

function getEmployeeCellHex(cell?: WeekCell): string {
  if (cell?.isPtoExcused) return CELL_HEX.pto;
  if (cell?.adjustedCompliant) return CELL_HEX.compliant;
  if ((cell?.officeDays ?? 0) >= 1) return CELL_HEX.partial;
  return CELL_HEX.absent;
}

function getWeekCoverageKinds(cell?: Pick<WeekCell, 'hasApprovedRemoteCoverage' | 'hasApprovedWorkAbroadCoverage'>): Array<'remote' | 'abroad'> {
  const kinds: Array<'remote' | 'abroad'> = [];
  if (cell?.hasApprovedRemoteCoverage) kinds.push('remote');
  if (cell?.hasApprovedWorkAbroadCoverage) kinds.push('abroad');
  return kinds;
}

function getCoverageSummaryLabel(cell?: Pick<WeekCell, 'hasApprovedRemoteCoverage' | 'hasApprovedWorkAbroadCoverage'>): string {
  const kinds = getWeekCoverageKinds(cell);
  if (kinds.length === 2) return 'Remote Work + Work Abroad';
  if (kinds[0] === 'remote') return 'Remote Work';
  if (kinds[0] === 'abroad') return 'Work Abroad';
  return 'No';
}

function renderWeekCoverageMarkers(cell?: Pick<WeekCell, 'hasApprovedRemoteCoverage' | 'hasApprovedWorkAbroadCoverage'>, iconClassName = 'h-3 w-3') {
  const kinds = getWeekCoverageKinds(cell);
  if (kinds.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {kinds.includes('remote') ? <House className={`${iconClassName} text-sky-700`} /> : null}
      {kinds.includes('abroad') ? <Plane className={`${iconClassName} text-emerald-700`} /> : null}
    </span>
  );
}

function formatEmployeeWeekValue(cell: WeekCell | undefined, isKnown: boolean): string {
  if (!isKnown) return UNKNOWN_DISPLAY_VALUE;
  const officeDays = cell?.officeDays ?? 0;
  const kinds = getWeekCoverageKinds(cell);
  const markers = kinds.map((kind) => kind === 'remote' ? '[House]' : '[Plane]').join(' ');
  return markers ? `${officeDays} ${markers}` : String(officeDays);
}

function renderEmployeeWeekValue(cell: WeekCell | undefined, isKnown: boolean) {
  if (!isKnown) return UNKNOWN_DISPLAY_VALUE;
  const officeDays = cell?.officeDays ?? 0;
  return (
    <span className="inline-flex items-center gap-1">
      <span>{officeDays}</span>
      {renderWeekCoverageMarkers(cell)}
    </span>
  );
}

function createEmptyWeeklyCompliance(): WeeklyCompliance {
  return {
    compliantEmployees: 0,
    eligibleEmployees: 0,
    exemptEmployees: 0,
    excusedEmployees: 0,
    unknownEmployees: 0,
    compliancePct: 0,
    compliantNames: [],
    nonCompliantNames: [],
    exemptNames: [],
    excusedNames: [],
  };
}

function createEmptyWeekCell(): WeekCell {
  return {
    officeDays: 0,
    remoteDays: 0,
    ptoDays: 0,
    days: [],
    rawOfficeTarget: OFFICE_DAYS_REQUIRED,
    adjustedOfficeTarget: OFFICE_DAYS_REQUIRED,
    adjustedCompliant: false,
    isPtoExcused: false,
    hasApprovedWfhCoverage: false,
    hasApprovedRemoteCoverage: false,
    hasApprovedWorkAbroadCoverage: false,
    wfhExceptionType: 'none',
    approvedCoverageWeekdays: 0,
    exceptionLabel: null,
  };
}

function getWeekPointCapacity(cell?: WeekCell): number {
  const adjustedOfficeTarget = cell?.adjustedOfficeTarget;
  return adjustedOfficeTarget == null ? 0 : Math.max(0, adjustedOfficeTarget);
}

function getWeekPoints(cell?: WeekCell): number {
  const officeDays = cell?.officeDays ?? 0;
  return Math.min(officeDays, getWeekPointCapacity(cell));
}

function calculateScorePct(weeksByKey: Record<string, WeekCell>, scopedWeeks: string[]): number {
  let earned = 0;
  let capacity = 0;
  let hadMeasuredWeek = false;
  let allMeasuredWeeksCompliant = true;
  for (const week of scopedWeeks) {
    const cell = weeksByKey[week];
    if (cell?.adjustedCompliant !== null && cell?.adjustedCompliant !== undefined) {
      hadMeasuredWeek = true;
      if (cell.adjustedCompliant === false) allMeasuredWeeksCompliant = false;
    }
    earned += getWeekPoints(cell);
    capacity += getWeekPointCapacity(cell);
  }
  if (capacity <= 0) return hadMeasuredWeek && allMeasuredWeeksCompliant ? 100 : 0;
  return Math.round((earned / capacity) * 100);
}

function hasEligibleEmployeeWeek(row: Pick<AttendanceRow, 'weeks'>, scopedWeeks: string[]): boolean {
  return scopedWeeks.some((week) => {
    const adjustedOfficeTarget = row.weeks[week]?.adjustedOfficeTarget;
    return adjustedOfficeTarget != null && adjustedOfficeTarget > 0;
  });
}

function hasEligibleGroupWeek(row: Pick<GroupRow, 'weeklyCompliance'>, scopedWeeks: string[]): boolean {
  return scopedWeeks.some((week) => (row.weeklyCompliance[week]?.eligibleEmployees ?? 0) > 0);
}

function scoreTone(scorePct: number): string {
  if (scorePct >= 80) return 'bg-green-50 text-green-700';
  if (scorePct >= 50) return 'bg-amber-50 text-amber-700';
  return 'bg-red-50 text-red-700';
}

function unknownTone(): string {
  return 'bg-gray-100 text-gray-400';
}

function complianceValueTone(scorePct: number, eligibleEmployees: number): string {
  if (eligibleEmployees <= 0) return 'bg-gray-100 text-gray-400';
  return scoreTone(scorePct);
}

function formatNameBucket(names: string[]): string {
  return names.length > 0 ? names.join(', ') : '—';
}

function formatKnownValue(value: number | string, isKnown: boolean): string {
  return isKnown ? String(value) : UNKNOWN_DISPLAY_VALUE;
}

function employeeMetricTone(isKnown: boolean, scorePct: number): string {
  return isKnown ? scoreTone(scorePct) : unknownTone();
}

function compareMaybeNumber(a: number | null, b: number | null, dir: number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir * (a - b);
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
  const end = new Date(start.getTime());
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
  workAbroadRequests,
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
  const [wfhFilter, setWfhFilter] = useState<WfhFilterMode>(() => getInitialWfhFilter(searchParams));
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
      read: (params) => parseListParam(params.get('departments')),
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
      current: selectedLocs,
      read: (params) => getDefaultLocationSelection(viewMode, params, locations),
      sync: (nextValue) => {
        const nextLocs = nextValue as string[];
        setSelectedLocs((previous) => (arraysEqual(previous, nextLocs) ? previous : nextLocs));
      },
      write: (params) => {
        const serialized = serializeListParam(selectedLocs);
        if (serialized) params.set('locations', serialized);
        else params.delete('locations');
      },
      equals: (current, next) => arraysEqual(current as string[], next as string[]),
    },
    {
      current: wfhFilter,
      read: (params) => getInitialWfhFilter(params),
      sync: (nextValue) => {
        const nextWfhFilter = nextValue as WfhFilterMode;
        setWfhFilter((previous) => (previous === nextWfhFilter ? previous : nextWfhFilter));
      },
      write: (params) => {
        if (wfhFilter !== 'all') params.set('wfhFilter', wfhFilter);
        else params.delete('wfhFilter');
        params.delete('approvedRemoteWork');
        params.delete('remoteWork');
      },
    },
    {
      current: sortKey,
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
      current: sortDir,
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
  ]), [
    locations,
    page,
    search,
    selectedDepts,
    selectedLocs,
    sortDir,
    sortKey,
    viewMode,
    wfhFilter,
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
    (!isAggregateView && !isApprovedRemoteWorkView && wfhFilter !== 'all');
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
      list = list.filter((r) => r.hasAnyApprovedWfhCoverageInRange);
    } else if (!isAggregateView) {
      if (wfhFilter === 'standard-only') {
        list = list.filter((r) => !r.hasAnyApprovedWfhCoverageInRange);
      } else if (wfhFilter === 'approved-only') {
        list = list.filter((r) => r.hasAnyApprovedWfhCoverageInRange);
      }
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
  }, [isApprovedRemoteWorkView, isAggregateView, rows, search, selectedDepts, selectedLocs, wfhFilter]);

  const groupedRows = useMemo<GroupRow[]>(() => {
    const grouped = new Map<string, GroupRow>();
    const groupMembersByKey = new Map<string, Set<string>>();
    const normalizeEmail = (email: string | null | undefined) => email?.toLowerCase().trim() || null;

    const addEmployeeToGroup = (group: GroupRow, row: AttendanceRow) => {
      const isQuebecEmployee = row.officeLocation === DEFAULT_EMPLOYEE_LOCATION;
      const hasCoverage = row.hasActivTrakCoverage;

      group.employeeCount += 1;
      if (isQuebecEmployee && hasCoverage) {
        group.quebecEmployeeCount += 1;
        group.total += row.total;
      } else if (isQuebecEmployee && !hasCoverage) {
        group.unknownCoverageCount += 1;
      }
      if (!isQuebecEmployee || row.hasAnyApprovedWfhCoverageInRange) {
        group.remoteEmployeeCount += 1;
      }
      if (group.officeLocation !== row.officeLocation) {
        group.officeLocation = 'Mixed';
      }

      for (const week of weeks) {
        const cell = row.weeks[week];
        if (!group.weeklyCompliance[week]) {
          group.weeklyCompliance[week] = createEmptyWeeklyCompliance();
        }
        const compliance = group.weeklyCompliance[week]!;

        if (!isQuebecEmployee) {
          continue;
        }

        if (!hasCoverage) {
          compliance.unknownEmployees += 1;
          continue;
        }

        const weekCell = cell || createEmptyWeekCell();
        const current = group.weeks[week] || createEmptyWeekCell();
        current.officeDays += weekCell.officeDays ?? 0;
        current.remoteDays += weekCell.remoteDays ?? 0;
        current.ptoDays += weekCell.ptoDays ?? 0;
        group.weeks[week] = current;

        if (weekCell.adjustedOfficeTarget === 0 && weekCell.hasApprovedWfhCoverage) {
          compliance.exemptEmployees += 1;
          compliance.exemptNames.push(row.name);
          continue;
        }

        if (weekCell.isPtoExcused) {
          compliance.excusedEmployees += 1;
          compliance.excusedNames.push(row.name);
          continue;
        }

        if (weekCell.adjustedCompliant === null) {
          compliance.unknownEmployees += 1;
          continue;
        }

        compliance.eligibleEmployees += 1;
        if (weekCell.adjustedCompliant) {
          compliance.compliantEmployees += 1;
          compliance.compliantNames.push(row.name);
        } else {
          compliance.nonCompliantNames.push(row.name);
        }
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
        unknownCoverageCount: 0,
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
              group.weeklyCompliance[week] = createEmptyWeeklyCompliance();
            }
            group.weeklyCompliance[week]!.exemptNames.push(group.groupLabel);
          }
        }
        grouped.set(key, group);
      }
    }

    return [...grouped.values()].map((row) => {
      for (const week of weeks) {
        const compliance = row.weeklyCompliance[week] || createEmptyWeeklyCompliance();
        compliance.compliancePct = compliance.eligibleEmployees > 0
          ? Math.round((compliance.compliantEmployees / compliance.eligibleEmployees) * 100)
          : 0;
        compliance.compliantNames.sort((a, b) => a.localeCompare(b));
        compliance.nonCompliantNames.sort((a, b) => a.localeCompare(b));
        compliance.exemptNames.sort((a, b) => a.localeCompare(b));
        compliance.excusedNames.sort((a, b) => a.localeCompare(b));
        row.weeklyCompliance[week] = compliance;
      }

      const avgPerWeek = scoredWeeks.length > 0
        ? Math.round((row.total / Math.max(1, row.quebecEmployeeCount) / scoredWeeks.length) * 10) / 10
        : 0;
      const measuredWeeks = scoredWeeks.filter((week) => (row.weeklyCompliance[week]?.eligibleEmployees ?? 0) > 0);
      const neutralOnlyWeeks = scoredWeeks.filter((week) => {
        const compliance = row.weeklyCompliance[week];
        return (compliance?.eligibleEmployees ?? 0) === 0
          && (((compliance?.exemptEmployees ?? 0) > 0) || ((compliance?.excusedEmployees ?? 0) > 0));
      });
      const scorePct = measuredWeeks.length > 0
        ? Math.round(
          measuredWeeks.reduce((sum, week) => sum + (row.weeklyCompliance[week]?.compliancePct ?? 0), 0) / measuredWeeks.length,
        )
        : (neutralOnlyWeeks.length > 0 ? 100 : 0);
      let trend: 'up' | 'down' | 'flat' = 'flat';
      if (measuredWeeks.length >= 2) {
        const prevWeek = measuredWeeks[measuredWeeks.length - 2]!;
        const lastWeek = measuredWeeks[measuredWeeks.length - 1]!;
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
      hasActivTrakCoverage: row.hasActivTrakCoverage,
      approvedRemoteWorkRequest: row.approvedRemoteWorkRequest,
      hasStandingWfhPolicy: row.hasStandingWfhPolicy,
      hasApprovedRemoteRequestInRange: row.hasApprovedRemoteRequestInRange,
      hasApprovedWorkAbroadRequestInRange: row.hasApprovedWorkAbroadRequestInRange,
      hasAnyApprovedWfhCoverageInRange: row.hasAnyApprovedWfhCoverageInRange,
      remoteWorkStatusLabel: row.remoteWorkStatusLabel,
      weeks: row.weeks,
      total: row.total,
      avgPerWeek: row.avgPerWeek,
      scorePct: row.hasActivTrakCoverage ? calculateScorePct(row.weeks, scoredWeeks) : 0,
      trend: row.trend,
      managerName: row.managerName,
      managerEmail: row.managerEmail,
      email: row.email,
      exemptWeekCount: row.exemptWeekCount,
    }));

    const aggregateDisplayRows: DisplayRow[] = groupedRows.map((row) => ({
      id: row.id,
      label: row.groupLabel,
      secondary: String(row.employeeCount),
      officeLocation: row.officeLocation,
      hasActivTrakCoverage: true,
      approvedRemoteWorkRequest: false,
      hasStandingWfhPolicy: false,
      hasApprovedRemoteRequestInRange: false,
      hasApprovedWorkAbroadRequestInRange: false,
      hasAnyApprovedWfhCoverageInRange: false,
      remoteWorkStatusLabel: '—',
      weeks: Object.fromEntries(
        weeks.map((week) => {
          const compliance = row.weeklyCompliance[week];
          return [week, {
            officeDays: compliance?.compliancePct ?? 0,
            remoteDays: compliance?.compliantEmployees ?? 0,
            ptoDays: compliance?.eligibleEmployees ?? 0,
            days: [],
            rawOfficeTarget: OFFICE_DAYS_REQUIRED,
            adjustedOfficeTarget: OFFICE_DAYS_REQUIRED,
            adjustedCompliant: (compliance?.compliancePct ?? 0) >= 100,
            isPtoExcused: false,
            hasApprovedWfhCoverage: false,
            hasApprovedRemoteCoverage: false,
            hasApprovedWorkAbroadCoverage: false,
            wfhExceptionType: 'none',
            approvedCoverageWeekdays: 0,
            exceptionLabel: null,
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
      unknownCoverageCount: row.unknownCoverageCount,
      weeklyCompliance: row.weeklyCompliance,
      exemptWeekCount: 0,
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
      if (sortKey === 'total') {
        return compareMaybeNumber(
          !isAggregateView && !a.hasActivTrakCoverage ? null : a.total,
          !isAggregateView && !b.hasActivTrakCoverage ? null : b.total,
          dir,
        );
      }
      if (sortKey === 'avgPerWeek') {
        return compareMaybeNumber(
          !isAggregateView && !a.hasActivTrakCoverage ? null : a.avgPerWeek,
          !isAggregateView && !b.hasActivTrakCoverage ? null : b.avgPerWeek,
          dir,
        );
      }
      if (sortKey === 'status') {
        return compareMaybeNumber(
          !isAggregateView && !a.hasActivTrakCoverage ? null : a.scorePct,
          !isAggregateView && !b.hasActivTrakCoverage ? null : b.scorePct,
          dir,
        );
      }
      if (sortKey === 'trend') {
        const order = { up: 2, flat: 1, down: 0 };
        if (!isAggregateView) {
          if (!a.hasActivTrakCoverage && !b.hasActivTrakCoverage) return 0;
          if (!a.hasActivTrakCoverage) return 1;
          if (!b.hasActivTrakCoverage) return -1;
        }
        return dir * (order[a.trend] - order[b.trend]);
      }
      return compareMaybeNumber(
        !isAggregateView && !a.hasActivTrakCoverage ? null : (a.weeks[sortKey]?.officeDays ?? 0),
        !isAggregateView && !b.hasActivTrakCoverage ? null : (b.weeks[sortKey]?.officeDays ?? 0),
        dir,
      );
    });
    return arr;
  }, [displayRows, isAggregateView, sortDir, sortKey]);

  const filteredSummary = useMemo(() => {
    const totalEmployees = filtered.length;
    const numCompletedWeeks = scoredWeeks.length;
    const totalEligibleQuebecEmployees = groupedRows.reduce((sum, row) => sum + row.quebecEmployeeCount, 0);
    const unknownCoverageCount = filtered.filter((row) => !row.hasActivTrakCoverage).length;
    const measurableEmployees = filtered.filter((row) => row.hasActivTrakCoverage && hasEligibleEmployeeWeek(row, scoredWeeks)).length;
    const measurableGroups = groupedRows.filter((row) => hasEligibleGroupWeek(row, scoredWeeks)).length;
    const coveredEmployees = Math.max(0, totalEmployees - unknownCoverageCount);
    let zeroCount = 0;
    let sumOfficeDays = 0;
    let sumScorePct = 0;

    if (isAggregateView) {
      for (const row of groupedRows) {
        if (row.total === 0) zeroCount++;
        if (hasEligibleGroupWeek(row, scoredWeeks)) {
          sumScorePct += row.scorePct;
        }
        for (const week of scoredWeeks) {
          sumOfficeDays += row.weeks[week]?.officeDays ?? 0;
        }
      }
    } else {
      for (const row of filtered) {
        if (!row.hasActivTrakCoverage) continue;
        if (row.total === 0) zeroCount++;
        if (hasEligibleEmployeeWeek(row, scoredWeeks)) {
          sumScorePct += calculateScorePct(row.weeks, scoredWeeks);
        }
        for (const week of scoredWeeks) {
          sumOfficeDays += row.weeks[week]?.officeDays ?? 0;
        }
      }
    }

    const avgOfficeDays = (isAggregateView ? totalEligibleQuebecEmployees : coveredEmployees) > 0 && numCompletedWeeks > 0
      ? Math.round((sumOfficeDays / Math.max(1, isAggregateView ? totalEligibleQuebecEmployees : coveredEmployees) / numCompletedWeeks) * 10) / 10
      : 0;
    const complianceRate = (isAggregateView ? measurableGroups : measurableEmployees) > 0
      ? Math.round(sumScorePct / Math.max(1, isAggregateView ? measurableGroups : measurableEmployees))
      : 0;
    const zeroOfficeDepartments = groupedRows.filter((row) => row.total === 0 && row.quebecEmployeeCount > 0).length;

    return {
      totalEmployees,
      totalDepartments: groupedRows.length,
      measurableEmployees,
      unknownCoverageCount,
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
        request.email.toLowerCase().includes(q) ||
        request.department.toLowerCase().includes(q) ||
        (request.remoteWorkType || '').toLowerCase().includes(q) ||
        (request.reason || '').toLowerCase().includes(q) ||
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

  const filteredWorkAbroadRequests = useMemo(() => {
    let list = [...workAbroadRequests];
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
        request.email.toLowerCase().includes(q) ||
        request.department.toLowerCase().includes(q) ||
        (request.countryOrProvince || '').toLowerCase().includes(q) ||
        (request.reason || '').toLowerCase().includes(q) ||
        (request.approvedDeclinedBy || '').toLowerCase().includes(q) ||
        (request.remoteWorkLocationAddress || '').toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      const aDate = a.workAbroadStartDate;
      const bDate = b.workAbroadStartDate;
      if (sortDir === 'asc') {
        return aDate.localeCompare(bDate) || a.employeeName.localeCompare(b.employeeName);
      }
      return bDate.localeCompare(aDate) || a.employeeName.localeCompare(b.employeeName);
    });
    return list;
  }, [workAbroadRequests, search, selectedDepts, selectedLocs, sortDir]);

  const requestSummary = useMemo(() => {
    const allRequests = [
      ...filteredRemoteWorkRequests.map((request) => request.email || request.employeeId),
      ...filteredWorkAbroadRequests.map((request) => request.email || request.employeeId),
    ];
    const uniqueEmployees = new Set(allRequests);
    return {
      totalRequests: filteredRemoteWorkRequests.length + filteredWorkAbroadRequests.length,
      uniqueEmployees: uniqueEmployees.size,
      remoteWorkRequests: filteredRemoteWorkRequests.length,
      workAbroadRequests: filteredWorkAbroadRequests.length,
    };
  }, [filteredRemoteWorkRequests, filteredWorkAbroadRequests]);

  const combinedApprovalRequests = useMemo<ApprovalRequestRow[]>(() => ([
    ...filteredRemoteWorkRequests.map((request) => ({
      source: 'remote-work' as const,
      sourceLabel: 'Remote Work',
      bambooRowId: request.bambooRowId,
      employeeId: request.employeeId,
      employeeName: request.employeeName,
      email: request.email,
      department: request.department,
      officeLocation: request.officeLocation,
      requestDate: request.requestDate,
      startDate: request.remoteWorkStartDate,
      endDate: request.remoteWorkEndDate,
      category: request.remoteWorkType,
      approvalStatus: request.managerApprovalReceived,
      approver: request.managerName,
      reason: request.reason,
      address: null,
      schedule: null,
      supportingDocumentationSubmitted: request.supportingDocumentationSubmitted,
      alternateInOfficeWorkDate: request.alternateInOfficeWorkDate,
    })),
    ...filteredWorkAbroadRequests.map((request) => ({
      source: 'work-abroad' as const,
      sourceLabel: 'Work Abroad / Province',
      bambooRowId: request.bambooRowId,
      employeeId: request.employeeId,
      employeeName: request.employeeName,
      email: request.email,
      department: request.department,
      officeLocation: request.officeLocation,
      requestDate: request.requestDate,
      startDate: request.workAbroadStartDate,
      endDate: request.workAbroadEndDate,
      category: request.countryOrProvince,
      approvalStatus: request.requestApproved,
      approver: request.approvedDeclinedBy,
      reason: request.reason,
      address: request.remoteWorkLocationAddress,
      schedule: request.workSchedule,
      supportingDocumentationSubmitted: null,
      alternateInOfficeWorkDate: null,
    })),
  ]).sort((a, b) => {
    if (sortDir === 'asc') {
      return a.startDate.localeCompare(b.startDate) || a.employeeName.localeCompare(b.employeeName);
    }
    return b.startDate.localeCompare(a.startDate) || a.employeeName.localeCompare(b.employeeName);
  }), [filteredRemoteWorkRequests, filteredWorkAbroadRequests, sortDir]);
  const hasRequestResults = filteredRemoteWorkRequests.length > 0 || filteredWorkAbroadRequests.length > 0;

  const activeRowsCount = isApprovedRemoteWorkView ? combinedApprovalRequests.length : sorted.length;
  const totalPages = Math.max(1, Math.ceil(activeRowsCount / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const activeFilterCount =
    (search ? 1 : 0) +
    (selectedDepts.length > 0 ? 1 : 0) +
    (selectedLocs.length > 0 ? 1 : 0) +
    (!isAggregateView && !isApprovedRemoteWorkView && wfhFilter !== 'all' ? 1 : 0);

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
        'Source',
        'Bamboo Row ID',
        'Employee ID',
        'Employee Name',
        'Email',
        'Department',
        'Office Location',
        'Request Date',
        'Start Date',
        'End Date',
        'Category',
        'Approval Status',
        'Approver',
        'Reason',
        'Address',
        'Work Schedule',
        'Supporting Documentation Submitted',
        'Alternate In-Office Work Date',
      ];

      const csvRows = combinedApprovalRequests.map((request) => [
        request.sourceLabel,
        String(request.bambooRowId),
        request.employeeId,
        request.employeeName,
        request.email,
        request.department,
        request.officeLocation,
        request.requestDate || '',
        request.startDate,
        request.endDate || '',
        request.category || '',
        request.approvalStatus || '',
        request.approver || '',
        request.reason || '',
        request.address || '',
        request.schedule || '',
        request.supportingDocumentationSubmitted || '',
        request.alternateInOfficeWorkDate || '',
      ]);

      const csv = [headers.join(','), ...csvRows.map((row) => row.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(','))].join('\n');
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `office-attendance-approved-coverage-requests-${startDate}-${endDate}.csv`);
      return;
    }

    const headers = [
      isAggregateView ? aggregateLabel : 'Employee',
      isAggregateView ? 'Employees' : 'Department',
      ...(isAggregateView ? ['Quebec Employees', 'Remote/Exempt Employees'] : []),
      'Location',
      'Coverage Status',
      ...(isAggregateView ? [] : ['Standing WFH Policy', 'Approved Coverage In Range', 'ActivTrak Coverage']),
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
      ...(isAggregateView ? [] : [
        r.hasStandingWfhPolicy ? 'Yes' : 'No',
        r.hasAnyApprovedWfhCoverageInRange ? 'Yes' : 'No',
        r.hasActivTrakCoverage ? 'Covered' : 'Unknown',
      ]),
      ...weeks.map((w) => isAggregateView
        ? `${r.weeklyCompliance?.[w]?.compliancePct ?? 0}%`
        : formatEmployeeWeekValue(r.weeks[w], r.hasActivTrakCoverage)),
      isAggregateView ? String(r.total) : (r.hasActivTrakCoverage ? String(r.total) : ''),
      isAggregateView ? String(r.avgPerWeek) : (r.hasActivTrakCoverage ? String(r.avgPerWeek) : ''),
      isAggregateView ? `${r.scorePct}%` : (r.hasActivTrakCoverage ? `${r.scorePct}%` : ''),
      isAggregateView ? r.trend : (r.hasActivTrakCoverage ? r.trend : ''),
    ]);

    const csvLines = [headers.join(','), ...csvRows.map((row) => row.map((c) => `"${c}"`).join(','))];

    if (isAggregateView) {
      csvLines.push('');
      csvLines.push('Weekly Breakdown');
      const detailHeaders = [
        'Group',
        'Week',
        'Compliance %',
        'Eligible Quebec',
        'Compliant Count',
        'Exempt Count',
        'PTO Excused Count',
        'Compliant',
        'Non-compliant',
        'Exempt this week',
        'PTO Excused',
      ];
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
            String(compliance.exemptEmployees),
            String(compliance.excusedEmployees),
            formatNameBucket(compliance.compliantNames),
            formatNameBucket(compliance.nonCompliantNames),
            formatNameBucket(compliance.exemptNames),
            formatNameBucket(compliance.excusedNames),
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
        'Source',
        'Bamboo Row ID',
        'Employee ID',
        'Employee Name',
        'Email',
        'Department',
        'Office Location',
        'Request Date',
        'Start Date',
        'End Date',
        'Category',
        'Approval Status',
        'Approver',
        'Reason',
        'Address',
        'Work Schedule',
        'Supporting Documentation Submitted',
        'Alternate In-Office Work Date',
      ];
      const headerRow = ws.addRow(headers);
      headerRow.font = { bold: true, size: 11 };
      headerRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
      });

      for (const request of combinedApprovalRequests) {
        ws.addRow([
          request.sourceLabel,
          request.bambooRowId,
          request.employeeId,
          request.employeeName,
          request.email,
          request.department,
          request.officeLocation,
          request.requestDate || '',
          request.startDate,
          request.endDate || '',
          request.category || '',
          request.approvalStatus || '',
          request.approver || '',
          request.reason || '',
          request.address || '',
          request.schedule || '',
          request.supportingDocumentationSubmitted || '',
          request.alternateInOfficeWorkDate || '',
        ]);
      }

      ws.columns.forEach((col, index) => {
        col.width = index >= 13 ? 24 : 18;
      });

      const buffer = await wb.xlsx.writeBuffer();
      downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `office-attendance-approved-coverage-requests-${startDate}-${endDate}.xlsx`);
      return;
    }

    const headers = [
      isAggregateView ? aggregateLabel : 'Employee',
      isAggregateView ? 'Employees' : 'Department',
      ...(isAggregateView ? ['Quebec Employees', 'Remote/Exempt Employees'] : []),
      'Location',
      'Coverage Status',
      ...(isAggregateView ? [] : ['Standing WFH Policy', 'Approved Coverage In Range', 'ActivTrak Coverage']),
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
      ...(isAggregateView ? [] : ['', '', filteredSummary.unknownCoverageCount > 0 ? `${filteredSummary.unknownCoverageCount} unknown` : '']),
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
        ...(isAggregateView ? [] : [
          r.hasStandingWfhPolicy ? 'Yes' : 'No',
          r.hasAnyApprovedWfhCoverageInRange ? 'Yes' : 'No',
          r.hasActivTrakCoverage ? 'Covered' : 'Unknown',
        ]),
        ...weeks.map((w) => isAggregateView
          ? `${r.weeklyCompliance?.[w]?.compliancePct ?? 0}%`
          : formatEmployeeWeekValue(r.weeks[w], r.hasActivTrakCoverage)),
        isAggregateView ? r.total : (r.hasActivTrakCoverage ? r.total : ''),
        isAggregateView ? r.avgPerWeek : (r.hasActivTrakCoverage ? r.avgPerWeek : ''),
        isAggregateView ? r.scorePct : (r.hasActivTrakCoverage ? r.scorePct : ''),
        isAggregateView ? r.trend : (r.hasActivTrakCoverage ? r.trend : ''),
      ]);

      weeks.forEach((w, i) => {
        const weekColumnIndex = (isAggregateView ? 6 : 7) + i + 1;
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
          : (!r.hasActivTrakCoverage ? 'F3F4F6' : getEmployeeCellHex(wc));
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex } };
      });
    }

    if (isAggregateView) {
      const detailSheet = wb.addWorksheet('Weekly Breakdown');
      const detailHeaders = [
        'Group',
        'Week',
        'Compliance %',
        'Eligible Quebec',
        'Compliant Count',
        'Exempt Count',
        'PTO Excused Count',
        'Compliant',
        'Non-compliant',
        'Exempt this week',
        'PTO Excused',
      ];
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
            compliance.exemptEmployees,
            compliance.excusedEmployees,
            formatNameBucket(compliance.compliantNames),
            formatNameBucket(compliance.nonCompliantNames),
            formatNameBucket(compliance.exemptNames),
            formatNameBucket(compliance.excusedNames),
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
    ? 'Request Records'
    : isAggregateView
      ? currentView.label
      : 'Employees';
  const averageMetricLabel = isApprovedRemoteWorkView ? 'Employees' : isAggregateView ? 'Avg Office Days/Emp/Week' : 'Avg Office Days/Week';
  const zeroMetricLabel = isApprovedRemoteWorkView ? 'Work Abroad Requests' : isAggregateView ? `Zero-Office ${aggregateLabel}s` : 'Zero Office Days';

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
                  ? 'Approved remote-work and work-abroad request records synced from Oracle. Use the approval fields to distinguish approved vs pending requests.'
                  : isAggregateView
                    ? `Weekly compliance is based on Quebec employees meeting the adjusted office target after approved week-level coverage and PTO exceptions.`
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
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Approved Coverage</label>
                <select
                  value={wfhFilter}
                  onChange={(e) => {
                    setWfhFilter(e.target.value as WfhFilterMode);
                    setPage(0);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
                >
                  <option value="all">All Employees</option>
                  <option value="standard-only">Only Standard Policy</option>
                  <option value="approved-only">Only Approved Coverage</option>
                </select>
              </div>
            )}
            {hasFilters && (
              <button
                onClick={() => {
                  setSearch('');
                  setSelectedDepts([]);
                  setSelectedLocs(viewMode === 'employees' && locations.includes(DEFAULT_EMPLOYEE_LOCATION) ? [DEFAULT_EMPLOYEE_LOCATION] : []);
                  setWfhFilter('all');
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
                  ? requestSummary.totalRequests
                  : isAggregateView
                    ? filteredSummary.totalDepartments
                    : filteredSummary.totalEmployees}
              </p>
              {isApprovedRemoteWorkView ? (
                <p className="mt-1 text-[11px] text-gray-400">Combined remote-work and work-abroad request records from `TL_REMOTE_WORK_REQUESTS` and `TL_WORK_ABROAD_REQUESTS`.</p>
              ) : isAggregateView ? (
                <p className="mt-1 text-[11px] text-gray-400">
                  {filteredSummary.measurableEmployees} measurable employee{filteredSummary.measurableEmployees === 1 ? '' : 's'}
                  {filteredSummary.unknownCoverageCount > 0 ? ` • ${filteredSummary.unknownCoverageCount} unknown` : ''}
                </p>
              ) : filteredSummary.unknownCoverageCount > 0 ? (
                <p className="mt-1 text-[11px] text-gray-400">
                  {filteredSummary.unknownCoverageCount} employee{filteredSummary.unknownCoverageCount === 1 ? '' : 's'} shown as unknown due to missing ActivTrak coverage
                </p>
              ) : null}
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[11px] font-medium text-gray-500">{averageMetricLabel}</p>
              <p className="mt-1 text-[22px] font-semibold text-gray-900">
                {isApprovedRemoteWorkView ? requestSummary.uniqueEmployees : filteredSummary.avgOfficeDays}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[11px] font-medium text-gray-500">{isApprovedRemoteWorkView ? 'Remote Work Requests' : 'Score'}</p>
              {isApprovedRemoteWorkView ? (
                <p className="mt-1 text-[22px] font-semibold text-gray-900">{requestSummary.remoteWorkRequests}</p>
              ) : (
                <>
                  <p className={`mt-1 text-[22px] font-semibold ${filteredSummary.complianceRate >= 80 ? 'text-green-600' : filteredSummary.complianceRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                    {filteredSummary.complianceRate}%
                  </p>
                  <p className="mt-1 text-[11px] text-gray-400">Scored against each week&apos;s adjusted office target after approved week-level coverage and PTO exceptions.</p>
                </>
              )}
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[11px] font-medium text-gray-500">{zeroMetricLabel}</p>
              {isApprovedRemoteWorkView ? (
                <p className="mt-1 text-[22px] font-semibold text-gray-900">{requestSummary.workAbroadRequests}</p>
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
            <span>{isApprovedRemoteWorkView ? 'Combined request tables' : `Page ${page + 1} of ${totalPages}`}</span>
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
            <div className="space-y-4 md:hidden">
              {!hasRequestResults ? (
                <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-[13px] text-gray-500">No {resultLabel} match filters.</div>
              ) : (
                <>
                  <section className="rounded-xl border border-gray-200 bg-white">
                    <div className="border-b border-gray-100 px-4 py-3">
                      <h3 className="text-[13px] font-semibold text-gray-900">Scheduled Office Day Remote Work</h3>
                      <p className="mt-1 text-[11px] text-gray-500">{filteredRemoteWorkRequests.length} request{filteredRemoteWorkRequests.length === 1 ? '' : 's'}</p>
                    </div>
                    {filteredRemoteWorkRequests.length === 0 ? (
                      <div className="p-6 text-center text-[12px] text-gray-500">No remote-work requests match filters.</div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {filteredRemoteWorkRequests.map((request) => (
                          <article key={`remote-${request.bambooRowId}`} className="space-y-4 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="truncate text-[14px] font-semibold text-gray-900">{request.employeeName}</h3>
                                <p className="mt-1 text-[12px] text-gray-500">{request.email}</p>
                                <p className="mt-0.5 text-[12px] text-gray-500">{request.department}</p>
                              </div>
                              <span className="inline-flex rounded-full bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-700">
                                {request.remoteWorkType || 'Remote Work'}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-lg bg-gray-50 px-3 py-2">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Request Date</p>
                                <p className="mt-1 text-[12px] font-semibold text-gray-900">{formatOptionalDate(request.requestDate)}</p>
                              </div>
                              <div className="rounded-lg bg-gray-50 px-3 py-2">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Approval</p>
                                <p className="mt-1 text-[12px] font-semibold text-gray-900">{request.managerApprovalReceived || '—'}</p>
                              </div>
                              <div className="rounded-lg bg-gray-50 px-3 py-2">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Start</p>
                                <p className="mt-1 text-[12px] font-semibold text-gray-900">{formatOptionalDate(request.remoteWorkStartDate)}</p>
                              </div>
                              <div className="rounded-lg bg-gray-50 px-3 py-2">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">End</p>
                                <p className="mt-1 text-[12px] font-semibold text-gray-900">{formatOptionalDate(request.remoteWorkEndDate)}</p>
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
                  </section>

                  <section className="rounded-xl border border-gray-200 bg-white">
                    <div className="border-b border-gray-100 px-4 py-3">
                      <h3 className="text-[13px] font-semibold text-gray-900">Work Abroad / Another Province</h3>
                      <p className="mt-1 text-[11px] text-gray-500">{filteredWorkAbroadRequests.length} request{filteredWorkAbroadRequests.length === 1 ? '' : 's'}</p>
                    </div>
                    {filteredWorkAbroadRequests.length === 0 ? (
                      <div className="p-6 text-center text-[12px] text-gray-500">No work-abroad requests match filters.</div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {filteredWorkAbroadRequests.map((request) => (
                          <article key={`abroad-${request.bambooRowId}`} className="space-y-4 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="truncate text-[14px] font-semibold text-gray-900">{request.employeeName}</h3>
                                <p className="mt-1 text-[12px] text-gray-500">{request.email}</p>
                                <p className="mt-0.5 text-[12px] text-gray-500">{request.department}</p>
                              </div>
                              <span className="inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">
                                {request.countryOrProvince || 'Work Abroad'}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-lg bg-gray-50 px-3 py-2">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Request Date</p>
                                <p className="mt-1 text-[12px] font-semibold text-gray-900">{formatOptionalDate(request.requestDate)}</p>
                              </div>
                              <div className="rounded-lg bg-gray-50 px-3 py-2">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Approval</p>
                                <p className="mt-1 text-[12px] font-semibold text-gray-900">{request.requestApproved || '—'}</p>
                              </div>
                              <div className="rounded-lg bg-gray-50 px-3 py-2">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Start</p>
                                <p className="mt-1 text-[12px] font-semibold text-gray-900">{formatOptionalDate(request.workAbroadStartDate)}</p>
                              </div>
                              <div className="rounded-lg bg-gray-50 px-3 py-2">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">End</p>
                                <p className="mt-1 text-[12px] font-semibold text-gray-900">{formatOptionalDate(request.workAbroadEndDate)}</p>
                              </div>
                            </div>

                            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-3 text-[12px] text-gray-600">
                              <div><span className="font-medium text-gray-900">Country/Province:</span> {request.countryOrProvince || '—'}</div>
                              <div><span className="font-medium text-gray-900">Address:</span> {request.remoteWorkLocationAddress || '—'}</div>
                              <div><span className="font-medium text-gray-900">Work Schedule:</span> {request.workSchedule || '—'}</div>
                              <div><span className="font-medium text-gray-900">Approved/Declined By:</span> {request.approvedDeclinedBy || '—'}</div>
                              <div><span className="font-medium text-gray-900">Office Location:</span> {request.officeLocation}</div>
                              <div><span className="font-medium text-gray-900">Bamboo Row ID:</span> {request.bambooRowId}</div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </>
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
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${isAggregateView ? scoreTone(row.scorePct) : employeeMetricTone(row.hasActivTrakCoverage, row.scorePct)}`}>
                        {isAggregateView ? `${row.scorePct}%` : formatKnownValue(`${row.scorePct}%`, row.hasActivTrakCoverage)}
                      </span>
                    </div>

                    {!isAggregateView ? (
                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${row.hasAnyApprovedWfhCoverageInRange ? 'bg-sky-50 text-sky-700' : 'bg-gray-100 text-gray-600'}`}>
                          {row.remoteWorkStatusLabel}
                        </span>
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-600">
                          {row.email}
                        </span>
                        {!row.hasActivTrakCoverage ? (
                          <span className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">
                            No ActivTrak coverage
                          </span>
                        ) : null}
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
                        <p className="mt-1 text-[16px] font-semibold text-gray-900">{isAggregateView ? row.total : formatKnownValue(row.total, row.hasActivTrakCoverage)}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Avg/Week</p>
                        <p className="mt-1 text-[16px] font-semibold text-gray-900">{isAggregateView ? row.avgPerWeek : formatKnownValue(row.avgPerWeek, row.hasActivTrakCoverage)}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Trend</p>
                        <p className="mt-1 text-[16px] font-semibold text-gray-900">
                          {isAggregateView || row.hasActivTrakCoverage ? (row.trend === 'up' ? 'Up' : row.trend === 'down' ? 'Down' : 'Flat') : UNKNOWN_DISPLAY_VALUE}
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{isAggregateView ? 'Compliance' : 'Weeks'}</p>
                        <p className="mt-1 text-[16px] font-semibold text-gray-900">
                          {isAggregateView ? `${row.scorePct}%` : formatKnownValue(weeks.length, row.hasActivTrakCoverage)}
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
                                    : (row.hasActivTrakCoverage ? getEmployeeCellColor(cell) : unknownTone())
                                }`}>
                                  {isAggregateView ? `${departmentCompliance?.compliancePct ?? 0}%` : renderEmployeeWeekValue(cell, row.hasActivTrakCoverage)}
                                </span>
                              </div>
                              {isAggregateView ? (
                                <div className="mt-2 space-y-3 text-[11px] text-gray-500">
                                  <div className="grid grid-cols-5 gap-2">
                                    <div>
                                      <p className="uppercase tracking-wider text-gray-400">Eligible</p>
                                      <p className="mt-1 font-medium text-gray-700">{departmentCompliance?.eligibleEmployees ?? 0}</p>
                                    </div>
                                    <div>
                                      <p className="uppercase tracking-wider text-gray-400">Compliant</p>
                                      <p className="mt-1 font-medium text-gray-700">{departmentCompliance?.compliantEmployees ?? 0}</p>
                                    </div>
                                    <div>
                                      <p className="uppercase tracking-wider text-gray-400">Exempt</p>
                                      <p className="mt-1 font-medium text-gray-700">{departmentCompliance?.exemptEmployees ?? 0}</p>
                                    </div>
                                    <div>
                                      <p className="uppercase tracking-wider text-gray-400">Excused</p>
                                      <p className="mt-1 font-medium text-gray-700">{departmentCompliance?.excusedEmployees ?? 0}</p>
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
                                    <p className="uppercase tracking-wider text-gray-400">Exempt this week</p>
                                    <p className="mt-1 leading-5 text-gray-600">{formatNameBucket(departmentCompliance?.exemptNames ?? [])}</p>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-wider text-gray-400">PTO-excused</p>
                                    <p className="mt-1 leading-5 text-gray-600">{formatNameBucket(departmentCompliance?.excusedNames ?? [])}</p>
                                  </div>
                                </div>
                              ) : row.hasActivTrakCoverage ? (
                                <div className="mt-2 space-y-3 text-[11px] text-gray-500">
                                  <div className="grid grid-cols-4 gap-2">
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
                                    <div>
                                      <p className="uppercase tracking-wider text-gray-400">Target</p>
                                      <p className="mt-1 font-medium text-gray-700">
                                        {cell?.adjustedOfficeTarget == null ? (cell?.isPtoExcused ? 'Excused' : '—') : cell.adjustedOfficeTarget}
                                      </p>
                                    </div>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-wider text-gray-400">Policy</p>
                                    <p className="mt-1 leading-5 text-gray-600">
                                      {cell?.exceptionLabel || (cell?.isPtoExcused ? 'PTO-excused week' : 'Standard Policy')}
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-2 text-[11px] text-gray-500">
                                  No ActivTrak coverage. Office attendance is unknown for this employee.
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
            <div className="hidden space-y-4 md:block">
              {!hasRequestResults ? (
                <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-[13px] text-gray-500">No {resultLabel} match filters.</div>
              ) : (
                <>
                  <section className="rounded-xl border border-gray-200 bg-white">
                    <div className="border-b border-gray-100 px-4 py-3">
                      <h3 className="text-[13px] font-semibold text-gray-900">Scheduled Office Day Remote Work</h3>
                      <p className="mt-1 text-[11px] text-gray-500">Requests synced from `TL_REMOTE_WORK_REQUESTS`.</p>
                    </div>
                    <div className="max-h-[34vh] overflow-auto">
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
                            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Approval</th>
                            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Approver</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredRemoteWorkRequests.map((request) => (
                            <tr key={`remote-${request.bambooRowId}`} className="hover:bg-gray-50">
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
                        <div className="p-8 text-center text-[13px] text-gray-500">No remote-work requests match filters.</div>
                      ) : null}
                    </div>
                  </section>

                  <section className="rounded-xl border border-gray-200 bg-white">
                    <div className="border-b border-gray-100 px-4 py-3">
                      <h3 className="text-[13px] font-semibold text-gray-900">Work Abroad / Another Province</h3>
                      <p className="mt-1 text-[11px] text-gray-500">Requests synced from `TL_WORK_ABROAD_REQUESTS`.</p>
                    </div>
                    <div className="max-h-[34vh] overflow-auto">
                      <table className="min-w-[1500px] border-collapse">
                        <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-white/95 [&_th]:backdrop-blur">
                          <tr className="border-b border-gray-100">
                            <th className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Employee</th>
                            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Department</th>
                            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Request Date</th>
                            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Start Date</th>
                            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">End Date</th>
                            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Country/Province</th>
                            <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Address</th>
                            <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Reason</th>
                            <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Work Schedule</th>
                            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Approval</th>
                            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Approved/Declined By</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredWorkAbroadRequests.map((request) => (
                            <tr key={`abroad-${request.bambooRowId}`} className="hover:bg-gray-50 align-top">
                              <td className="whitespace-nowrap px-4 py-3 text-[13px] font-medium text-gray-900">
                                <div>{request.employeeName}</div>
                                <div className="mt-1 text-[11px] text-gray-400">Row {request.bambooRowId} • {request.officeLocation}</div>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{request.department}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{formatOptionalDate(request.requestDate)}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-900">{formatOptionalDate(request.workAbroadStartDate)}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{formatOptionalDate(request.workAbroadEndDate)}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{request.countryOrProvince || '—'}</td>
                              <td className="px-3 py-3 text-[12px] text-gray-600">{request.remoteWorkLocationAddress || '—'}</td>
                              <td className="px-3 py-3 text-[12px] text-gray-600">{request.reason || '—'}</td>
                              <td className="px-3 py-3 text-[12px] text-gray-600">{request.workSchedule || '—'}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{request.requestApproved || '—'}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{request.approvedDeclinedBy || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {filteredWorkAbroadRequests.length === 0 ? (
                        <div className="p-8 text-center text-[13px] text-gray-500">No work-abroad requests match filters.</div>
                      ) : null}
                    </div>
                  </section>
                </>
              )}
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
                          {isCurrent ? <span className="ml-1 normal-case tracking-normal text-[10px] text-gray-400">Current</span> : null}
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
                        <div className="min-w-0">
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
                          {!isAggregateView && !row.hasActivTrakCoverage ? (
                            <div className="mt-0.5 text-[10px] font-medium text-amber-700">No ActivTrak coverage</div>
                          ) : null}
                        </div>
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
                          : (row.hasActivTrakCoverage ? getEmployeeCellColor(cell) : unknownTone());
                        return (
                          <td key={w} className="px-2 py-1.5 text-center">
                            <div className="group relative inline-flex">
                              <span className={`inline-flex min-h-6 min-w-8 cursor-default items-center justify-center rounded px-1 text-[11px] font-medium ${color}`}>
                                {isAggregateView ? `${departmentCompliance?.compliancePct ?? 0}%` : renderEmployeeWeekValue(cell, row.hasActivTrakCoverage)}
                              </span>
                              <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-80 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                                <div className="text-left text-[11px]">
                                  {isAggregateView ? (
                                    <div className="space-y-3 text-gray-600">
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                        <div className="flex justify-between gap-3"><span>Eligible Quebec</span><span className="font-medium text-gray-900">{departmentCompliance?.eligibleEmployees ?? 0}</span></div>
                                        <div className="flex justify-between gap-3"><span>Compliant</span><span className="font-medium text-gray-900">{departmentCompliance?.compliantEmployees ?? 0}</span></div>
                                        <div className="flex justify-between gap-3"><span>Exempt</span><span className="font-medium text-gray-900">{departmentCompliance?.exemptEmployees ?? 0}</span></div>
                                        <div className="flex justify-between gap-3"><span>PTO Excused</span><span className="font-medium text-gray-900">{departmentCompliance?.excusedEmployees ?? 0}</span></div>
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
                                        <p className="uppercase tracking-wider text-gray-400">Exempt this week</p>
                                        <p className="mt-1 leading-5">{formatNameBucket(departmentCompliance?.exemptNames ?? [])}</p>
                                      </div>
                                      <div>
                                        <p className="uppercase tracking-wider text-gray-400">PTO-excused</p>
                                        <p className="mt-1 leading-5">{formatNameBucket(departmentCompliance?.excusedNames ?? [])}</p>
                                      </div>
                                    </div>
                                  ) : !row.hasActivTrakCoverage ? (
                                    <div className="text-gray-500">
                                      No ActivTrak coverage. Office attendance is unknown for this employee.
                                    </div>
                                  ) : (
                                    <div className="space-y-3 text-gray-600">
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                        <div className="flex justify-between gap-3"><span>Office days</span><span className="font-medium text-gray-900">{office}</span></div>
                                        <div className="flex justify-between gap-3"><span>Remote days</span><span className="font-medium text-gray-900">{remote}</span></div>
                                        <div className="flex justify-between gap-3"><span>PTO days</span><span className="font-medium text-gray-900">{pto}</span></div>
                                        <div className="flex justify-between gap-3"><span>Adjusted target</span><span className="font-medium text-gray-900">{cell?.adjustedOfficeTarget == null ? (cell?.isPtoExcused ? 'Excused' : '—') : cell.adjustedOfficeTarget}</span></div>
                                        <div className="flex justify-between gap-3"><span>Coverage source</span><span className="font-medium text-gray-900">{getCoverageSummaryLabel(cell)}</span></div>
                                        <div className="flex justify-between gap-3"><span>Approved weekdays</span><span className="font-medium text-gray-900">{cell?.approvedCoverageWeekdays ?? 0}</span></div>
                                      </div>
                                      <div>
                                        <p className="uppercase tracking-wider text-gray-400">Policy</p>
                                        <p className="mt-1">{cell?.exceptionLabel || (cell?.isPtoExcused ? 'PTO-excused week' : 'Standard Policy')}</p>
                                      </div>
                                      {cell && cell.days.length > 0 ? (
                                        <div className="space-y-0.5">
                                          <p className="uppercase tracking-wider text-gray-400">Daily activity</p>
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
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap px-3 py-1.5 text-center text-[13px] font-semibold text-gray-900">
                        {isAggregateView ? row.total : formatKnownValue(row.total, row.hasActivTrakCoverage)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-center text-[12px] text-gray-600">
                        {isAggregateView ? row.avgPerWeek : formatKnownValue(row.avgPerWeek, row.hasActivTrakCoverage)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${isAggregateView ? scoreTone(row.scorePct) : employeeMetricTone(row.hasActivTrakCoverage, row.scorePct)}`}>
                          {isAggregateView ? `${row.scorePct}%` : formatKnownValue(`${row.scorePct}%`, row.hasActivTrakCoverage)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-center text-[14px]">
                        {!isAggregateView && !row.hasActivTrakCoverage ? <span className="text-gray-400">{UNKNOWN_DISPLAY_VALUE}</span> :
                         row.trend === 'up' ? <span className="text-green-600">↑</span> :
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
          <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.compliant}`} /> Compliant under adjusted policy</span>
          <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.partial}`} /> Below adjusted target</span>
          <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.absent}`} /> No office days</span>
          <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.pto}`} /> PTO-excused week</span>
          <span className="flex items-center gap-1.5">{renderWeekCoverageMarkers({ hasApprovedRemoteCoverage: true, hasApprovedWorkAbroadCoverage: false }, 'h-3.5 w-3.5')} Approved remote-work coverage affected this week</span>
          <span className="flex items-center gap-1.5">{renderWeekCoverageMarkers({ hasApprovedRemoteCoverage: false, hasApprovedWorkAbroadCoverage: true }, 'h-3.5 w-3.5')} Approved work-abroad coverage affected this week</span>
          {currentWeek ? <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-300" /> Current week is excluded from score</span> : null}
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
                  <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Approved Coverage</label>
                  <select
                    value={wfhFilter}
                    onChange={(e) => {
                      setWfhFilter(e.target.value as WfhFilterMode);
                      setPage(0);
                    }}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
                  >
                    <option value="all">All Employees</option>
                    <option value="standard-only">Only Standard Policy</option>
                    <option value="approved-only">Only Approved Coverage</option>
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
                    setWfhFilter('all');
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
  const hasActivTrakCoverage = row.hasActivTrakCoverage;
  const weekSummaries = weeks.map((week) => {
    const cell = row.weeks[week] || createEmptyWeekCell();
    return {
      week,
      label: getWeekLabel(week),
      officeDays: cell.officeDays ?? 0,
      remoteDays: cell.remoteDays ?? 0,
      ptoDays: cell.ptoDays ?? 0,
      adjustedOfficeTarget: cell.adjustedOfficeTarget,
      adjustedCompliant: cell.adjustedCompliant,
      isPtoExcused: cell.isPtoExcused,
      hasApprovedWfhCoverage: cell.hasApprovedWfhCoverage,
      hasApprovedRemoteCoverage: cell.hasApprovedRemoteCoverage,
      hasApprovedWorkAbroadCoverage: cell.hasApprovedWorkAbroadCoverage,
      approvedCoverageWeekdays: cell.approvedCoverageWeekdays ?? 0,
      exceptionLabel: cell.exceptionLabel,
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
      monthStarts.push(new Date(cursor.getTime()));
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
              {row.hasStandingWfhPolicy ? (
                <span className="inline-flex rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
                  Standing WFH Policy
                </span>
              ) : null}
              {row.hasApprovedRemoteRequestInRange ? (
                <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                  Temporary Remote Work
                </span>
              ) : null}
              {row.hasApprovedWorkAbroadRequestInRange ? (
                <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  Work Abroad / Province
                </span>
              ) : null}
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                row.hasAnyApprovedWfhCoverageInRange ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {row.remoteWorkStatusLabel}
              </span>
              {!hasActivTrakCoverage ? (
                <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  No ActivTrak coverage
                </span>
              ) : null}
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

        {!hasActivTrakCoverage ? (
          <div className="border-b border-amber-100 bg-amber-50/80 px-6 py-3 text-[12px] text-amber-800">
            This employee does not currently have an ActivTrak identity in the source data. Office attendance is unknown, so attendance values are intentionally left blank instead of showing zero.
          </div>
        ) : null}

        <div className="grid gap-4 border-b border-gray-100 bg-gray-50/70 px-6 py-4 md:grid-cols-5">
          <MetricCard label="Score" value={formatKnownValue(`${row.scorePct}%`, hasActivTrakCoverage)} tone={employeeMetricTone(hasActivTrakCoverage, row.scorePct)} />
          <MetricCard label="Office Days" value={formatKnownValue(officeDays, hasActivTrakCoverage)} />
          <MetricCard label="Remote Days" value={formatKnownValue(remoteDays, hasActivTrakCoverage)} />
          <MetricCard label="PTO Days" value={String(ptoDays)} />
          <MetricCard label="Weeks With Activity" value={formatKnownValue(activeWeeks, hasActivTrakCoverage)} />
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
                <p className="mt-1 text-[12px] text-gray-400">Weeks are scored against the adjusted office target after approved week-level coverage and PTO exceptions.</p>
              </div>
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <div className="divide-y divide-gray-100">
                  {weekSummaries.map((weekSummary) => {
                    const compliantWeek = hasActivTrakCoverage && weekSummary.adjustedCompliant === true;
                    const exemptWeek = hasActivTrakCoverage && weekSummary.hasApprovedWfhCoverage && weekSummary.adjustedOfficeTarget === 0;
                    const excusedWeek = hasActivTrakCoverage && weekSummary.isPtoExcused;
                    return (
                      <div key={weekSummary.week} className="flex items-center justify-between gap-4 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-gray-900">{weekSummary.label}</p>
                          <p className="mt-1 text-[11px] text-gray-400">
                            {hasActivTrakCoverage
                              ? (
                                <>
                                  <span className="inline-flex items-center gap-1">
                                    <span>{weekSummary.officeDays}</span>
                                    {renderWeekCoverageMarkers(weekSummary)}
                                  </span>
                                  <span>{` office • ${weekSummary.remoteDays} remote • ${weekSummary.ptoDays} PTO`}</span>
                                </>
                              )
                              : `Attendance unknown • ${weekSummary.ptoDays} PTO`}
                          </p>
                          {hasActivTrakCoverage ? (
                            <p className="mt-1 text-[11px] text-gray-500">
                              {weekSummary.adjustedOfficeTarget == null
                                ? (weekSummary.isPtoExcused ? 'Adjusted target: PTO-excused' : 'Adjusted target: —')
                                : `Adjusted target: ${weekSummary.adjustedOfficeTarget}`}
                              {weekSummary.exceptionLabel ? ` • ${weekSummary.exceptionLabel}` : ''}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-3">
                          {compliantWeek ? (
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-100 text-[14px] font-semibold text-green-700">
                              {excusedWeek ? 'P' : exemptWeek ? 'E' : '✓'}
                            </span>
                          ) : (
                            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[14px] font-semibold ${hasActivTrakCoverage ? 'bg-gray-100 text-gray-400' : 'bg-amber-50 text-amber-700'}`}>
                              {hasActivTrakCoverage ? '—' : '?'}
                            </span>
                          )}
                          {hasActivTrakCoverage ? (
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              excusedWeek
                                ? 'bg-blue-50 text-blue-700'
                                : exemptWeek
                                  ? 'bg-green-50 text-green-700'
                                  : employeeMetricTone(hasActivTrakCoverage, weekSummary.scorePct)
                            }`}>
                              {excusedWeek ? 'Excused' : exemptWeek ? 'Exempt' : `${weekSummary.scorePct}%`}
                            </span>
                          ) : (
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${employeeMetricTone(hasActivTrakCoverage, weekSummary.scorePct)}`}>
                              {formatKnownValue(`${weekSummary.scorePct}%`, hasActivTrakCoverage)}
                            </span>
                          )}
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
                          <td colSpan={6} className="px-4 py-8 text-center text-[13px] text-gray-500">
                            {hasActivTrakCoverage
                              ? 'No day-level activity in this range.'
                              : 'No ActivTrak day-level data is available for this employee in this range.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label="Unknown Days" value={formatKnownValue(unknownDays, hasActivTrakCoverage)} />
                <MetricCard label="Avg Office / Week" value={formatKnownValue(row.avgPerWeek, hasActivTrakCoverage)} />
                <MetricCard label="Trend" value={hasActivTrakCoverage ? (row.trend === 'flat' ? 'Flat' : row.trend === 'up' ? 'Up' : 'Down') : UNKNOWN_DISPLAY_VALUE} />
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

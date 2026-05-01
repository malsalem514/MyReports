'use client';

import { Download, Filter, House, Plane, X } from 'lucide-react';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  CELL_COLORS,
  DEFAULT_OFFICE_ATTENDANCE_LOOKBACK_WEEKS,
  LOOKBACK_OPTIONS,
  OFFICE_DAYS_REQUIRED,
} from '@/lib/constants';
import {
  buildApprovalRequestCsvContent,
  buildApprovalRequestExportData,
  buildAttendanceCsvContent,
  buildAttendanceExportData,
  toCsvRow,
} from '@/lib/office-attendance-export';
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
import {
  buildApprovalRequestSummary,
  buildCombinedApprovalRequests,
  buildDisplayRows,
  buildFilteredAttendanceSummary,
  buildGroupedRows,
  compareMaybeNumber,
  createEmptyWeekCell,
  filterAttendanceRows,
  filterRemoteWorkRequests,
  filterWorkAbroadRequests,
  getDefaultSortDirectionForKey,
  getEmployeeCellColor,
  getWeekPointCapacity,
  getWeekPoints,
  getWeekCoverageKinds,
  getWeekLabel,
  formatNameBucket,
  sortDisplayRows,
  type ApprovalRequestRow,
  type DisplayRow,
  type GroupRow,
  type SortDir,
  type SortKey,
  type WeeklyCompliance,
  type WfhFilterMode,
} from '@/lib/office-attendance-view';
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

type ViewMode = OfficeAttendanceViewKey;
type DateFilterMode = 'quick' | 'custom';
type OfficeWindowSortKey = 'name' | 'officeDayCount' | 'avgOfficeWindowHours' | 'avgOfficeDayHours' | 'avgRemoteDayHours' | 'officeSharePct';
const DEFAULT_EMPLOYEE_LOCATION = 'Quebec (Montreal Head Office)';

function getInitialViewMode(searchParams: SearchParamReader): ViewMode {
  const view = searchParams.get('view');
  if (view === 'employees' || view === 'office-day-hours' || view === 'departments' || view === 'managers' || view === 'approved-remote-work') {
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
  if (viewMode !== 'employees' && viewMode !== 'office-day-hours') return [];
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

interface DetailState {
  row: DisplayRow;
}

interface OfficeDayHoursDay {
  date: string;
  week: string;
  weekLabel: string;
  activeHours: number;
  officeHours: number;
  officeWindowHours: number | null;
  remoteHours: number;
  tbsReportedHours: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  officeFirstActivityAt: string | null;
  officeLastActivityAt: string | null;
  officeIpMatches: string | null;
  isShort: boolean;
}

interface OfficeDayHoursWeekCell {
  week: string;
  label: string;
  officeDayCount: number;
  shortOfficeDayCount: number;
  totalOfficeWindowHours: number;
  totalOfficeHours: number;
  totalRemoteHours: number;
  totalTrackedHours: number;
  officeWindowDayCount: number;
  avgOfficeWindowHours: number | null;
  avgOfficeHours: number | null;
  officeSharePct: number;
  days: OfficeDayHoursDay[];
}

interface OfficeDayHoursRow {
  id: string;
  label: string;
  secondary: string;
  email?: string;
  managerName?: string;
  officeLocation: string;
  remoteWorkStatusLabel: string;
  hasActivTrakCoverage: boolean;
  hasStandingWfhPolicy: boolean;
  hasAnyApprovedWfhCoverageInRange: boolean;
  displayRow: DisplayRow;
  officeDayCount: number;
  shortOfficeDayCount: number;
  shortOfficeLongWorkdayCount: number;
  shortOfficeDayRate: number;
  avgOfficeWindowHours: number | null;
  avgOfficeDayHours: number | null;
  avgRemoteDayHours: number | null;
  avgTotalDayHours: number | null;
  avgTbsReportedHours: number | null;
  officeSharePct: number;
  totalOfficeWindowHours: number;
  totalOfficeHours: number;
  totalRemoteHours: number;
  totalTrackedHours: number;
  weeks: Record<string, OfficeDayHoursWeekCell>;
  days: OfficeDayHoursDay[];
  shortDays: OfficeDayHoursDay[];
}

interface OfficeDayHoursBucket {
  key: string;
  label: string;
  count: number;
  percent: number;
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
const UNKNOWN_DISPLAY_VALUE = '—';
const DEFAULT_SHORT_OFFICE_DAY_HOURS = 4;
const SHORT_OFFICE_DAY_THRESHOLD_OPTIONS = [2, 3, 4, 5, 6] as const;
const FULL_WORKDAY_ACTIVE_HOURS = 6;

/** Parse YYYY-MM-DD as local date (avoids UTC timezone shift) */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function getAdjustedTargetDisplay(cell?: Pick<WeekCell, 'adjustedOfficeTarget' | 'isPtoExcused'>): string {
  if (cell?.adjustedOfficeTarget == null) return cell?.isPtoExcused ? 'Excused' : '—';
  return String(cell.adjustedOfficeTarget);
}

function getWeekPolicyLabel(cell?: Pick<WeekCell, 'exceptionLabel' | 'isPtoExcused'>): string {
  if (cell?.exceptionLabel && cell?.isPtoExcused) return `${cell.exceptionLabel} · PTO-excused`;
  if (cell?.exceptionLabel) return cell.exceptionLabel;
  return cell?.isPtoExcused ? 'PTO-excused week' : 'Standard Policy';
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

function formatKnownValue(value: number | string, isKnown: boolean): string {
  return isKnown ? String(value) : UNKNOWN_DISPLAY_VALUE;
}

function employeeMetricTone(isKnown: boolean, scorePct: number): string {
  return isKnown ? scoreTone(scorePct) : unknownTone();
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

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseShortOfficeDayThreshold(raw: string | null): number {
  const value = Number(raw);
  return SHORT_OFFICE_DAY_THRESHOLD_OPTIONS.includes(value as (typeof SHORT_OFFICE_DAY_THRESHOLD_OPTIONS)[number])
    ? value
    : DEFAULT_SHORT_OFFICE_DAY_HOURS;
}

function formatHoursValue(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}h`;
}

function formatPercentValue(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value}%`;
}

function getShortOfficeDayTone(officeHours: number, threshold: number): string {
  if (officeHours < threshold) return 'bg-red-50 text-red-700';
  if (officeHours < threshold + 1) return 'bg-amber-50 text-amber-700';
  return 'bg-green-50 text-green-700';
}

function getOfficeWeekCellTone(cell: OfficeDayHoursWeekCell, threshold: number): string {
  if (cell.officeDayCount === 0) return 'bg-gray-50 text-gray-500 border-gray-200';
  if (cell.shortOfficeDayCount > 0) return 'bg-red-50 text-red-800 border-red-100';
  if (cell.avgOfficeWindowHours === null) return 'bg-gray-50 text-gray-500 border-gray-200';
  if (cell.avgOfficeWindowHours < threshold + 1) return 'bg-amber-50 text-amber-800 border-amber-100';
  return 'bg-green-50 text-green-800 border-green-100';
}

function getOfficeDaySharePct(day: OfficeDayHoursDay): number {
  if (day.activeHours <= 0) return day.officeHours > 0 ? 100 : 0;
  return Math.min(100, Math.round((day.officeHours / day.activeHours) * 100));
}

function getOfficeWindowHoursForThreshold(day: OfficeDayHoursDay): number | null {
  return day.officeWindowHours;
}

function createOfficeDayHoursWeekCell(week: string): OfficeDayHoursWeekCell {
  return {
    week,
    label: getWeekLabel(week),
    officeDayCount: 0,
    shortOfficeDayCount: 0,
    totalOfficeWindowHours: 0,
    totalOfficeHours: 0,
    totalRemoteHours: 0,
    totalTrackedHours: 0,
    officeWindowDayCount: 0,
    avgOfficeWindowHours: null,
    avgOfficeHours: null,
    officeSharePct: 0,
    days: [],
  };
}

function formatOfficeWeekCellExportValue(cell: OfficeDayHoursWeekCell | undefined): string {
  if (!cell || cell.officeDayCount === 0) return '';
  return cell.days
    .map((day) => `${formatCompactDayLabel(day.date)}: ${formatHoursValue(day.officeWindowHours)} window, ${formatHoursValue(day.officeHours)} office activity, ${formatHoursValue(day.remoteHours)} home/other active, ${getOfficeDaySharePct(day)}% office activity`)
    .join(' | ');
}

function formatCompactDayLabel(date: string): string {
  return parseLocalDate(date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  });
}

function formatActivityTime(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
  const [officeWindowSortKey, setOfficeWindowSortKey] = useState<OfficeWindowSortKey>('avgOfficeWindowHours');
  const [officeWindowSortDir, setOfficeWindowSortDir] = useState<SortDir>('desc');
  const [shortOfficeDayThreshold, setShortOfficeDayThreshold] = useState(() => parseShortOfficeDayThreshold(searchParams.get('shortOfficeHours')));
  const [selectedOfficeWindowEmployeeId, setSelectedOfficeWindowEmployeeId] = useState<string | null>(null);
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
  const isOfficeDayHoursView = viewMode === 'office-day-hours';
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
    setShortOfficeDayThreshold(parseShortOfficeDayThreshold(searchParams.get('shortOfficeHours')));
  }, [searchParams]);

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
    else { setSortKey(key); setSortDir(getDefaultSortDirectionForKey(key)); }
    setPage(0);
  };

  const handleOfficeWindowSort = useCallback((key: OfficeWindowSortKey) => {
    setOfficeWindowSortKey(key);
    setOfficeWindowSortDir((previousDir) => (
      officeWindowSortKey === key
        ? (previousDir === 'asc' ? 'desc' : 'asc')
        : (key === 'name' ? 'asc' : 'desc')
    ));
  }, [officeWindowSortKey]);

  const changeShortOfficeDayThreshold = (raw: string) => {
    const threshold = parseShortOfficeDayThreshold(raw);
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', 'office-day-hours');
    params.set('shortOfficeHours', String(threshold));
    params.delete('page');
    setShortOfficeDayThreshold(threshold);
    setPage(0);
    router.replace(`/dashboard/office-attendance?${params.toString()}`, { scroll: false });
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
  const filtered = useMemo(
    () => filterAttendanceRows({
      rows,
      selectedDepartments: selectedDepts,
      selectedLocations: selectedLocs,
      isAggregateView,
      isApprovedRemoteWorkView,
      search,
      wfhFilter,
    }),
    [isAggregateView, isApprovedRemoteWorkView, rows, search, selectedDepts, selectedLocs, wfhFilter],
  );

  const groupedRows = useMemo<GroupRow[]>(
    () => buildGroupedRows({
      filteredRows: filtered,
      isManagerView,
      weeks,
      scoredWeeks,
      defaultEmployeeLocation: DEFAULT_EMPLOYEE_LOCATION,
    }),
    [filtered, isManagerView, scoredWeeks, weeks],
  );

  const displayRows = useMemo<DisplayRow[]>(
    () => buildDisplayRows({
      filteredRows: filtered,
      groupedRows,
      isAggregateView,
      scoredWeeks,
      weeks,
    }),
    [filtered, groupedRows, isAggregateView, scoredWeeks, weeks],
  );

  const sorted = useMemo(
    () => sortDisplayRows({
      rows: displayRows,
      sortKey,
      sortDir,
      isAggregateView,
    }),
    [displayRows, isAggregateView, sortDir, sortKey],
  );

  const officeDayHourRows = useMemo<OfficeDayHoursRow[]>(() => {
    return displayRows
      .filter((row) => !isAggregateView && row.hasActivTrakCoverage)
      .map((row) => {
        const days: OfficeDayHoursDay[] = [];

        for (const week of weeks) {
          const cell = row.weeks[week];
          if (!cell) continue;

          for (const day of cell.days ?? []) {
            const officeHours = roundToTenth(Math.max(0, day.officeHours ?? 0));
            const officeWindowHours = day.officeWindowHours === null || day.officeWindowHours === undefined
              ? null
              : roundToTenth(Math.max(0, day.officeWindowHours));
            const activeHours = roundToTenth(Math.max(0, day.activeHours ?? 0));
            const isOfficeDay = day.location === 'Office' || officeHours > 0;
            if (!isOfficeDay) continue;

            const remoteHours = roundToTenth(Math.max(0, day.remoteHours ?? activeHours - officeHours));
            days.push({
              date: day.date,
              week,
              weekLabel: getWeekLabel(week),
              activeHours,
              officeHours,
              officeWindowHours,
              remoteHours,
              tbsReportedHours: roundToTenth(Math.max(0, day.tbsReportedHours ?? 0)),
              firstActivityAt: day.firstActivityAt ?? null,
              lastActivityAt: day.lastActivityAt ?? null,
              officeFirstActivityAt: day.officeFirstActivityAt ?? null,
              officeLastActivityAt: day.officeLastActivityAt ?? null,
              officeIpMatches: day.officeIpMatches ?? null,
              isShort: officeWindowHours !== null && officeWindowHours < shortOfficeDayThreshold,
            });
          }
        }

        const weekly = Object.fromEntries(
          weeks.map((week) => [week, createOfficeDayHoursWeekCell(week)]),
        ) as Record<string, OfficeDayHoursWeekCell>;

        for (const day of days) {
          if (!weekly[day.week]) weekly[day.week] = createOfficeDayHoursWeekCell(day.week);
          const weekCell = weekly[day.week]!;
          weekCell.officeDayCount += 1;
          weekCell.shortOfficeDayCount += day.isShort ? 1 : 0;
          if (day.officeWindowHours !== null) {
            weekCell.officeWindowDayCount += 1;
            weekCell.totalOfficeWindowHours = roundToTenth(weekCell.totalOfficeWindowHours + day.officeWindowHours);
          }
          weekCell.totalOfficeHours = roundToTenth(weekCell.totalOfficeHours + day.officeHours);
          weekCell.totalRemoteHours = roundToTenth(weekCell.totalRemoteHours + day.remoteHours);
          weekCell.totalTrackedHours = roundToTenth(weekCell.totalTrackedHours + day.activeHours);
          weekCell.days.push(day);
        }

        for (const weekCell of Object.values(weekly)) {
          weekCell.days.sort((a, b) => a.date.localeCompare(b.date));
          weekCell.avgOfficeWindowHours = weekCell.officeWindowDayCount > 0
            ? roundToTenth(weekCell.totalOfficeWindowHours / weekCell.officeWindowDayCount)
            : null;
          weekCell.avgOfficeHours = weekCell.officeDayCount > 0
            ? roundToTenth(weekCell.totalOfficeHours / weekCell.officeDayCount)
            : null;
          weekCell.officeSharePct = weekCell.totalTrackedHours > 0
            ? Math.min(100, Math.round((weekCell.totalOfficeHours / weekCell.totalTrackedHours) * 100))
            : 0;
        }

        const officeDayCount = days.length;
        const shortDays = days.filter((day) => day.isShort);
        const shortOfficeLongWorkdayCount = shortDays.filter((day) => day.activeHours >= FULL_WORKDAY_ACTIVE_HOURS).length;
        const officeWindowDays = days.filter((day) => day.officeWindowHours !== null);
        const totalOfficeWindowHours = roundToTenth(officeWindowDays.reduce((sum, day) => sum + (day.officeWindowHours ?? 0), 0));
        const totalOfficeHours = roundToTenth(days.reduce((sum, day) => sum + day.officeHours, 0));
        const totalRemoteHours = roundToTenth(days.reduce((sum, day) => sum + day.remoteHours, 0));
        const totalTrackedHours = roundToTenth(days.reduce((sum, day) => sum + day.activeHours, 0));
        const totalTbsReportedHours = roundToTenth(days.reduce((sum, day) => sum + day.tbsReportedHours, 0));

        return {
          id: row.id,
          label: row.label,
          secondary: row.secondary,
          email: row.email,
          managerName: row.managerName,
          officeLocation: row.officeLocation,
          remoteWorkStatusLabel: row.remoteWorkStatusLabel,
          hasActivTrakCoverage: row.hasActivTrakCoverage,
          hasStandingWfhPolicy: row.hasStandingWfhPolicy,
          hasAnyApprovedWfhCoverageInRange: row.hasAnyApprovedWfhCoverageInRange,
          displayRow: row,
          officeDayCount,
          shortOfficeDayCount: shortDays.length,
          shortOfficeLongWorkdayCount,
          shortOfficeDayRate: officeDayCount > 0 ? Math.round((shortDays.length / officeDayCount) * 100) : 0,
          avgOfficeWindowHours: officeWindowDays.length > 0 ? roundToTenth(totalOfficeWindowHours / officeWindowDays.length) : null,
          avgOfficeDayHours: officeDayCount > 0 ? roundToTenth(totalOfficeHours / officeDayCount) : null,
          avgRemoteDayHours: officeDayCount > 0 ? roundToTenth(totalRemoteHours / officeDayCount) : null,
          avgTotalDayHours: officeDayCount > 0 ? roundToTenth(totalTrackedHours / officeDayCount) : null,
          avgTbsReportedHours: officeDayCount > 0 ? roundToTenth(totalTbsReportedHours / officeDayCount) : null,
          officeSharePct: totalTrackedHours > 0 ? Math.min(100, Math.round((totalOfficeHours / totalTrackedHours) * 100)) : 0,
          totalOfficeWindowHours,
          totalOfficeHours,
          totalRemoteHours,
          totalTrackedHours,
          weeks: weekly,
          days: days.sort((a, b) => a.date.localeCompare(b.date)),
          shortDays,
        };
      })
      .filter((row) => row.officeDayCount > 0);
  }, [displayRows, isAggregateView, shortOfficeDayThreshold, weeks]);

  const officeWindowRows = useMemo(() => {
    const direction = officeWindowSortDir === 'asc' ? 1 : -1;
    return [...officeDayHourRows].sort((left, right) => {
      let comparison = 0;
      if (officeWindowSortKey === 'name') comparison = left.label.localeCompare(right.label);
      else if (officeWindowSortKey === 'officeDayCount') comparison = left.officeDayCount - right.officeDayCount;
      else if (officeWindowSortKey === 'avgOfficeWindowHours') comparison = compareMaybeNumber(left.avgOfficeWindowHours, right.avgOfficeWindowHours, direction);
      else if (officeWindowSortKey === 'avgOfficeDayHours') comparison = compareMaybeNumber(left.avgOfficeDayHours, right.avgOfficeDayHours, direction);
      else if (officeWindowSortKey === 'avgRemoteDayHours') comparison = compareMaybeNumber(left.avgRemoteDayHours, right.avgRemoteDayHours, direction);
      else if (officeWindowSortKey === 'officeSharePct') comparison = left.officeSharePct - right.officeSharePct;

      if (comparison !== 0) return officeWindowSortKey.startsWith('avg') ? comparison : direction * comparison;
      return left.label.localeCompare(right.label);
    });
  }, [officeDayHourRows, officeWindowSortDir, officeWindowSortKey]);

  const selectedOfficeWindowRow = useMemo(
    () => officeDayHourRows.find((row) => row.id === selectedOfficeWindowEmployeeId) ?? null,
    [officeDayHourRows, selectedOfficeWindowEmployeeId],
  );

  useEffect(() => {
    if (!selectedOfficeWindowEmployeeId) return;
    if (!officeDayHourRows.some((row) => row.id === selectedOfficeWindowEmployeeId)) {
      setSelectedOfficeWindowEmployeeId(null);
    }
  }, [officeDayHourRows, selectedOfficeWindowEmployeeId]);

  const detailOfficeDayHourRows = useMemo(
    () => selectedOfficeWindowRow ? [selectedOfficeWindowRow] : officeDayHourRows,
    [officeDayHourRows, selectedOfficeWindowRow],
  );

  const sortedOfficeDayHourRows = useMemo(() => {
    const direction = sortDir === 'asc' ? 1 : -1;
    return [...detailOfficeDayHourRows].sort((left, right) => {
      if (sortKey === 'name') return direction * left.label.localeCompare(right.label);
      if (sortKey === 'department') return direction * left.secondary.localeCompare(right.secondary);
      if (sortKey === 'officeLocation') return direction * left.officeLocation.localeCompare(right.officeLocation);
      if (sortKey === 'total') return direction * (left.officeDayCount - right.officeDayCount);
      if (sortKey === 'avgOfficeWindowHours') return compareMaybeNumber(left.avgOfficeWindowHours, right.avgOfficeWindowHours, direction);
      if (sortKey === 'avgPerWeek' || sortKey === 'avgOfficeDayHours') return compareMaybeNumber(left.avgOfficeDayHours, right.avgOfficeDayHours, direction);
      if (sortKey === 'avgRemoteDayHours') return compareMaybeNumber(left.avgRemoteDayHours, right.avgRemoteDayHours, direction);
      if (sortKey === 'officeSharePct') return direction * (left.officeSharePct - right.officeSharePct);
      return left.label.localeCompare(right.label);
    });
  }, [detailOfficeDayHourRows, sortDir, sortKey]);

  const officeDayHoursSummary = useMemo(() => {
    const bucketSeeds: OfficeDayHoursBucket[] = [
      { key: 'lt2', label: '<2h', count: 0, percent: 0 },
      { key: '2to4', label: '2-4h', count: 0, percent: 0 },
      { key: '4to6', label: '4-6h', count: 0, percent: 0 },
      { key: '6to8', label: '6-8h', count: 0, percent: 0 },
      { key: 'gte8', label: '8h+', count: 0, percent: 0 },
    ];
    let officeDayCount = 0;
    let shortOfficeDayCount = 0;
    let shortOfficeLongWorkdayCount = 0;
    let officeWindowDayCount = 0;
    let totalOfficeWindowHours = 0;
    let totalOfficeHours = 0;
    let totalRemoteHours = 0;
    let totalTrackedHours = 0;

    for (const row of officeDayHourRows) {
      officeDayCount += row.officeDayCount;
      shortOfficeDayCount += row.shortOfficeDayCount;
      shortOfficeLongWorkdayCount += row.shortOfficeLongWorkdayCount;
      officeWindowDayCount += row.days.filter((day) => day.officeWindowHours !== null).length;
      totalOfficeWindowHours += row.totalOfficeWindowHours;
      totalOfficeHours += row.totalOfficeHours;
      totalRemoteHours += row.totalRemoteHours;
      totalTrackedHours += row.totalTrackedHours;
      for (const day of row.days) {
        const officeWindowHours = getOfficeWindowHoursForThreshold(day);
        if (officeWindowHours === null) continue;
        if (officeWindowHours < 2) bucketSeeds[0]!.count += 1;
        else if (officeWindowHours < 4) bucketSeeds[1]!.count += 1;
        else if (officeWindowHours < 6) bucketSeeds[2]!.count += 1;
        else if (officeWindowHours < 8) bucketSeeds[3]!.count += 1;
        else bucketSeeds[4]!.count += 1;
      }
    }

    const buckets = bucketSeeds.map((bucket) => ({
      ...bucket,
      percent: officeWindowDayCount > 0 ? Math.round((bucket.count / officeWindowDayCount) * 100) : 0,
    }));

    return {
      employeeCount: officeDayHourRows.length,
      impactedEmployeeCount: officeDayHourRows.filter((row) => row.shortOfficeDayCount > 0).length,
      officeDayCount,
      shortOfficeDayCount,
      shortOfficeLongWorkdayCount,
      shortOfficeDayRate: officeWindowDayCount > 0 ? Math.round((shortOfficeDayCount / officeWindowDayCount) * 100) : 0,
      avgOfficeWindowHours: officeWindowDayCount > 0 ? roundToTenth(totalOfficeWindowHours / officeWindowDayCount) : null,
      avgOfficeHours: officeDayCount > 0 ? roundToTenth(totalOfficeHours / officeDayCount) : null,
      avgRemoteHours: officeDayCount > 0 ? roundToTenth(totalRemoteHours / officeDayCount) : null,
      avgTotalHours: officeDayCount > 0 ? roundToTenth(totalTrackedHours / officeDayCount) : null,
      officeSharePct: totalTrackedHours > 0 ? Math.min(100, Math.round((totalOfficeHours / totalTrackedHours) * 100)) : 0,
      buckets,
    };
  }, [officeDayHourRows]);

  const filteredSummary = useMemo(
    () => buildFilteredAttendanceSummary({
      filteredRows: filtered,
      groupedRows,
      isAggregateView,
      scoredWeeks,
    }),
    [filtered, groupedRows, isAggregateView, scoredWeeks],
  );

  const filteredRemoteWorkRequests = useMemo(
    () => filterRemoteWorkRequests({
      requests: remoteWorkRequests,
      selectedDepartments: selectedDepts,
      selectedLocations: selectedLocs,
      search,
      sortDir,
    }),
    [remoteWorkRequests, search, selectedDepts, selectedLocs, sortDir],
  );

  const filteredWorkAbroadRequests = useMemo(
    () => filterWorkAbroadRequests({
      requests: workAbroadRequests,
      selectedDepartments: selectedDepts,
      selectedLocations: selectedLocs,
      search,
      sortDir,
    }),
    [workAbroadRequests, search, selectedDepts, selectedLocs, sortDir],
  );

  const requestSummary = useMemo(
    () => buildApprovalRequestSummary(filteredRemoteWorkRequests, filteredWorkAbroadRequests),
    [filteredRemoteWorkRequests, filteredWorkAbroadRequests],
  );

  const combinedApprovalRequests = useMemo<ApprovalRequestRow[]>(
    () => buildCombinedApprovalRequests({
      filteredRemoteWorkRequests,
      filteredWorkAbroadRequests,
      sortDir,
    }),
    [filteredRemoteWorkRequests, filteredWorkAbroadRequests, sortDir],
  );
  const hasRequestResults = filteredRemoteWorkRequests.length > 0 || filteredWorkAbroadRequests.length > 0;

  const activeRowsCount = isApprovedRemoteWorkView
    ? combinedApprovalRequests.length
    : isOfficeDayHoursView
      ? sortedOfficeDayHourRows.length
      : sorted.length;
  const totalPages = Math.max(1, Math.ceil(activeRowsCount / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageOfficeDayHourRows = sortedOfficeDayHourRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
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

  const approvalExportData = useMemo(
    () => buildApprovalRequestExportData(combinedApprovalRequests),
    [combinedApprovalRequests],
  );

  const attendanceExportData = useMemo(
    () => buildAttendanceExportData({
      rows: sorted,
      weeks,
      isAggregateView,
      aggregateLabel,
      aggregatePluralLabel,
      filteredSummary,
    }),
    [aggregateLabel, aggregatePluralLabel, filteredSummary, isAggregateView, sorted, weeks],
  );

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
    if (isOfficeDayHoursView) {
      const headers = [
        'Employee',
        'Department',
        'Email',
        'Manager',
        'Location',
        'Office Days',
        'Avg Office Window Hours',
        'Avg Office Activity Hours',
        'Avg Home/Other Active Hours',
        'Office Activity Share %',
        'Short Office Windows',
        ...weeks.map((week) => getWeekLabel(week)),
      ];
      const rows = sortedOfficeDayHourRows.map((row) => [
        row.label,
        row.secondary,
        row.email || '',
        row.managerName || '',
        row.officeLocation,
        row.officeDayCount,
        row.avgOfficeWindowHours?.toFixed(1) ?? '',
        row.avgOfficeDayHours?.toFixed(1) ?? '',
        row.avgRemoteDayHours?.toFixed(1) ?? '',
        row.officeSharePct,
        row.shortOfficeDayCount,
        ...weeks.map((week) => formatOfficeWeekCellExportValue(row.weeks[week])),
      ]);
      const csv = [toCsvRow(headers), ...rows.map(toCsvRow)].join('\n');
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `office-day-hours-${startDate}-${endDate}.csv`);
      return;
    }

    if (isApprovedRemoteWorkView) {
      const csv = buildApprovalRequestCsvContent(approvalExportData);
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `office-attendance-approved-coverage-requests-${startDate}-${endDate}.csv`);
      return;
    }

    const csv = buildAttendanceCsvContent(attendanceExportData);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `office-attendance-${startDate}-${endDate}-${viewMode}.csv`);
  };

  const exportXLSX = async () => {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Office Attendance');
    const styleHeaderRow = (row: any) => {
      row.font = { bold: true, size: 11 };
      row.eachCell((cell: any) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
      });
    };
    const applyColumnWidths = (worksheet: any, widths: number[]) => {
      widths.forEach((width, index) => {
        worksheet.getColumn(index + 1).width = width;
      });
    };

    if (isOfficeDayHoursView) {
      const headers = [
        'Employee',
        'Department',
        'Email',
        'Manager',
        'Location',
        'Office Days',
        'Avg Office Window Hrs',
        'Avg Office Activity Hrs',
        'Avg Home/Other Active Hrs',
        'Office Activity Share %',
        'Short Office Windows',
        ...weeks.map((week) => getWeekLabel(week)),
      ];
      styleHeaderRow(ws.addRow(headers));
      sortedOfficeDayHourRows.forEach((rowData) => {
        ws.addRow([
          rowData.label,
          rowData.secondary,
          rowData.email || '',
          rowData.managerName || '',
          rowData.officeLocation,
          rowData.officeDayCount,
          rowData.avgOfficeWindowHours ?? '',
          rowData.avgOfficeDayHours ?? '',
          rowData.avgRemoteDayHours ?? '',
          rowData.officeSharePct,
          rowData.shortOfficeDayCount,
          ...weeks.map((week) => formatOfficeWeekCellExportValue(rowData.weeks[week])),
        ]);
      });
      applyColumnWidths(ws, [24, 28, 28, 24, 24, 14, 18, 20, 22, 18, 16, ...weeks.map(() => 42)]);

      const detailSheet = wb.addWorksheet('Daily Office Detail');
      styleHeaderRow(detailSheet.addRow([
        'Employee',
        'Date',
        'Week',
        'Office Activity Hours',
        'Office Window Hours',
        'Home/Other Active Hours',
        'Total Tracked Hours',
        'Office Activity Share %',
        'Office Window Start',
        'Office Window End',
        'Office IP Matches',
      ]));
      sortedOfficeDayHourRows.forEach((rowData) => {
        rowData.days.forEach((day) => {
          detailSheet.addRow([
            rowData.label,
            day.date,
            day.weekLabel,
            day.officeHours,
            day.officeWindowHours ?? '',
            day.remoteHours,
            day.activeHours,
            getOfficeDaySharePct(day),
            day.officeFirstActivityAt || '',
            day.officeLastActivityAt || '',
            day.officeIpMatches || '',
          ]);
        });
      });
      applyColumnWidths(detailSheet, [24, 14, 18, 14, 20, 16, 18, 14, 22, 22, 28]);

      const buffer = await wb.xlsx.writeBuffer();
      downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `office-day-hours-${startDate}-${endDate}.xlsx`);
      return;
    }

    if (isApprovedRemoteWorkView) {
      styleHeaderRow(ws.addRow(approvalExportData.sheet.headers));
      approvalExportData.sheet.rows.forEach((row) => {
        ws.addRow(row);
      });
      applyColumnWidths(ws, approvalExportData.sheet.columnWidths);

      const buffer = await wb.xlsx.writeBuffer();
      downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `office-attendance-approved-coverage-requests-${startDate}-${endDate}.xlsx`);
      return;
    }

    styleHeaderRow(ws.addRow(attendanceExportData.mainSheet.headers));
    const summaryRow = ws.addRow(attendanceExportData.mainSheet.summaryRow);
    summaryRow.font = { italic: true, size: 10, color: { argb: '6B7280' } };

    attendanceExportData.mainSheet.rows.forEach((rowValues, rowIndex) => {
      const row = ws.addRow(rowValues);
      attendanceExportData.mainSheet.weekFillHexes[rowIndex]?.forEach((hex, weekIndex) => {
        const cell = row.getCell(attendanceExportData.mainSheet.weekColumnStartIndex + weekIndex + 1);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex } };
      });
    });

    if (attendanceExportData.detailSheet) {
      const detailSheet = wb.addWorksheet(attendanceExportData.detailSheet.title);
      styleHeaderRow(detailSheet.addRow(attendanceExportData.detailSheet.headers));
      attendanceExportData.detailSheet.rows.forEach((row) => {
        detailSheet.addRow(row);
      });
      applyColumnWidths(detailSheet, attendanceExportData.detailSheet.columnWidths);
    }

    applyColumnWidths(ws, attendanceExportData.mainSheet.columnWidths);

    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `office-attendance-${startDate}-${endDate}-${viewMode}.xlsx`);
  };

  const resultLabel = isApprovedRemoteWorkView ? 'requests' : isOfficeDayHoursView ? 'employees with office days' : isAggregateView ? aggregatePluralLabel : 'employees';
  const primaryMetricLabel = isApprovedRemoteWorkView
    ? 'Request Records'
    : isOfficeDayHoursView
      ? 'Office Days'
    : isAggregateView
      ? currentView.label
      : 'Employees';
  const averageMetricLabel = isApprovedRemoteWorkView ? 'Employees' : isOfficeDayHoursView ? 'Avg Office Window' : isAggregateView ? 'Avg Office Days/Emp/Week' : 'Avg Office Days/Week';
  const zeroMetricLabel = isApprovedRemoteWorkView ? 'Work Abroad Requests' : isOfficeDayHoursView ? 'Short Office Windows' : isAggregateView ? `Zero-Office ${aggregateLabel}s` : 'Zero Office Days';

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

  const OfficeWindowSortHeader = ({
    label,
    colKey,
    align = 'left',
  }: {
    label: string;
    colKey: OfficeWindowSortKey;
    align?: 'left' | 'center' | 'right';
  }) => {
    const alignClass =
      align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
    const active = officeWindowSortKey === colKey;
    return (
      <th
        className={`cursor-pointer select-none whitespace-nowrap px-3 py-3 ${alignClass} text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900`}
        onClick={() => handleOfficeWindowSort(colKey)}
      >
        {label} {active ? (officeWindowSortDir === 'asc' ? '↑' : '↓') : ''}
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
                  ? 'Bamboo remote-work and work-abroad request records with approval and authorization status.'
                  : isOfficeDayHoursView
                    ? 'One row per employee with per-day office window, office activity, home/other active time, and activity share by week.'
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

          <div className="relative z-30 hidden flex-col gap-3 md:flex md:flex-row md:items-end">
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
            <div className="relative z-40 w-full md:w-52" ref={locRef}>
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
                <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
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
            <div className="relative z-40 w-full md:w-52" ref={deptRef}>
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
            {!isAggregateView && !isApprovedRemoteWorkView && (
              <div className="w-full md:w-56">
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Authorized WFH</label>
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
                  <option value="approved-only">Only Authorized WFH</option>
                </select>
              </div>
            )}
            {hasFilters && (
              <button
                onClick={() => {
                  setSearch('');
                  setSelectedDepts([]);
                  setSelectedLocs((viewMode === 'employees' || viewMode === 'office-day-hours') && locations.includes(DEFAULT_EMPLOYEE_LOCATION) ? [DEFAULT_EMPLOYEE_LOCATION] : []);
                  setWfhFilter('all');
                  setPage(0);
                }}
                className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-50"
              >
                Reset
              </button>
            )}
          </div>

          {isOfficeDayHoursView ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-[11px] font-medium text-gray-500">Office Days</p>
                  <p className="mt-1 text-[22px] font-semibold text-gray-900">{officeDayHoursSummary.officeDayCount}</p>
                  <p className="mt-1 text-[11px] text-gray-400">{officeDayHoursSummary.employeeCount} employee{officeDayHoursSummary.employeeCount === 1 ? '' : 's'}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-[11px] font-medium text-gray-500">Avg Office Window</p>
                  <p className="mt-1 text-[22px] font-semibold text-gray-900">{formatHoursValue(officeDayHoursSummary.avgOfficeWindowHours)}</p>
                  <p className="mt-1 text-[11px] text-gray-400">First to last office activity</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-[11px] font-medium text-gray-500">Avg Office Activity</p>
                  <p className="mt-1 text-[22px] font-semibold text-gray-900">{formatHoursValue(officeDayHoursSummary.avgOfficeHours)}</p>
                  <p className="mt-1 text-[11px] text-gray-400">Avg total active {formatHoursValue(officeDayHoursSummary.avgTotalHours)}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-[11px] font-medium text-gray-500">Home/Other Active / Day</p>
                  <p className="mt-1 text-[22px] font-semibold text-gray-900">{formatHoursValue(officeDayHoursSummary.avgRemoteHours)}</p>
                  <p className="mt-1 text-[11px] text-gray-400">{officeDayHoursSummary.officeSharePct}% office activity share</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-[11px] font-medium text-gray-500">Short Office Windows</p>
                  <p className={`mt-1 text-[22px] font-semibold ${officeDayHoursSummary.shortOfficeDayCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {officeDayHoursSummary.shortOfficeDayCount}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-400">{officeDayHoursSummary.shortOfficeDayRate}% below {shortOfficeDayThreshold}h window</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <label className="block text-[11px] font-medium text-gray-500">Short-Window Threshold</label>
                  <select
                    value={String(shortOfficeDayThreshold)}
                    onChange={(event) => changeShortOfficeDayThreshold(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-700 focus:border-gray-300 focus:outline-none"
                  >
                    {SHORT_OFFICE_DAY_THRESHOLD_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option} hours</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-gray-400">{officeDayHoursSummary.shortOfficeLongWorkdayCount} were {FULL_WORKDAY_ACTIVE_HOURS}h+ total workdays</p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-[13px] font-semibold text-gray-900">Office-Window Spread</h3>
                    <p className="text-[11px] text-gray-400">Distribution of elapsed office windows on days that counted as office days.</p>
                  </div>
                  <p className="text-[11px] text-gray-400">{officeDayHoursSummary.impactedEmployeeCount} employee{officeDayHoursSummary.impactedEmployeeCount === 1 ? '' : 's'} with at least one short office window</p>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-5">
                  {officeDayHoursSummary.buckets.map((bucket) => (
                    <div key={bucket.key} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                      <p className="text-[11px] font-medium text-gray-500">{bucket.label}</p>
                      <p className="mt-1 text-[18px] font-semibold text-gray-900">{bucket.count}</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
                        <div className="h-full rounded-full bg-gray-900" style={{ width: `${bucket.percent}%` }} />
                      </div>
                      <p className="mt-1 text-[10px] text-gray-400">{bucket.percent}%</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white">
                <div className="flex flex-col gap-1 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-[13px] font-semibold text-gray-900">Office Windows</h3>
                    <p className="text-[11px] text-gray-400">Elapsed office window is first-to-last office activity; office activity is summed active time on office IP.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[11px] text-gray-400">{officeWindowRows.length} employees</p>
                    {selectedOfficeWindowRow ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOfficeWindowEmployeeId(null);
                          setPage(0);
                        }}
                        className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                      >
                        Clear selection
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="max-h-[24rem] overflow-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-white/95 [&_th]:backdrop-blur">
                      <tr className="border-b border-gray-100">
                        <OfficeWindowSortHeader label="Employee" colKey="name" />
                        <OfficeWindowSortHeader label="Office Days" colKey="officeDayCount" align="right" />
                        <OfficeWindowSortHeader label="Avg Office Window" colKey="avgOfficeWindowHours" align="right" />
                        <OfficeWindowSortHeader label="Avg Office Activity" colKey="avgOfficeDayHours" align="right" />
                        <OfficeWindowSortHeader label="Home/Other Active" colKey="avgRemoteDayHours" align="right" />
                        <OfficeWindowSortHeader label="Activity Split" colKey="officeSharePct" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {officeWindowRows.map((row) => {
                        const selected = selectedOfficeWindowEmployeeId === row.id;
                        const homeSharePct = Math.max(0, 100 - row.officeSharePct);
                        return (
                          <tr
                            key={row.id}
                            onClick={() => {
                              setSelectedOfficeWindowEmployeeId(selected ? null : row.id);
                              setPage(0);
                            }}
                            className={`cursor-pointer hover:bg-gray-50 ${selected ? 'bg-gray-100' : 'bg-white'}`}
                          >
                            <td className="px-4 py-2.5">
                              <p className="text-[13px] font-medium text-gray-900">{row.label}</p>
                              <p className="text-[11px] text-gray-400">{row.secondary}</p>
                            </td>
                            <td className="px-3 py-2.5 text-right text-[12px] font-semibold text-gray-900">{row.officeDayCount}</td>
                            <td className={`px-3 py-2.5 text-right text-[12px] font-semibold ${row.avgOfficeWindowHours !== null && row.avgOfficeWindowHours < shortOfficeDayThreshold ? 'text-red-600' : 'text-gray-900'}`}>
                              {formatHoursValue(row.avgOfficeWindowHours)}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[12px] text-gray-600">
                              {formatHoursValue(row.avgOfficeDayHours)}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[12px] text-gray-600">{formatHoursValue(row.avgRemoteDayHours)}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-between gap-3 text-[12px]">
                                <span className="font-semibold text-gray-900">{formatPercentValue(row.officeSharePct)} office</span>
                                <span className="text-gray-500">{formatPercentValue(homeSharePct)} home</span>
                              </div>
                              <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-gray-100">
                                <div className="h-full bg-gray-900" style={{ width: `${row.officeSharePct}%` }} />
                                <div className="h-full bg-amber-200" style={{ width: `${homeSharePct}%` }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {officeWindowRows.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-6 text-center text-[12px] text-gray-400">No office-day windows in this range.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
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
          )}

          <div className="flex items-center justify-between text-[12px] text-gray-500">
            <span>{activeRowsCount} {resultLabel} {hasFilters || selectedOfficeWindowRow ? '(filtered)' : ''}</span>
            <span>{isApprovedRemoteWorkView ? 'Combined request tables' : `Page ${page + 1} of ${totalPages}`}</span>
          </div>

          {showScrollRail && !isApprovedRemoteWorkView && !isOfficeDayHoursView ? (
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
                                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Authorization</p>
                                <p className="mt-1 text-[12px] font-semibold text-gray-900">{request.authorizationStatusLabel || 'Approval Missing'}</p>
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
                              <div className="rounded-lg bg-gray-50 px-3 py-2">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Standing WFH</p>
                                <p className="mt-1 text-[12px] font-semibold text-gray-900">{request.remoteWorkdayPolicyAssigned ? 'Yes' : 'No'}</p>
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

          {isOfficeDayHoursView ? (
            <div className="rounded-xl border border-gray-200 bg-white md:hidden">
              {detailOfficeDayHourRows.length === 0 ? (
                <div className="p-12 text-center text-[13px] text-gray-500">No {resultLabel} match filters.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {pageOfficeDayHourRows.map((row) => (
                    <article key={row.id} className="space-y-4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setDetail({ row: row.displayRow })}
                            className="truncate text-left text-[14px] font-semibold text-gray-900 hover:underline"
                          >
                            {row.label}
                          </button>
                          <p className="mt-1 text-[12px] text-gray-500">{row.secondary}</p>
                          <p className="mt-0.5 text-[12px] text-gray-500">{row.officeLocation}</p>
                        </div>
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${row.shortOfficeDayCount > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                          {row.shortOfficeDayCount} short
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Office Days</p>
                          <p className="mt-1 text-[16px] font-semibold text-gray-900">{row.officeDayCount}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Activity Share</p>
                          <p className="mt-1 text-[16px] font-semibold text-gray-900">{row.officeSharePct}%</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Avg Office Window</p>
                          <p className="mt-1 text-[16px] font-semibold text-gray-900">{formatHoursValue(row.avgOfficeWindowHours)}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Avg Office Activity</p>
                          <p className="mt-1 text-[16px] font-semibold text-gray-900">{formatHoursValue(row.avgOfficeDayHours)}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Avg Home/Other Active</p>
                          <p className="mt-1 text-[16px] font-semibold text-gray-900">{formatHoursValue(row.avgRemoteDayHours)}</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {weeks.map((week) => {
                          const cell = row.weeks[week] ?? createOfficeDayHoursWeekCell(week);
                          const tone = getOfficeWeekCellTone(cell, shortOfficeDayThreshold);
                          return (
                            <div key={week} className={`rounded-lg border px-3 py-2 ${tone}`}>
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-[11px] font-medium text-gray-700">{getWeekLabel(week)}</p>
                                <p className="text-[10px] font-medium text-gray-500">
                                  {cell.officeDayCount > 0
                                    ? `${cell.officeDayCount} office day${cell.officeDayCount === 1 ? '' : 's'}`
                                    : 'No office days'}
                                </p>
                              </div>
                              {cell.officeDayCount > 0 ? (
                                <div className="mt-2 space-y-1.5">
                                  {cell.days.map((day) => {
                                    const dayOfficeSharePct = getOfficeDaySharePct(day);
                                    return (
                                      <div key={day.date} className="rounded-md bg-white/70 px-2 py-1.5">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-[11px] font-medium text-gray-700">{formatCompactDayLabel(day.date)}</span>
                                          <span className={`text-[11px] font-semibold tabular-nums ${day.isShort ? 'text-red-600' : 'text-gray-900'}`}>
                                            {formatHoursValue(day.officeWindowHours)} window
                                          </span>
                                        </div>
                                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-200">
                                          <div className="h-full rounded-full bg-green-600" style={{ width: `${dayOfficeSharePct}%` }} />
                                        </div>
                                        <div className="mt-1 flex items-center justify-between text-[9px] text-gray-400">
                                          <span>activity {formatHoursValue(day.officeHours)} / {dayOfficeSharePct}%</span>
                                          <span>home {formatHoursValue(day.remoteHours)}</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {!isApprovedRemoteWorkView && !isOfficeDayHoursView ? (
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
                                      <p className="mt-1 font-medium text-gray-700">{getAdjustedTargetDisplay(cell)}</p>
                                    </div>
                                  </div>
                                  <div>
                                    <p className="uppercase tracking-wider text-gray-400">Policy</p>
                                    <p className="mt-1 leading-5 text-gray-600">{getWeekPolicyLabel(cell)}</p>
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
                            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Authorization</th>
                            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Manager Approval</th>
                            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Standing WFH</th>
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
                              <td className="whitespace-nowrap px-3 py-3 text-[12px] font-medium text-gray-900">{request.authorizationStatusLabel || 'Approval Missing'}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{request.managerApprovalReceived || '—'}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-[12px] text-gray-600">{request.remoteWorkdayPolicyAssigned ? 'Yes' : 'No'}</td>
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

          {isOfficeDayHoursView ? (
            <div className="hidden rounded-xl border border-gray-200 bg-white md:block">
              <div className="max-h-[70vh] overflow-auto">
                <table className="min-w-[1280px] border-collapse">
                  <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-white/95 [&_th]:backdrop-blur">
                    <tr className="border-b border-gray-100">
                      <th
                        className="sticky left-0 z-10 cursor-pointer select-none whitespace-nowrap bg-white px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900"
                        onClick={() => handleSort('name')}
                      >
                        Employee {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <SortHeader label="Dept" colKey="department" />
                      <SortHeader label="Office Days" colKey="total" align="right" />
                      <SortHeader label="Avg Window" colKey="avgOfficeWindowHours" align="right" />
                      <SortHeader label="Avg Activity" colKey="avgOfficeDayHours" align="right" />
                      <SortHeader label="Activity Share" colKey="officeSharePct" align="right" />
                      {weeks.map((week) => (
                        <th key={week} className="min-w-52 whitespace-nowrap px-3 py-3 text-center text-[10px] font-medium uppercase tracking-wider text-gray-500">
                          {getWeekLabel(week)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pageOfficeDayHourRows.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="sticky left-0 z-10 bg-white px-4 py-2">
                          <button
                            type="button"
                            onClick={() => setDetail({ row: row.displayRow })}
                            className="whitespace-nowrap text-[13px] font-medium text-gray-900 hover:underline"
                          >
                            {row.label}
                          </button>
                          <div className="mt-0.5 text-[11px] text-gray-400">{row.email}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-[12px] text-gray-600">{row.secondary}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-[12px] font-semibold text-gray-900">{row.officeDayCount}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-[12px] font-semibold text-gray-900">{formatHoursValue(row.avgOfficeWindowHours)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-[12px] font-semibold text-gray-900">{formatHoursValue(row.avgOfficeDayHours)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-[12px] font-semibold text-gray-900">{formatPercentValue(row.officeSharePct)}</td>
                        {weeks.map((week) => {
                          const cell = row.weeks[week] ?? createOfficeDayHoursWeekCell(week);
                          const tone = getOfficeWeekCellTone(cell, shortOfficeDayThreshold);
                          return (
                            <td key={week} className="min-w-52 px-2 py-2 align-top">
                              <div className={`min-h-20 rounded-lg border px-2 py-2 ${tone}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-semibold">{cell.officeDayCount} day{cell.officeDayCount === 1 ? '' : 's'}</span>
                                  <span className="text-[10px] font-medium">{formatHoursValue(cell.avgOfficeWindowHours)} window avg</span>
                                </div>
                                {cell.days.length > 0 ? (
                                  <div className="mt-2 space-y-1.5">
                                    {cell.days.map((day) => {
                                      const officeShare = getOfficeDaySharePct(day);
                                      const homeShare = Math.max(0, 100 - officeShare);
                                      return (
                                        <div key={day.date} className="rounded-md bg-white/75 px-2 py-1.5 shadow-sm">
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-[10px] font-medium text-gray-600">{formatCompactDayLabel(day.date)}</span>
                                            <span className={`text-[10px] font-semibold tabular-nums ${day.isShort ? 'text-red-600' : 'text-gray-900'}`}>
                                              {formatHoursValue(day.officeWindowHours)} window
                                            </span>
                                          </div>
                                          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-gray-200">
                                            <div className="h-full bg-green-600" style={{ width: `${officeShare}%` }} />
                                            <div className="h-full bg-amber-200" style={{ width: `${homeShare}%` }} />
                                          </div>
                                          <div className="mt-1 flex items-center justify-between text-[9px] text-gray-400">
                                            <span>activity {formatHoursValue(day.officeHours)} / {officeShare}%</span>
                                            <span>{formatActivityTime(day.officeFirstActivityAt)}-{formatActivityTime(day.officeLastActivityAt)}</span>
                                          </div>
                                          <div className="mt-0.5 text-[9px] text-gray-400">home/other active {formatHoursValue(day.remoteHours)}</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="mt-3 text-center text-[11px] text-gray-400">No office days</div>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sortedOfficeDayHourRows.length === 0 ? (
                  <div className="p-12 text-center text-[13px] text-gray-500">No {resultLabel} match filters.</div>
                ) : null}
              </div>
            </div>
          ) : null}

          {!isApprovedRemoteWorkView && !isOfficeDayHoursView ? (
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
                                        <div className="flex justify-between gap-3"><span>Adjusted target</span><span className="font-medium text-gray-900">{getAdjustedTargetDisplay(cell)}</span></div>
                                        <div className="flex justify-between gap-3"><span>Coverage source</span><span className="font-medium text-gray-900">{getCoverageSummaryLabel(cell)}</span></div>
                                        <div className="flex justify-between gap-3"><span>Approved weekdays</span><span className="font-medium text-gray-900">{cell?.approvedCoverageWeekdays ?? 0}</span></div>
                                      </div>
                                      <div>
                                        <p className="uppercase tracking-wider text-gray-400">Policy</p>
                                        <p className="mt-1">{getWeekPolicyLabel(cell)}</p>
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
      {!isApprovedRemoteWorkView && !isOfficeDayHoursView ? (
        <div className="flex flex-wrap gap-4 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.compliant}`} /> Compliant under adjusted policy</span>
          <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.partial}`} /> Below adjusted target</span>
          <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.absent}`} /> No office days</span>
          <span className="flex items-center gap-1.5"><span className={`inline-block h-4 w-4 rounded ${CELL_COLORS.pto}`} /> Includes PTO this week</span>
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
                  <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Authorized WFH</label>
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
                    <option value="approved-only">Only Authorized WFH</option>
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
                    setSelectedLocs((viewMode === 'employees' || viewMode === 'office-day-hours') && locations.includes(DEFAULT_EMPLOYEE_LOCATION) ? [DEFAULT_EMPLOYEE_LOCATION] : []);
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
                              {getWeekPolicyLabel(weekSummary) !== 'Standard Policy' ? ` • ${getWeekPolicyLabel(weekSummary)}` : ''}
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

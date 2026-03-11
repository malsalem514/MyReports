'use client';

import { Fragment, type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  WorkingHoursDayRow,
  WorkingHoursEmployeeWeekRow,
  WorkingHoursTbsLineEntry,
  WorkingHoursWeekGroup,
} from '@/lib/dashboard-data';

interface Props {
  weeks: WorkingHoursWeekGroup[];
  groups: string[];
  employeeNumbers: number[];
  users: string[];
  weekOptions: string[];
  startDate: string;
  endDate: string;
  lastSyncedAt: string | null;
}

type ExpandedWeeks = Record<string, boolean>;

type ExceptionKind =
  | 'within-band'
  | 'unmapped'
  | 'missing-tbs'
  | 'missing-activity'
  | 'absence-activity'
  | 'over'
  | 'under';

type EmployeeWithMeta = WorkingHoursEmployeeWeekRow & {
  exception: ExceptionKind;
  exceptionLabel: string;
};

type WeekWithMeta = Omit<WorkingHoursWeekGroup, 'employees'> & {
  employees: EmployeeWithMeta[];
};

interface DetailState {
  week: string;
  employee: EmployeeWithMeta;
}

const TOOLTIP_TEXT: Record<string, string> = {
  tbsReportedHours: 'TBS work hours reported for the week or day, excluding absence-coded entries.',
  tbsAbsenceHours: 'TBS hours logged against absence-related codes such as vacation or illness.',
  activeHours: 'Total ActivTrak tracked hours for the same period.',
  variance: 'Percentage difference between ActivTrak tracked hours and TBS reported work hours.',
  productiveActiveHours: 'ActivTrak productive active time.',
  productivePassiveHours: 'ActivTrak productive passive time.',
  undefinedActiveHours: 'ActivTrak undefined active time.',
  undefinedPassiveHours: 'ActivTrak undefined passive time.',
  unproductiveActiveHours: 'ActivTrak unproductive active time.',
};

function formatHours(value: number): string {
  return value.toFixed(2);
}

function formatPct(value: number | null): string {
  if (value === null) return '';
  return `${value.toFixed(2)}%`;
}

function formatValue(value: string | null | undefined): string {
  if (!value) return '—';
  return value;
}

function formatLeaveAmount(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function formatApprovedLeave(day: WorkingHoursDayRow): string {
  if (day.approvedLeave.length === 0) return '—';

  return day.approvedLeave
    .map((leave) => {
      const parts = [leave.type || 'Leave'];
      if (leave.amount > 0) {
        parts.push(`${formatLeaveAmount(leave.amount)}${leave.unit ? ` ${leave.unit}` : ''}`);
      }
      if (leave.status) {
        parts.push(leave.status);
      }
      return parts.join(' • ');
    })
    .join(' | ');
}

function formatActivityTime(value: string | null): string {
  if (!value) return '—';

  const normalized = value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseActivityTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime();
}

function formatSelectionScope(selectedCount: number, totalCount: number): string {
  if (selectedCount === 0) return `Whole week • ${totalCount} day${totalCount === 1 ? '' : 's'}`;
  return `${selectedCount} selected day${selectedCount === 1 ? '' : 's'}`;
}

function formatMixedValue(values: string[]): string {
  if (values.length === 0) return '—';
  if (values.length === 1) return values[0]!;
  if (values.length === 2) return values.join(' / ');
  return 'Multiple';
}

function normalizeText(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function formatTbsEntryLabel(entry: WorkingHoursTbsLineEntry): string {
  return normalizeText(entry.workDescription) || normalizeText(entry.workCode) || 'Line Entry';
}

function formatEntryType(value: string | null): string {
  const normalized = normalizeText(value);
  if (!normalized) return '—';
  if (normalized === 'C') return 'Code';
  if (normalized === 'P') return 'Project';
  return normalized;
}

function formatLastSynced(value: string | null): string {
  if (!value) return 'Sync timestamp unavailable';
  const parsed = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return `Oracle sync ${value}`;
  return `Oracle sync ${parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function formatTbsLinesSummary(day: WorkingHoursDayRow): string {
  if (day.tbsLineEntries.length === 0) return '';

  return day.tbsLineEntries
    .map((entry) => {
      const parts = [
        formatTbsEntryLabel(entry),
        normalizeText(entry.remark),
        normalizeText(entry.defectCase) ? `CRF ${normalizeText(entry.defectCase)}` : null,
        `${formatHours(entry.hours)}h`,
      ].filter(Boolean);
      return parts.join(' • ');
    })
    .join(' | ');
}

function workedVsColor(value: number | null): string {
  if (value === null) return 'text-gray-400';
  if (value >= 10) return 'text-emerald-700';
  if (value <= -10) return 'text-rose-700';
  return 'text-amber-700';
}

function getVarianceCellStyle(value: number | null): {
  className: string;
  style?: CSSProperties;
} {
  if (value === null) {
    return { className: 'text-gray-400 bg-transparent' };
  }

  const clamped = Math.max(-100, Math.min(100, value));
  const normalized = (clamped + 100) / 200;
  const hue = normalized * 120;

  return {
    className: `rounded-md ${workedVsColor(value)}`,
    style: {
      backgroundColor: `hsl(${hue} 72% 88%)`,
    },
  };
}

function getAbsenceCellStyle(value: number): {
  className: string;
} {
  if (value <= 0) {
    return { className: 'text-gray-700 bg-transparent' };
  }

  return {
    className: 'rounded-md bg-sky-100 text-sky-800',
  };
}

function getReportedCellStyle(value: number): {
  className: string;
} {
  if (value <= 0) {
    return { className: 'text-gray-700 bg-transparent' };
  }

  return {
    className: 'rounded-md bg-emerald-100 text-emerald-800',
  };
}

function getApprovedLeaveCellStyle(value: string): {
  className: string;
} {
  if (!value || value === '—') {
    return { className: 'text-gray-700 bg-transparent' };
  }

  return {
    className: 'rounded-md bg-violet-100 text-violet-800',
  };
}

function formatWeekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function toDateParam(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);
  return {
    startDate: toDateParam(startDate),
    endDate: toDateParam(endDate),
  };
}

function getRangePresetKey(
  startDate: string,
  endDate: string,
): 'thisweek' | 'week' | '30days' | null {
  const today = new Date();
  const expectedEnd = toDateParam(today);
  if (endDate !== expectedEnd) return null;

  const last7 = new Date(today);
  last7.setDate(today.getDate() - 7);
  if (startDate === toDateParam(last7)) {
    return 'week';
  }

  const last30 = new Date(today);
  last30.setDate(today.getDate() - 30);
  if (startDate === toDateParam(last30)) {
    return '30days';
  }

  const weekRange = getWeekRange();
  if (startDate === weekRange.startDate && endDate === weekRange.endDate) {
    return 'thisweek';
  }

  return null;
}

function getException(employee: WorkingHoursEmployeeWeekRow): {
  kind: ExceptionKind;
  label: string;
} {
  if (!employee.tbsEmployeeNo) return { kind: 'unmapped', label: 'Unmapped' };
  if (employee.tbsAbsenceHours > 0 && employee.activeHours >= 4) {
    return { kind: 'absence-activity', label: 'Absence + Activity' };
  }
  if (employee.tbsReportedHours === 0 && employee.activeHours >= 4) {
    return { kind: 'missing-tbs', label: 'Activity Without TBS' };
  }
  if (employee.tbsReportedHours >= 4 && employee.activeHours < 1) {
    return { kind: 'missing-activity', label: 'TBS Without Activity' };
  }
  if ((employee.workedVsReportedPct ?? 0) >= 10) {
    return { kind: 'over', label: 'Over Reported' };
  }
  if ((employee.workedVsReportedPct ?? 0) <= -10) {
    return { kind: 'under', label: 'Under Reported' };
  }
  return { kind: 'within-band', label: 'Within Band' };
}

function badgeClasses(kind: ExceptionKind): string {
  switch (kind) {
    case 'unmapped':
      return 'bg-slate-100 text-slate-700';
    case 'missing-tbs':
      return 'bg-blue-100 text-blue-700';
    case 'missing-activity':
      return 'bg-violet-100 text-violet-700';
    case 'absence-activity':
      return 'bg-amber-100 text-amber-800';
    case 'over':
      return 'bg-emerald-100 text-emerald-700';
    case 'under':
      return 'bg-rose-100 text-rose-700';
    case 'within-band':
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function metricHelp(label: string, title: string) {
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span>{label}</span>
      <span className="text-[10px] text-gray-300">?</span>
    </span>
  );
}

export function WorkingHoursClient({
  weeks,
  groups,
  employeeNumbers,
  users,
  weekOptions,
  startDate,
  endDate,
  lastSyncedAt,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [selectedEmployeeNo, setSelectedEmployeeNo] = useState('all');
  const [selectedUser, setSelectedUser] = useState('all');
  const [selectedWeek, setSelectedWeek] = useState('all');
  const [includeNonActivTrak, setIncludeNonActivTrak] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedWeeks, setExpandedWeeks] = useState<ExpandedWeeks>({});
  const [detail, setDetail] = useState<DetailState | null>(null);
  const detailHistoryPushed = useRef(false);
  const currentRangeKey = getRangePresetKey(startDate, endDate);
  const appliedRangeLabel =
    currentRangeKey === 'thisweek'
      ? 'Quick range (This Week)'
      : currentRangeKey === 'week'
        ? 'Quick range (Last 7 Days)'
        : currentRangeKey === '30days'
          ? 'Quick range (30 Days)'
          : 'Custom dates';

  const handleDateChange = (newStart: string, newEnd: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('startDate', newStart);
    params.set('endDate', newEnd);
    router.push(`/dashboard/working-hours?${params.toString()}`);
  };

  const handlePreset = (preset: 'week' | '30days' | 'thisweek') => {
    const end = new Date();
    const start = new Date();
    switch (preset) {
      case 'thisweek': {
        const range = getWeekRange();
        handleDateChange(range.startDate, range.endDate);
        return;
      }
      case 'week':
        start.setDate(end.getDate() - 7);
        break;
      case '30days':
        start.setDate(end.getDate() - 30);
        break;
    }
    handleDateChange(toDateParam(start), toDateParam(end));
  };

  const filteredWeeks = useMemo<WeekWithMeta[]>(() => {
    const query = search.trim().toLowerCase();

    return weeks
      .filter((week) => selectedWeek === 'all' || week.weekStart === selectedWeek)
      .map((week) => {
        const employees = week.employees
          .map<EmployeeWithMeta>((employee) => {
            const exception = getException(employee);
            return {
              ...employee,
              exception: exception.kind,
              exceptionLabel: exception.label,
            };
          })
          .filter((employee) => {
            if (selectedGroup !== 'all' && employee.group !== selectedGroup) return false;
            if (selectedUser !== 'all' && employee.name !== selectedUser) return false;
            if (selectedEmployeeNo !== 'all' && String(employee.tbsEmployeeNo ?? '') !== selectedEmployeeNo) return false;
            if (!includeNonActivTrak && !employee.hasActivTrakData) return false;
            if (!query) return true;
            return (
              employee.name.toLowerCase().includes(query) ||
              employee.email.toLowerCase().includes(query) ||
              employee.group.toLowerCase().includes(query) ||
              String(employee.tbsEmployeeNo ?? '').includes(query) ||
              employee.exceptionLabel.toLowerCase().includes(query)
            );
          });

        if (employees.length === 0) return null;

        const totals = employees.reduce((acc, employee) => {
          acc.tbsReportedHours += employee.tbsReportedHours;
          acc.tbsAbsenceHours += employee.tbsAbsenceHours;
          acc.activeHours += employee.activeHours;
          acc.productiveActiveHours += employee.productiveActiveHours;
          acc.productivePassiveHours += employee.productivePassiveHours;
          acc.undefinedActiveHours += employee.undefinedActiveHours;
          acc.undefinedPassiveHours += employee.undefinedPassiveHours;
          acc.unproductiveActiveHours += employee.unproductiveActiveHours;
          return acc;
        }, {
          tbsReportedHours: 0,
          tbsAbsenceHours: 0,
          activeHours: 0,
          productiveActiveHours: 0,
          productivePassiveHours: 0,
          undefinedActiveHours: 0,
          undefinedPassiveHours: 0,
          unproductiveActiveHours: 0,
        });

        return {
          ...week,
          employees,
          ...totals,
          workedVsReportedPct: totals.tbsReportedHours > 0
            ? Math.round((((totals.activeHours - totals.tbsReportedHours) / totals.tbsReportedHours) * 100) * 100) / 100
            : null,
        };
      })
      .filter((week): week is WeekWithMeta => week !== null);
  }, [includeNonActivTrak, weeks, selectedEmployeeNo, selectedGroup, selectedUser, selectedWeek, search]);

  const flatEmployees = useMemo(
    () => filteredWeeks.flatMap((week) => week.employees.map((employee) => ({ week: week.weekStart, employee }))),
    [filteredWeeks],
  );

  const summary = useMemo(() => {
    const exceptions = flatEmployees.filter(({ employee }) => employee.exception !== 'within-band');
    const withinBand = flatEmployees.filter(({ employee }) => employee.exception === 'within-band');
    const unmapped = flatEmployees.filter(({ employee }) => employee.exception === 'unmapped');
    const biggestOver = flatEmployees
      .filter(({ employee }) => (employee.workedVsReportedPct ?? Number.NEGATIVE_INFINITY) >= 10)
      .sort((a, b) => (b.employee.workedVsReportedPct ?? 0) - (a.employee.workedVsReportedPct ?? 0))[0];
    const biggestUnder = flatEmployees
      .filter(({ employee }) => (employee.workedVsReportedPct ?? Number.POSITIVE_INFINITY) <= -10)
      .sort((a, b) => (a.employee.workedVsReportedPct ?? 0) - (b.employee.workedVsReportedPct ?? 0))[0];

    return {
      employeeWeeks: flatEmployees.length,
      exceptions: exceptions.length,
      withinBand: withinBand.length,
      unmapped: unmapped.length,
      biggestOver,
      biggestUnder,
    };
  }, [flatEmployees]);

  const hasFilters =
    search.length > 0 ||
    selectedGroup !== 'all' ||
    selectedEmployeeNo !== 'all' ||
    selectedUser !== 'all' ||
    selectedWeek !== 'all' ||
    includeNonActivTrak;

  const toggleWeek = (weekStart: string) => {
    setExpandedWeeks((current) => ({ ...current, [weekStart]: !current[weekStart] }));
  };

  const clearFilters = () => {
    setSearch('');
    setSelectedGroup('all');
    setSelectedEmployeeNo('all');
    setSelectedUser('all');
    setSelectedWeek('all');
    setIncludeNonActivTrak(false);
  };

  useEffect(() => {
    if (!detail || typeof window === 'undefined') return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (!detailHistoryPushed.current) {
      window.history.pushState(
        { ...(window.history.state ?? {}), workingHoursDetailOpen: true },
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

  const requestCloseDetail = () => {
    setDetail(null);

    if (typeof window !== 'undefined' && detailHistoryPushed.current) {
      detailHistoryPushed.current = false;
      window.history.back();
    }
  };

  const exportCSV = () => {
    const headers = [
      'Week',
      'Record Type',
      'Employee',
      'Employee #',
      'Group',
      'Status',
      'Detail',
      'TBS Reported',
      'TBS Absence',
      'Active Hrs',
      'Variance vs TBS',
      'Productive Active',
      'Productive Passive',
      'Undefined Active',
      'Undefined Passive',
      'Unproductive Active',
      'Approved Leave',
      'TBS Line Count',
      'First Activity',
      'Last Activity',
      'Focus Time',
      'Collaboration',
      'Break Time',
      'Productivity',
      'Location',
      'Utilization',
      'TBS Line Details',
    ];

    const lines: string[][] = [headers];

    for (const week of filteredWeeks) {
      lines.push([
        week.weekStart,
        'Week',
        '',
        '',
        '',
        '',
        formatWeekLabel(week.weekStart),
        formatHours(week.tbsReportedHours),
        formatHours(week.tbsAbsenceHours),
        formatHours(week.activeHours),
        formatPct(week.workedVsReportedPct),
        formatHours(week.productiveActiveHours),
        formatHours(week.productivePassiveHours),
        formatHours(week.undefinedActiveHours),
        formatHours(week.undefinedPassiveHours),
        formatHours(week.unproductiveActiveHours),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);

      for (const employee of week.employees) {
        lines.push([
          employee.weekStart,
          'Employee',
          employee.name,
          employee.tbsEmployeeNo ? String(employee.tbsEmployeeNo) : '',
          employee.group,
          employee.exceptionLabel,
          `${employee.days.length} day${employee.days.length === 1 ? '' : 's'}`,
          formatHours(employee.tbsReportedHours),
          formatHours(employee.tbsAbsenceHours),
          formatHours(employee.activeHours),
          formatPct(employee.workedVsReportedPct),
          formatHours(employee.productiveActiveHours),
          formatHours(employee.productivePassiveHours),
          formatHours(employee.undefinedActiveHours),
          formatHours(employee.undefinedPassiveHours),
          formatHours(employee.unproductiveActiveHours),
          '',
          String(employee.days.reduce((count, day) => count + day.tbsLineEntries.length, 0)),
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ]);

        for (const day of employee.days) {
          lines.push([
            employee.weekStart,
            'Day',
            employee.name,
            employee.tbsEmployeeNo ? String(employee.tbsEmployeeNo) : '',
            employee.group,
            employee.exceptionLabel,
            day.dayLabel,
            formatHours(day.tbsReportedHours),
            formatHours(day.tbsAbsenceHours),
            formatHours(day.activeHours),
            formatPct(day.workedVsReportedPct),
            formatHours(day.productiveActiveHours),
            formatHours(day.productivePassiveHours),
            formatHours(day.undefinedActiveHours),
            formatHours(day.undefinedPassiveHours),
            formatHours(day.unproductiveActiveHours),
            formatApprovedLeave(day),
            String(day.tbsLineEntries.length),
            formatActivityTime(day.firstActivityAt),
            formatActivityTime(day.lastActivityAt),
            formatHours(day.focusHours),
            formatHours(day.collaborationHours),
            formatHours(day.breakHours),
            formatPct(day.productivityScore),
            formatValue(day.location),
            formatValue(day.utilizationLevel),
            formatTbsLinesSummary(day),
          ]);
        }
      }
    }

    const csv = lines.map((line) => line.map((value) => `"${value}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `working-hours-by-week-${startDate}-${endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportXLSX = async () => {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const summarySheet = workbook.addWorksheet('Summary');
    const detailSheet = workbook.addWorksheet('Detail');
    const tbsSheet = workbook.addWorksheet('TBS Entries');
    const leaveSheet = workbook.addWorksheet('Approved Leave');

    summarySheet.addRow(['Working Hours']);
    summarySheet.addRow([`Range: ${startDate} to ${endDate}`]);
    summarySheet.addRow([formatLastSynced(lastSyncedAt)]);
    summarySheet.addRow([]);
    summarySheet.addRow(['Metric', 'Value']);
    summarySheet.addRow(['Employee-weeks', summary.employeeWeeks]);
    summarySheet.addRow(['Exceptions', summary.exceptions]);
    summarySheet.addRow(['Within tolerance', summary.withinBand]);
    summarySheet.addRow(['Unmapped', summary.unmapped]);
    summarySheet.addRow(['Top over variance', summary.biggestOver ? `${summary.biggestOver.employee.name} (${formatPct(summary.biggestOver.employee.workedVsReportedPct)})` : '']);
    summarySheet.addRow(['Top under variance', summary.biggestUnder ? `${summary.biggestUnder.employee.name} (${formatPct(summary.biggestUnder.employee.workedVsReportedPct)})` : '']);
    summarySheet.getRow(5).font = { bold: true };
    summarySheet.columns = [{ width: 24 }, { width: 36 }];

    const headers = [
      'Week',
      'Type',
      'Employee',
      'Employee #',
      'Group',
      'Status',
      'Detail',
      'TBS Reported',
      'TBS Absence',
      'Active Hrs',
      'Variance vs TBS',
      'Productive Active',
      'Productive Passive',
      'Undefined Active',
      'Undefined Passive',
      'Unproductive Active',
      'Approved Leave',
      'TBS Line Count',
      'First Activity',
      'Last Activity',
      'Focus Time',
      'Collaboration',
      'Break Time',
      'Productivity',
      'Location',
      'Utilization',
      'TBS Line Details',
    ];
    detailSheet.addRow(headers);
    detailSheet.getRow(1).font = { bold: true };
    detailSheet.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
    });

    for (const week of filteredWeeks) {
      detailSheet.addRow([
        week.weekStart,
        'Week',
        '',
        '',
        '',
        '',
        formatWeekLabel(week.weekStart),
        week.tbsReportedHours,
        week.tbsAbsenceHours,
        week.activeHours,
        week.workedVsReportedPct ?? '',
        week.productiveActiveHours,
        week.productivePassiveHours,
        week.undefinedActiveHours,
        week.undefinedPassiveHours,
        week.unproductiveActiveHours,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);

      for (const employee of week.employees) {
        detailSheet.addRow([
          employee.weekStart,
          'Employee',
          employee.name,
          employee.tbsEmployeeNo ?? '',
          employee.group,
          employee.exceptionLabel,
          `${employee.days.length} day${employee.days.length === 1 ? '' : 's'}`,
          employee.tbsReportedHours,
          employee.tbsAbsenceHours,
          employee.activeHours,
          employee.workedVsReportedPct ?? '',
          employee.productiveActiveHours,
          employee.productivePassiveHours,
          employee.undefinedActiveHours,
          employee.undefinedPassiveHours,
          employee.unproductiveActiveHours,
          '',
          employee.days.reduce((count, day) => count + day.tbsLineEntries.length, 0),
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ]);

        for (const day of employee.days) {
          detailSheet.addRow([
            employee.weekStart,
            'Day',
            employee.name,
            employee.tbsEmployeeNo ?? '',
            employee.group,
            employee.exceptionLabel,
            day.dayLabel,
            day.tbsReportedHours,
            day.tbsAbsenceHours,
            day.activeHours,
            day.workedVsReportedPct ?? '',
            day.productiveActiveHours,
            day.productivePassiveHours,
            day.undefinedActiveHours,
            day.undefinedPassiveHours,
            day.unproductiveActiveHours,
            formatApprovedLeave(day),
            day.tbsLineEntries.length,
            formatActivityTime(day.firstActivityAt),
            formatActivityTime(day.lastActivityAt),
            day.focusHours,
            day.collaborationHours,
            day.breakHours,
            day.productivityScore ?? '',
            formatValue(day.location),
            formatValue(day.utilizationLevel),
            formatTbsLinesSummary(day),
          ]);
        }
      }
    }

    detailSheet.columns = headers.map((header, index) => ({
      width: index < 7 ? 22 : index >= 16 ? 24 : 16,
    }));

    const tbsHeaders = ['Week', 'Employee', 'Employee #', 'Day', 'Entry', 'Code', 'Line Description', 'CRF', 'Type', 'Hours'];
    tbsSheet.addRow(tbsHeaders);
    tbsSheet.getRow(1).font = { bold: true };
    for (const week of filteredWeeks) {
      for (const employee of week.employees) {
        for (const day of employee.days) {
          for (const entry of day.tbsLineEntries) {
            tbsSheet.addRow([
              employee.weekStart,
              employee.name,
              employee.tbsEmployeeNo ?? '',
              day.dayLabel,
              formatTbsEntryLabel(entry),
              normalizeText(entry.workCode) || '',
              normalizeText(entry.remark) || '',
              normalizeText(entry.defectCase) || '',
              entry.isAbsence ? 'Absence' : formatEntryType(entry.entryType),
              entry.hours,
            ]);
          }
        }
      }
    }
    tbsSheet.columns = tbsHeaders.map((header, index) => ({
      width: index === 6 ? 56 : index === 4 ? 28 : 18,
    }));

    const leaveHeaders = ['Week', 'Employee', 'Employee #', 'Day', 'Leave Type', 'Amount', 'Status'];
    leaveSheet.addRow(leaveHeaders);
    leaveSheet.getRow(1).font = { bold: true };
    for (const week of filteredWeeks) {
      for (const employee of week.employees) {
        for (const day of employee.days) {
          for (const leave of day.approvedLeave) {
            leaveSheet.addRow([
              employee.weekStart,
              employee.name,
              employee.tbsEmployeeNo ?? '',
              day.dayLabel,
              leave.type || 'Leave',
              leave.amount > 0 ? `${formatLeaveAmount(leave.amount)}${leave.unit ? ` ${leave.unit}` : ''}` : '',
              leave.status || '',
            ]);
          }
        }
      }
    }
    leaveSheet.columns = leaveHeaders.map((header, index) => ({
      width: index === 4 ? 28 : 18,
    }));

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `working-hours-by-week-${startDate}-${endDate}.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-gray-900">Working Hours</h2>
          <p className="mt-1 text-[12px] text-gray-500">
            Weekly TBS vs ActivTrak comparison for {startDate} to {endDate}
          </p>
          <p className="mt-1 text-[11px] text-gray-400">Applied: {appliedRangeLabel}</p>
          <p className="mt-1 text-[11px] text-gray-400">{formatLastSynced(lastSyncedAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
          >
            CSV
          </button>
          <button
            onClick={exportXLSX}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
          >
            XLSX
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid grid-cols-3 rounded-md border border-gray-200 bg-white shadow-sm">
          {([
            { label: 'This Week', preset: 'thisweek' as const },
            { label: 'Last 7 Days', preset: 'week' as const },
            { label: '30 Days', preset: '30days' as const },
          ]).map(({ label, preset }) => (
            <button
              key={label}
              type="button"
              onClick={() => handlePreset(preset)}
              className={`rounded-none border-0 px-2 py-1.5 text-[11px] font-medium shadow-none first:rounded-l-md last:rounded-r-md sm:px-3 sm:text-[12px] ${
                currentRangeKey === preset
                  ? 'bg-slate-800 text-white hover:bg-slate-800 hover:text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-500">Start</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => handleDateChange(e.target.value || startDate, endDate)}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-600 shadow-sm focus:border-gray-300 focus:outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-500">End</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => handleDateChange(startDate, e.target.value || endDate)}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-600 shadow-sm focus:border-gray-300 focus:outline-none"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 lg:grid-cols-7">
        <div className="lg:col-span-2">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Search</label>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Employee, email, group, or #"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] focus:border-gray-300 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Group</label>
          <select
            value={selectedGroup}
            onChange={(event) => setSelectedGroup(event.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] focus:border-gray-300 focus:outline-none"
          >
            <option value="all">All</option>
            {groups.map((group) => (
              <option key={group} value={group}>{group}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Employee #</label>
          <select
            value={selectedEmployeeNo}
            onChange={(event) => setSelectedEmployeeNo(event.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] focus:border-gray-300 focus:outline-none"
          >
            <option value="all">All</option>
            {employeeNumbers.map((employeeNo) => (
              <option key={employeeNo} value={String(employeeNo)}>{employeeNo}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">User</label>
          <select
            value={selectedUser}
            onChange={(event) => setSelectedUser(event.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] focus:border-gray-300 focus:outline-none"
          >
            <option value="all">All</option>
            {users.map((user) => (
              <option key={user} value={user}>{user}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Week</label>
          <select
            value={selectedWeek}
            onChange={(event) => setSelectedWeek(event.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] focus:border-gray-300 focus:outline-none"
          >
            <option value="all">All</option>
            {weekOptions.map((week) => (
              <option key={week} value={week}>{week}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">ActivTrak Coverage</label>
          <select
            value={includeNonActivTrak ? 'include' : 'exclude'}
            onChange={(event) => setIncludeNonActivTrak(event.target.value === 'include')}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] focus:border-gray-300 focus:outline-none"
          >
            <option value="exclude">Exclude Non-ActivTrak</option>
            <option value="include">Include Non-ActivTrak</option>
          </select>
        </div>
      </div>

      {hasFilters && (
        <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-[12px] text-gray-500">
          <span>{flatEmployees.length} employee-week rows match the current view.</span>
          <button
            onClick={clearFilters}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50"
          >
            Clear Filters
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full border-collapse">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-gray-50/95 [&_th]:backdrop-blur">
              <tr className="border-b border-gray-200">
                <th className="sticky left-0 z-30 bg-gray-50/95 px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  Activity Week
                </th>
                <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  {metricHelp('TBS Reported', TOOLTIP_TEXT.tbsReportedHours)}
                </th>
                <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  {metricHelp('TBS Absence', TOOLTIP_TEXT.tbsAbsenceHours)}
                </th>
                <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  {metricHelp('Active Hrs', TOOLTIP_TEXT.activeHours)}
                </th>
                <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  {metricHelp('Variance vs TBS', TOOLTIP_TEXT.variance)}
                </th>
                <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  {metricHelp('Productive Active', TOOLTIP_TEXT.productiveActiveHours)}
                </th>
                <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  {metricHelp('Productive Passive', TOOLTIP_TEXT.productivePassiveHours)}
                </th>
                <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  {metricHelp('Undefined Active', TOOLTIP_TEXT.undefinedActiveHours)}
                </th>
                <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  {metricHelp('Undefined Passive', TOOLTIP_TEXT.undefinedPassiveHours)}
                </th>
                <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  {metricHelp('Unproductive Active', TOOLTIP_TEXT.unproductiveActiveHours)}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredWeeks.map((week) => {
                const weekOpen = expandedWeeks[week.weekStart] ?? true;
                return (
                  <Fragment key={`week-block-${week.weekStart}`}>
                    <WeekRow
                      week={week}
                      open={weekOpen}
                      onToggle={() => toggleWeek(week.weekStart)}
                    />
                    {weekOpen && week.employees.map((employee) => (
                      <EmployeeRow
                        key={`${week.weekStart}|${employee.email}`}
                        employee={employee}
                        onSelect={() => setDetail({ week: week.weekStart, employee })}
                      />
                    ))}
                  </Fragment>
                );
              })}
              {filteredWeeks.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-[13px] text-gray-500">
                    No records match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <DetailPanel
          detail={detail}
          onClose={requestCloseDetail}
        />
      )}
    </div>
  );
}

function WeekRow({
  week,
  open,
  onToggle,
}: {
  week: WeekWithMeta;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="border-b border-gray-200 bg-gray-100/80">
      <td className="sticky left-0 z-10 bg-gray-100/80 px-4 py-2.5 text-[12px] font-semibold text-gray-900">
        <button onClick={onToggle} className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-[10px] text-gray-500">{open ? '▼' : '▶'}</span>
          <span>{formatWeekLabel(week.weekStart)}</span>
        </button>
      </td>
      <MetricCells row={week} />
    </tr>
  );
}

function EmployeeRow({
  employee,
  onSelect,
}: {
  employee: EmployeeWithMeta;
  onSelect: () => void;
}) {
  return (
    <tr className="bg-white hover:bg-gray-50/80">
      <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-[12px] text-gray-900">
        <button onClick={onSelect} className="flex w-full items-center gap-2 pl-5 text-left">
          <span className="text-[10px] text-gray-300">•</span>
          <span
            className="max-w-[320px] truncate whitespace-nowrap font-medium"
            title={`${employee.name}${employee.group !== 'Unknown' ? ` • ${employee.group}` : ''}`}
          >
            {employee.name}
          </span>
          <span className="shrink-0 text-[11px] text-gray-400">
            {employee.tbsEmployeeNo ? `(${employee.tbsEmployeeNo})` : '(unmapped)'}
          </span>
        </button>
      </td>
      <MetricCells row={employee} />
    </tr>
  );
}

function DetailPanel({
  detail,
  onClose,
}: {
  detail: DetailState;
  onClose: () => void;
}) {
  const { employee } = detail;
  const [selectedDates, setSelectedDates] = useState<string[]>([]);

  useEffect(() => {
    setSelectedDates([]);
  }, [employee]);

  const selectedDateSet = useMemo(() => new Set(selectedDates), [selectedDates]);
  const scopedDays = useMemo(
    () => (selectedDates.length === 0
      ? employee.days
      : employee.days.filter((day) => selectedDateSet.has(day.date))),
    [employee.days, selectedDateSet, selectedDates.length],
  );

  const scopeSummary = useMemo(() => {
    const leaveRows: Array<{
      date: string;
      dayLabel: string;
      type: string | null;
      amount: number;
      unit: string | null;
      status: string | null;
    }> = [];
    const tbsRows: Array<{
      date: string;
      dayLabel: string;
      workCode: string | null;
      workDescription: string | null;
      entryType: string | null;
      hours: number;
      isAbsence: boolean;
      remark: string | null;
      defectCase: string | null;
    }> = [];
    const locations = new Set<string>();
    const utilizationLevels = new Set<string>();
    let tbsReportedHours = 0;
    let tbsAbsenceHours = 0;
    let activeHours = 0;
    let activeInputHours = 0;
    let productiveActiveHours = 0;
    let productivePassiveHours = 0;
    let undefinedActiveHours = 0;
    let undefinedPassiveHours = 0;
    let unproductiveActiveHours = 0;
    let focusHours = 0;
    let collaborationHours = 0;
    let breakHours = 0;
    let productivityScoreSum = 0;
    let productivityScoreCount = 0;
    let earliestActivity: number | null = null;
    let latestActivity: number | null = null;

    for (const day of scopedDays) {
      tbsReportedHours += day.tbsReportedHours;
      tbsAbsenceHours += day.tbsAbsenceHours;
      activeHours += day.activeHours;
      activeInputHours += day.activeInputHours;
      productiveActiveHours += day.productiveActiveHours;
      productivePassiveHours += day.productivePassiveHours;
      undefinedActiveHours += day.undefinedActiveHours;
      undefinedPassiveHours += day.undefinedPassiveHours;
      unproductiveActiveHours += day.unproductiveActiveHours;
      focusHours += day.focusHours;
      collaborationHours += day.collaborationHours;
      breakHours += day.breakHours;

      if (day.productivityScore !== null) {
        productivityScoreSum += day.productivityScore;
        productivityScoreCount += 1;
      }
      if (day.location) locations.add(day.location);
      if (day.utilizationLevel) utilizationLevels.add(day.utilizationLevel);

      const firstActivity = parseActivityTimestamp(day.firstActivityAt);
      if (firstActivity !== null && (earliestActivity === null || firstActivity < earliestActivity)) {
        earliestActivity = firstActivity;
      }

      const lastActivity = parseActivityTimestamp(day.lastActivityAt);
      if (lastActivity !== null && (latestActivity === null || lastActivity > latestActivity)) {
        latestActivity = lastActivity;
      }

      for (const leave of day.approvedLeave) {
        leaveRows.push({
          date: day.date,
          dayLabel: day.dayLabel,
          type: leave.type,
          amount: leave.amount,
          unit: leave.unit,
          status: leave.status,
        });
      }

      for (const entry of day.tbsLineEntries) {
        tbsRows.push({
          date: day.date,
          dayLabel: day.dayLabel,
          workCode: entry.workCode,
          workDescription: entry.workDescription,
          entryType: entry.entryType,
          hours: entry.hours,
          isAbsence: entry.isAbsence,
          remark: entry.remark,
          defectCase: entry.defectCase,
        });
      }
    }

    return {
      scopeLabel: formatSelectionScope(selectedDates.length, employee.days.length),
      tbsReportedHours,
      tbsAbsenceHours,
      activeHours,
      activeInputHours,
      productiveActiveHours,
      productivePassiveHours,
      undefinedActiveHours,
      undefinedPassiveHours,
      unproductiveActiveHours,
      focusHours,
      collaborationHours,
      breakHours,
      productivityScore: productivityScoreCount > 0
        ? Math.round((productivityScoreSum / productivityScoreCount) * 100) / 100
        : null,
      firstActivityAt: earliestActivity !== null ? new Date(earliestActivity).toISOString() : null,
      lastActivityAt: latestActivity !== null ? new Date(latestActivity).toISOString() : null,
      location: formatMixedValue([...locations]),
      utilizationLevel: formatMixedValue([...utilizationLevels]),
      leaveRows,
      tbsRows,
      selectedCount: selectedDates.length,
      dayCount: scopedDays.length,
      workedVsReportedPct: tbsReportedHours > 0
        ? Math.round((((activeHours - tbsReportedHours) / tbsReportedHours) * 100) * 100) / 100
        : null,
    };
  }, [employee.days.length, scopedDays, selectedDates.length]);

  const toggleDate = (date: string) => {
    setSelectedDates((current) =>
      current.includes(date)
        ? current.filter((value) => value !== date)
        : [...current, date],
    );
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 px-4 py-6 backdrop-blur-[1px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative z-[71] flex h-[92vh] w-full max-w-[min(96vw,1440px)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{formatWeekLabel(detail.week)}</p>
              <h3 className="mt-1 text-[20px] font-semibold tracking-tight text-gray-900">{employee.name}</h3>
              <p className="mt-1 text-[12px] text-gray-500">
                {employee.group}
                {employee.tbsEmployeeNo ? ` • TBS #${employee.tbsEmployeeNo}` : ' • Unmapped'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6 px-6 py-6">
          <div className="rounded-xl border border-gray-200 bg-slate-50/70 p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-[13px] font-semibold text-gray-900">Selection Totals</h4>
                <p className="text-[11px] text-gray-500">
                  {selectedDates.length === 0
                    ? 'Showing totals for the full week.'
                    : `Showing totals for ${scopeSummary.selectedCount} selected day${scopeSummary.selectedCount === 1 ? '' : 's'}.`}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <DayInfo label="Scope" value={scopeSummary.scopeLabel} />
              <ReportedInfo label="TBS Reported" value={scopeSummary.tbsReportedHours} />
              <AbsenceInfo label="TBS Absence" value={scopeSummary.tbsAbsenceHours} />
              <DayInfo label="Active Hrs" value={formatHours(scopeSummary.activeHours)} />
              <VarianceInfo label="Variance vs TBS" value={scopeSummary.workedVsReportedPct} />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200">
            <div className="border-b border-gray-200 bg-gray-50/80 px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-[13px] font-semibold text-gray-900">Daily Table</h4>
                  <p className="text-[11px] text-gray-500">
                    Select one or more days to filter the sections below. Leave all rows unselected to show week totals.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600">
                    {scopeSummary.scopeLabel}
                  </span>
                  {selectedDates.length > 0 && (
                    <button
                      onClick={() => setSelectedDates([])}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50"
                    >
                      Clear Selection
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="max-h-[28rem] overflow-auto">
            <table className="min-w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-gray-50/95">
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Pick</th>
                  <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Day</th>
                  <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">TBS Reported</th>
                  <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">TBS Absence</th>
                  <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">Active Hrs</th>
                  <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">Variance vs TBS</th>
                  <th className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Approved Leave</th>
                  <th className="px-3 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">TBS Lines</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {employee.days.map((day) => (
                  <DayRow
                    key={`${employee.email}-${day.date}`}
                    day={day}
                    selected={selectedDateSet.has(day.date)}
                    onToggle={() => toggleDate(day.date)}
                  />
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <DetailSection
            title="TBS Entries"
            subtitle="Raw TBS line entries for the selected scope."
          >
            {scopeSummary.tbsRows.length === 0 ? (
              <EmptyState text="No TBS line entries for the current scope." />
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="max-h-[24rem] overflow-auto">
                <table className="min-w-full border-collapse bg-white">
                  <thead className="sticky top-0 z-10 bg-gray-50/95">
                    <tr className="border-b border-gray-200">
                      <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Day</th>
                      <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Entry</th>
                      <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Code</th>
                      <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Line Description</th>
                      <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">CRF</th>
                      <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Type</th>
                      <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {scopeSummary.tbsRows.map((entry, index) => (
                      <tr key={`${entry.date}-${entry.workCode}-${entry.workDescription}-${index}`} className="bg-white">
                        <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-gray-700">{entry.dayLabel}</td>
                        <td className="px-4 py-2.5 text-[12px] text-gray-900">{formatTbsEntryLabel(entry)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-gray-700">{normalizeText(entry.workCode) || '—'}</td>
                        <td className="max-w-[320px] px-4 py-2.5 text-[12px] text-gray-700" title={normalizeText(entry.remark) || ''}>{normalizeText(entry.remark) || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-gray-700">{normalizeText(entry.defectCase) || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-gray-700">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${entry.isAbsence ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
                            {entry.isAbsence ? 'Absence' : formatEntryType(entry.entryType)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-[12px] tabular-nums text-gray-900">{formatHours(entry.hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </DetailSection>

          <DetailSection
            title="ActivTrak"
            subtitle="Activity metrics sourced from ActivTrak and served to the report from Oracle."
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
              <DayInfo label="First Activity" value={formatActivityTime(scopeSummary.firstActivityAt)} />
              <DayInfo label="Last Activity" value={formatActivityTime(scopeSummary.lastActivityAt)} />
              <DayInfo label="Tracked Time" value={formatHours(scopeSummary.activeHours)} />
              <DayInfo label="Active Input" value={formatHours(scopeSummary.activeInputHours)} />
              <DayInfo label="Focus Time" value={formatHours(scopeSummary.focusHours)} />
              <DayInfo label="Collaboration" value={formatHours(scopeSummary.collaborationHours)} />
              <DayInfo label="Break Time" value={formatHours(scopeSummary.breakHours)} />
              <DayInfo label="Productivity" value={formatPct(scopeSummary.productivityScore) || '—'} />
              <DayInfo label="Productive Active" value={formatHours(scopeSummary.productiveActiveHours)} />
              <DayInfo label="Productive Passive" value={formatHours(scopeSummary.productivePassiveHours)} />
              <DayInfo label="Undefined Active" value={formatHours(scopeSummary.undefinedActiveHours)} />
              <DayInfo label="Undefined Passive" value={formatHours(scopeSummary.undefinedPassiveHours)} />
              <DayInfo label="Unproductive Active" value={formatHours(scopeSummary.unproductiveActiveHours)} />
              <DayInfo label="Location" value={scopeSummary.location} />
              <DayInfo label="Utilization" value={scopeSummary.utilizationLevel} />
            </div>
          </DetailSection>

          <DetailSection
            title="BambooHR"
            subtitle="Approved leave records sourced from BambooHR and synced into Oracle once daily."
          >
            {scopeSummary.leaveRows.length === 0 ? (
              <EmptyState text="No approved leave records for the current scope." />
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="max-h-[18rem] overflow-auto">
                <table className="min-w-full border-collapse bg-white">
                  <thead className="sticky top-0 z-10 bg-gray-50/95">
                    <tr className="border-b border-gray-200">
                      <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Day</th>
                      <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Leave Type</th>
                      <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Amount</th>
                      <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {scopeSummary.leaveRows.map((leave) => (
                      <tr key={`${leave.date}-${leave.type}-${leave.amount}-${leave.status}`} className="bg-white">
                        <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-gray-700">{leave.dayLabel}</td>
                        <td className="px-4 py-2.5 text-[12px] text-gray-900">{leave.type || 'Leave'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-gray-700">
                          {leave.amount > 0 ? `${formatLeaveAmount(leave.amount)}${leave.unit ? ` ${leave.unit}` : ''}` : '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-gray-700">{leave.status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </DetailSection>
          </div>
        </div>
      </div>
    </div>
  );
}

function DayRow({
  day,
  selected,
  onToggle,
}: {
  day: WorkingHoursDayRow;
  selected: boolean;
  onToggle: () => void;
}) {
  const approvedLeaveText = formatApprovedLeave(day);
  const reportedStyle = getReportedCellStyle(day.tbsReportedHours);
  const absenceStyle = getAbsenceCellStyle(day.tbsAbsenceHours);
  const approvedLeaveStyle = getApprovedLeaveCellStyle(approvedLeaveText);
  const varianceStyle = getVarianceCellStyle(day.workedVsReportedPct);

  return (
    <tr
      className={selected ? 'bg-sky-50/80' : 'bg-white hover:bg-gray-50/80'}
      onClick={onToggle}
    >
      <td className="px-4 py-2.5 text-[11px] text-gray-700">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? 'border-sky-500 bg-sky-500 text-white' : 'border-gray-300 bg-white text-transparent'}`}
          aria-label={selected ? `Deselect ${day.dayLabel}` : `Select ${day.dayLabel}`}
        >
          ✓
        </button>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-gray-700">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          className="w-full text-left font-medium text-gray-700"
        >
          {day.dayLabel}
        </button>
      </td>
      <td className={`whitespace-nowrap px-3 py-2.5 text-right text-[11px] tabular-nums ${reportedStyle.className}`}>{formatHours(day.tbsReportedHours)}</td>
      <td className={`whitespace-nowrap px-3 py-2.5 text-right text-[11px] tabular-nums ${absenceStyle.className}`}>{formatHours(day.tbsAbsenceHours)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-medium tabular-nums text-gray-900">{formatHours(day.activeHours)}</td>
      <td
        className={`whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-medium tabular-nums ${varianceStyle.className}`}
        style={varianceStyle.style}
      >
        {formatPct(day.workedVsReportedPct)}
      </td>
      <td className={`max-w-[240px] truncate px-3 py-2.5 text-[11px] ${approvedLeaveStyle.className}`} title={approvedLeaveText}>
        {approvedLeaveText}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] tabular-nums text-gray-700">{day.tbsLineEntries.length}</td>
    </tr>
  );
}

function DetailSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
      <div className="mb-4">
        <h4 className="text-[13px] font-semibold text-gray-900">{title}</h4>
        <p className="mt-1 text-[11px] text-gray-500">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-[12px] text-gray-500">
      {text}
    </div>
  );
}

function DayInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 text-[13px] font-medium text-gray-900">{value}</p>
    </div>
  );
}

function ReportedInfo({ label, value }: { label: string; value: number }) {
  const reportedStyle = getReportedCellStyle(value);

  return (
    <div className={`rounded-lg border border-gray-200 px-3 py-2 ${reportedStyle.className}`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 text-[13px] font-medium">{formatHours(value)}</p>
    </div>
  );
}

function AbsenceInfo({ label, value }: { label: string; value: number }) {
  const absenceStyle = getAbsenceCellStyle(value);

  return (
    <div className={`rounded-lg border border-gray-200 px-3 py-2 ${absenceStyle.className}`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 text-[13px] font-medium">{formatHours(value)}</p>
    </div>
  );
}

function VarianceInfo({ label, value }: { label: string; value: number | null }) {
  const varianceStyle = getVarianceCellStyle(value);

  return (
    <div
      className={`rounded-lg border border-gray-200 px-3 py-2 ${varianceStyle.className}`}
      style={varianceStyle.style}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 text-[13px] font-medium">{formatPct(value) || '—'}</p>
    </div>
  );
}

function MetricCells({
  row,
}: {
  row: Pick<
    WorkingHoursWeekGroup | EmployeeWithMeta,
    | 'tbsReportedHours'
    | 'tbsAbsenceHours'
    | 'activeHours'
    | 'workedVsReportedPct'
    | 'productiveActiveHours'
    | 'productivePassiveHours'
    | 'undefinedActiveHours'
    | 'undefinedPassiveHours'
    | 'unproductiveActiveHours'
  >;
}) {
  const reportedStyle = getReportedCellStyle(row.tbsReportedHours);
  const absenceStyle = getAbsenceCellStyle(row.tbsAbsenceHours);
  const varianceStyle = getVarianceCellStyle(row.workedVsReportedPct);

  return (
    <>
      <td className={`whitespace-nowrap px-3 py-2 text-right text-[11px] tabular-nums ${reportedStyle.className}`}>{formatHours(row.tbsReportedHours)}</td>
      <td className={`whitespace-nowrap px-3 py-2 text-right text-[11px] tabular-nums ${absenceStyle.className}`}>{formatHours(row.tbsAbsenceHours)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-[11px] font-medium tabular-nums text-gray-900">{formatHours(row.activeHours)}</td>
      <td
        className={`whitespace-nowrap px-3 py-2 text-right text-[11px] font-medium tabular-nums ${varianceStyle.className}`}
        style={varianceStyle.style}
      >
        {formatPct(row.workedVsReportedPct)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-[11px] tabular-nums text-gray-700">{formatHours(row.productiveActiveHours)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-[11px] tabular-nums text-gray-700">{formatHours(row.productivePassiveHours)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-[11px] tabular-nums text-gray-700">{formatHours(row.undefinedActiveHours)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-[11px] tabular-nums text-gray-700">{formatHours(row.undefinedPassiveHours)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-[11px] tabular-nums text-gray-700">{formatHours(row.unproductiveActiveHours)}</td>
    </>
  );
}

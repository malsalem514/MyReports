import type { DayDetail, WeekCell, WfhExceptionType } from './types/attendance';

export interface AttendanceEmployeeMetaRow {
  EMAIL: string;
  DISPLAY_NAME: string;
  DEPARTMENT: string;
  LOCATION: string;
  MANAGER_NAME: string;
  MANAGER_EMAIL: string | null;
  HAS_ACTIVTRAK_USER: number;
  REMOTE_WORKDAY_POLICY_ASSIGNED: number;
}

export interface AttendanceApprovalIndex {
  standingPolicyEmails: ReadonlySet<string>;
  approvedRemoteRequestEmails: ReadonlySet<string>;
  approvedWorkAbroadRequestEmails: ReadonlySet<string>;
  unapprovedRemoteRequestEmails?: ReadonlySet<string>;
  approvedRemoteWorkTypesByEmail: ReadonlyMap<string, ReadonlySet<string>>;
  approvedWorkAbroadCountriesByEmail: ReadonlyMap<string, ReadonlySet<string>>;
  unapprovedRemoteWorkTypesByEmail?: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface AttendanceEmployeeAccumulator {
  name: string;
  department: string;
  managerName: string;
  managerEmail: string | null;
  officeLocation: string;
  hasActivTrakCoverage: boolean;
  approvedRemoteWorkRequest: boolean;
  hasStandingWfhPolicy: boolean;
  hasApprovedRemoteRequestInRange: boolean;
  hasApprovedWorkAbroadRequestInRange: boolean;
  hasUnapprovedRemoteRequestInRange: boolean;
  hasAnyAuthorizedWfhInRange: boolean;
  hasAnyWfhPolicyInRange: boolean;
  hasAnyApprovedWfhCoverageInRange: boolean;
  remoteWorkStatusLabel: string;
  weeks: Record<string, WeekCell>;
}

export interface AttendanceDayAccumulator {
  date: string;
  dayLabel: string;
  location: string;
  ptoType: string | null;
  tbsReportedHours: number;
  activeHours: number;
  officeDurationSeconds: number;
  officeHours: number;
  officeWindowHours: number | null;
  remoteHours: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  officeFirstActivityAt: string | null;
  officeLastActivityAt: string | null;
  officeIpMatches: Set<string>;
}

interface AttendanceRangeFlags {
  approvedRemoteWorkRequest: boolean;
  hasStandingWfhPolicy: boolean;
  hasApprovedRemoteRequestInRange: boolean;
  hasApprovedWorkAbroadRequestInRange: boolean;
  hasUnapprovedRemoteRequestInRange: boolean;
  hasAnyAuthorizedWfhInRange: boolean;
  hasAnyWfhPolicyInRange: boolean;
  hasAnyApprovedWfhCoverageInRange: boolean;
  remoteWorkStatusLabel: string;
}

export interface WeeklyAttendanceCellInput {
  currentCell?: Partial<WeekCell>;
  officeDaysRequired: number;
  hasActivTrakCoverage: boolean;
  approvedCoverageWeekdays: number;
  hasApprovedRemoteCoverage: boolean;
  hasApprovedWorkAbroadCoverage: boolean;
  exceptionLabel: string | null;
}

export interface ApprovedCoverageDayCounts {
  approvedRemoteWorkWeekdays: number;
  approvedWorkAbroadWeekdays: number;
}

export function calculateApprovedTargetReliefWeekdays({
  approvedWorkAbroadWeekdays,
}: ApprovedCoverageDayCounts): number {
  return Math.max(0, approvedWorkAbroadWeekdays);
}

const APPROVED_APPROVAL_VALUES = new Set([
  '1',
  'APPROVED',
  'APPROVE',
  'AUTHORISED',
  'AUTHORIZED',
  'CONFIRMED',
  'OK',
  'TRUE',
  'Y',
  'YES',
]);

export function isApprovedApprovalValue(value: string | null | undefined): boolean {
  const normalized = (value || '').trim().toUpperCase();
  if (!normalized) return false;
  return APPROVED_APPROVAL_VALUES.has(normalized);
}

function parseIsoDateString(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

function startOfLocalDay(date: Date): Date {
  const next = new Date(date.getTime());
  next.setHours(0, 0, 0, 0);
  return next;
}

function getIsoWeekMonday(date: Date): Date {
  const monday = startOfLocalDay(date);
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  return monday;
}

export function getScoredAttendanceWeeks(params: {
  weeks: string[];
  startDate: Date;
  endDate: Date;
  referenceDate?: Date;
}): string[] {
  const { weeks, startDate, endDate, referenceDate = new Date() } = params;
  const selectedStart = startOfLocalDay(startDate);
  const selectedEnd = startOfLocalDay(endDate);
  const currentWeekStart = getIsoWeekMonday(referenceDate);

  return weeks.filter((week) => {
    const weekStart = parseIsoDateString(week);
    const weekEnd = new Date(weekStart.getTime());
    weekEnd.setDate(weekEnd.getDate() + 4);
    return weekStart >= selectedStart
      && weekEnd <= selectedEnd
      && weekStart < currentWeekStart;
  });
}

function formatApprovalSuffix(values?: ReadonlySet<string>): string {
  if (!values || values.size === 0) return '';
  return ` (${[...values].sort((a, b) => a.localeCompare(b)).join(', ')})`;
}

export function getRemoteWorkStatusLabel(
  email: string,
  approvalIndex: AttendanceApprovalIndex,
): string {
  const hasStandingWfhPolicy = approvalIndex.standingPolicyEmails.has(email);
  const hasApprovedRemoteRequest = approvalIndex.approvedRemoteRequestEmails.has(email);
  const hasApprovedWorkAbroadRequest = approvalIndex.approvedWorkAbroadRequestEmails.has(email);
  const hasUnapprovedRemoteRequest = approvalIndex.unapprovedRemoteRequestEmails?.has(email) ?? false;
  const labels: string[] = [];

  if (hasApprovedRemoteRequest) {
    labels.push(
      `Temporary Remote Work${formatApprovalSuffix(
        approvalIndex.approvedRemoteWorkTypesByEmail.get(email),
      )}`,
    );
  }

  if (hasApprovedWorkAbroadRequest) {
    labels.push(
      `Work Abroad / Another Province${formatApprovalSuffix(
        approvalIndex.approvedWorkAbroadCountriesByEmail.get(email),
      )}`,
    );
  }

  if (hasStandingWfhPolicy && labels.length > 0) {
    return `Standing WFH Policy + ${labels.join(' + ')}`;
  }
  if (hasStandingWfhPolicy) return 'Standing WFH Policy';
  if (labels.length > 0) return labels.join(' + ');
  if (hasUnapprovedRemoteRequest) {
    return `Bamboo Arrangement - Approval Missing${formatApprovalSuffix(
      approvalIndex.unapprovedRemoteWorkTypesByEmail?.get(email),
    )}`;
  }
  return 'Standard Policy';
}

function getAttendanceRangeFlags(
  email: string,
  approvalIndex: AttendanceApprovalIndex,
): AttendanceRangeFlags {
  const approvedRemoteWorkRequest = approvalIndex.approvedRemoteRequestEmails.has(email);
  const hasStandingWfhPolicy = approvalIndex.standingPolicyEmails.has(email);
  const hasApprovedRemoteRequestInRange = approvedRemoteWorkRequest;
  const hasApprovedWorkAbroadRequestInRange = approvalIndex.approvedWorkAbroadRequestEmails.has(email);
  const hasUnapprovedRemoteRequestInRange = approvalIndex.unapprovedRemoteRequestEmails?.has(email) ?? false;
  const hasAnyAuthorizedWfhInRange =
    hasStandingWfhPolicy || hasApprovedRemoteRequestInRange || hasApprovedWorkAbroadRequestInRange;
  const hasAnyWfhPolicyInRange = hasAnyAuthorizedWfhInRange || hasUnapprovedRemoteRequestInRange;
  const hasAnyApprovedWfhCoverageInRange =
    hasApprovedRemoteRequestInRange || hasApprovedWorkAbroadRequestInRange;

  return {
    approvedRemoteWorkRequest,
    hasStandingWfhPolicy,
    hasApprovedRemoteRequestInRange,
    hasApprovedWorkAbroadRequestInRange,
    hasUnapprovedRemoteRequestInRange,
    hasAnyAuthorizedWfhInRange,
    hasAnyWfhPolicyInRange,
    hasAnyApprovedWfhCoverageInRange,
    remoteWorkStatusLabel: getRemoteWorkStatusLabel(email, approvalIndex),
  };
}

export function createAttendanceEmployeeAccumulator(
  email: string,
  employeeMeta: AttendanceEmployeeMetaRow | undefined,
  approvalIndex: AttendanceApprovalIndex,
): AttendanceEmployeeAccumulator {
  const flags = getAttendanceRangeFlags(email, approvalIndex);

  return {
    name: employeeMeta?.DISPLAY_NAME || email,
    department: employeeMeta?.DEPARTMENT || 'Unknown',
    managerName: employeeMeta?.MANAGER_NAME || 'Unassigned',
    managerEmail: employeeMeta?.MANAGER_EMAIL || null,
    officeLocation: employeeMeta?.LOCATION || 'Unknown',
    hasActivTrakCoverage: employeeMeta?.HAS_ACTIVTRAK_USER === 1,
    ...flags,
    weeks: {},
  };
}

export function ensureAttendanceEmployeeAccumulator(
  employeesByEmail: Map<string, AttendanceEmployeeAccumulator>,
  email: string,
  employeeMeta: AttendanceEmployeeMetaRow | undefined,
  approvalIndex: AttendanceApprovalIndex,
): AttendanceEmployeeAccumulator {
  let employee = employeesByEmail.get(email);
  if (!employee) {
    employee = createAttendanceEmployeeAccumulator(email, employeeMeta, approvalIndex);
    employeesByEmail.set(email, employee);
  }
  return employee;
}

export function toWeekDayDetails(days: ReadonlyArray<AttendanceDayAccumulator>): DayDetail[] {
  return days.map((day) => ({
    date: day.date,
    dayLabel: day.dayLabel,
    location: day.location as DayDetail['location'],
    ptoType: day.ptoType,
    tbsReportedHours: day.tbsReportedHours,
    activeHours: day.activeHours,
    officeHours: day.officeHours,
    officeWindowHours: day.officeWindowHours,
    remoteHours: day.remoteHours,
    firstActivityAt: day.firstActivityAt,
    lastActivityAt: day.lastActivityAt,
    officeFirstActivityAt: day.officeFirstActivityAt,
    officeLastActivityAt: day.officeLastActivityAt,
    officeIpMatches: day.officeIpMatches.size > 0 ? [...day.officeIpMatches].sort().join(', ') : null,
  }));
}

export function calculateAttendanceWeekCell({
  currentCell,
  officeDaysRequired,
  hasActivTrakCoverage,
  approvedCoverageWeekdays,
  hasApprovedRemoteCoverage,
  hasApprovedWorkAbroadCoverage,
  exceptionLabel,
}: WeeklyAttendanceCellInput): WeekCell {
  const officeDays = currentCell?.officeDays ?? 0;
  const remoteDays = currentCell?.remoteDays ?? 0;
  const ptoDays = currentCell?.ptoDays ?? 0;
  const days = currentCell?.days ?? [];
  const availableDays = 5 - ptoDays;
  const hasApprovedWfhCoverage = hasActivTrakCoverage && approvedCoverageWeekdays > 0;

  let wfhExceptionType: WfhExceptionType = 'none';
  let adjustedOfficeTarget: number | null = officeDaysRequired;
  let adjustedCompliant: boolean | null = officeDays >= officeDaysRequired;
  let isPtoExcused = false;

  if (!hasActivTrakCoverage) {
    adjustedOfficeTarget = null;
    adjustedCompliant = null;
  } else {
    let targetAfterWfh = officeDaysRequired;

    if (approvedCoverageWeekdays > 0) {
      targetAfterWfh = Math.max(0, officeDaysRequired - approvedCoverageWeekdays);
      wfhExceptionType = targetAfterWfh === 0 ? 'temporary_full' : 'temporary_partial';
    }

    if (targetAfterWfh === 0) {
      adjustedOfficeTarget = 0;
      adjustedCompliant = true;
    } else if (availableDays < targetAfterWfh) {
      adjustedOfficeTarget = null;
      adjustedCompliant = true;
      isPtoExcused = true;
    } else {
      adjustedOfficeTarget = targetAfterWfh;
      adjustedCompliant = officeDays >= targetAfterWfh;
    }
  }

  return {
    officeDays,
    remoteDays,
    ptoDays,
    days,
    rawOfficeTarget: officeDaysRequired,
    adjustedOfficeTarget,
    adjustedCompliant,
    isPtoExcused,
    hasApprovedWfhCoverage,
    hasApprovedRemoteCoverage,
    hasApprovedWorkAbroadCoverage,
    wfhExceptionType,
    approvedCoverageWeekdays,
    exceptionLabel,
  };
}

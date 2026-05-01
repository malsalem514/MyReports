import { CELL_COLORS, CELL_HEX, OFFICE_DAYS_REQUIRED } from './constants.ts';
import type {
  AttendanceRemoteWorkRequest,
  AttendanceRow,
  AttendanceWorkAbroadRequest,
  WeekCell,
} from './types/attendance.ts';

export type SortKey = 'name' | 'department' | 'officeLocation' | 'total' | 'avgPerWeek' | 'trend' | string;
export type SortDir = 'asc' | 'desc';
export type WfhFilterMode = 'all' | 'standard-only' | 'approved-only';
export type EmployeeCellToneKey = keyof typeof CELL_COLORS;

const UNKNOWN_DISPLAY_VALUE = '—';

export interface WeeklyCompliance {
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

export interface GroupRow {
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

export interface DisplayRow {
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

export interface ApprovalRequestRow {
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
  authorizationStatus?: string | null;
  approver: string | null;
  reason: string | null;
  address: string | null;
  schedule: string | null;
  supportingDocumentationSubmitted: string | null;
  alternateInOfficeWorkDate: string | null;
}

export interface FilteredAttendanceSummary {
  totalEmployees: number;
  totalDepartments: number;
  measurableEmployees: number;
  unknownCoverageCount: number;
  avgOfficeDays: number;
  complianceRate: number;
  zeroOfficeDaysCount: number;
  zeroOfficeDepartments: number;
}

export interface ApprovalRequestSummary {
  totalRequests: number;
  uniqueEmployees: number;
  remoteWorkRequests: number;
  workAbroadRequests: number;
}

export function createEmptyWeeklyCompliance(): WeeklyCompliance {
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

export function createEmptyWeekCell(): WeekCell {
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

/** Parse YYYY-MM-DD as local date (avoids UTC timezone shift) */
function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

export function hasWeekPto(cell?: Pick<WeekCell, 'ptoDays'>): boolean {
  return (cell?.ptoDays ?? 0) > 0;
}

export function getEmployeeCellToneKey(cell?: WeekCell): EmployeeCellToneKey {
  if (hasWeekPto(cell)) return 'pto';
  if (cell?.adjustedCompliant) return 'compliant';
  if ((cell?.officeDays ?? 0) >= 1) return 'partial';
  return 'absent';
}

export function getEmployeeCellColor(cell?: WeekCell): string {
  return CELL_COLORS[getEmployeeCellToneKey(cell)];
}

export function getEmployeeCellHex(cell?: WeekCell): string {
  return CELL_HEX[getEmployeeCellToneKey(cell)];
}

export function getWeekCoverageKinds(cell?: Pick<WeekCell, 'hasApprovedRemoteCoverage' | 'hasApprovedWorkAbroadCoverage'>): Array<'remote' | 'abroad'> {
  const kinds: Array<'remote' | 'abroad'> = [];
  if (cell?.hasApprovedRemoteCoverage) kinds.push('remote');
  if (cell?.hasApprovedWorkAbroadCoverage) kinds.push('abroad');
  return kinds;
}

export function formatEmployeeWeekValue(cell: WeekCell | undefined, isKnown: boolean): string {
  if (!isKnown) return UNKNOWN_DISPLAY_VALUE;
  const officeDays = cell?.officeDays ?? 0;
  const kinds = getWeekCoverageKinds(cell);
  const markers = kinds.map((kind) => kind === 'remote' ? '[House]' : '[Plane]').join(' ');
  return markers ? `${officeDays} ${markers}` : String(officeDays);
}

export function formatNameBucket(names: string[]): string {
  return names.length > 0 ? names.join(', ') : UNKNOWN_DISPLAY_VALUE;
}

export function getWeekLabel(week: string): string {
  const start = parseLocalDate(week);
  const end = new Date(start.getTime());
  end.setDate(start.getDate() + 4);
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function getWeekPointCapacity(cell?: WeekCell): number {
  const adjustedOfficeTarget = cell?.adjustedOfficeTarget;
  return adjustedOfficeTarget == null ? 0 : Math.max(0, adjustedOfficeTarget);
}

export function getWeekPoints(cell?: WeekCell): number {
  const officeDays = cell?.officeDays ?? 0;
  return Math.min(officeDays, getWeekPointCapacity(cell));
}

export function calculateScorePct(weeksByKey: Record<string, WeekCell>, scopedWeeks: string[]): number {
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

export function hasEligibleEmployeeWeek(row: Pick<AttendanceRow, 'weeks'>, scopedWeeks: string[]): boolean {
  return scopedWeeks.some((week) => {
    const adjustedOfficeTarget = row.weeks[week]?.adjustedOfficeTarget;
    return adjustedOfficeTarget != null && adjustedOfficeTarget > 0;
  });
}

export function hasEligibleGroupWeek(row: Pick<GroupRow, 'weeklyCompliance'>, scopedWeeks: string[]): boolean {
  return scopedWeeks.some((week) => (row.weeklyCompliance[week]?.eligibleEmployees ?? 0) > 0);
}

export function compareMaybeNumber(a: number | null, b: number | null, dir: number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir * (a - b);
}

export function getDefaultSortDirectionForKey(key: SortKey): SortDir {
  return key === 'name' || key === 'department' || key === 'officeLocation' ? 'asc' : 'desc';
}

export function filterAttendanceRows(params: {
  rows: AttendanceRow[];
  selectedDepartments: string[];
  selectedLocations: string[];
  isAggregateView: boolean;
  isApprovedRemoteWorkView: boolean;
  search: string;
  wfhFilter: WfhFilterMode;
}): AttendanceRow[] {
  const {
    rows,
    selectedDepartments,
    selectedLocations,
    isAggregateView,
    isApprovedRemoteWorkView,
    search,
    wfhFilter,
  } = params;

  let list = rows;

  if (selectedDepartments.length > 0) {
    const deptSet = new Set(selectedDepartments);
    list = list.filter((row) => deptSet.has(row.department));
  }

  if (selectedLocations.length > 0) {
    const locationSet = new Set(selectedLocations);
    list = list.filter((row) => locationSet.has(row.officeLocation));
  }

  if (isApprovedRemoteWorkView) {
    list = list.filter((row) => row.hasAnyApprovedWfhCoverageInRange);
  } else if (!isAggregateView) {
    if (wfhFilter === 'standard-only') {
      list = list.filter((row) => !row.hasAnyApprovedWfhCoverageInRange);
    } else if (wfhFilter === 'approved-only') {
      list = list.filter((row) => row.hasAnyApprovedWfhCoverageInRange);
    }
  }

  if (search) {
    const query = search.toLowerCase();
    list = list.filter((row) =>
      row.name.toLowerCase().includes(query)
      || row.email.toLowerCase().includes(query)
      || row.department.toLowerCase().includes(query)
      || row.managerName.toLowerCase().includes(query)
      || (row.managerEmail || '').toLowerCase().includes(query),
    );
  }

  return list;
}

export function buildGroupedRows(params: {
  filteredRows: AttendanceRow[];
  isManagerView: boolean;
  weeks: string[];
  scoredWeeks: string[];
  defaultEmployeeLocation: string;
}): GroupRow[] {
  const {
    filteredRows,
    isManagerView,
    weeks,
    scoredWeeks,
    defaultEmployeeLocation,
  } = params;

  const grouped = new Map<string, GroupRow>();
  const groupMembersByKey = new Map<string, Set<string>>();
  const normalizeEmail = (email: string | null | undefined) => email?.toLowerCase().trim() || null;

  const addEmployeeToGroup = (group: GroupRow, row: AttendanceRow) => {
    const isQuebecEmployee = row.officeLocation === defaultEmployeeLocation;
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

  for (const row of filteredRows) {
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
      trend: 'flat' as const,
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
    for (const row of filteredRows) {
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
}

export function buildDisplayRows(params: {
  filteredRows: AttendanceRow[];
  groupedRows: GroupRow[];
  isAggregateView: boolean;
  scoredWeeks: string[];
  weeks: string[];
}): DisplayRow[] {
  const { filteredRows, groupedRows, isAggregateView, scoredWeeks, weeks } = params;

  const employeeRows: DisplayRow[] = filteredRows.map((row) => ({
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

  const aggregateRows: DisplayRow[] = groupedRows.map((row) => ({
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
          wfhExceptionType: 'none' as const,
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

  return isAggregateView ? aggregateRows : employeeRows;
}

export function sortDisplayRows(params: {
  rows: DisplayRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  isAggregateView: boolean;
}): DisplayRow[] {
  const { rows, sortKey, sortDir, isAggregateView } = params;
  const direction = sortDir === 'asc' ? 1 : -1;
  const sorted = [...rows];

  sorted.sort((left, right) => {
    if (sortKey === 'name') return direction * left.label.localeCompare(right.label);
    if (sortKey === 'department') {
      if (isAggregateView) return direction * ((Number(left.secondary) || 0) - (Number(right.secondary) || 0));
      return direction * left.secondary.localeCompare(right.secondary);
    }
    if (sortKey === 'quebecEmployeeCount') return direction * ((left.quebecEmployeeCount ?? 0) - (right.quebecEmployeeCount ?? 0));
    if (sortKey === 'remoteEmployeeCount') return direction * ((left.remoteEmployeeCount ?? 0) - (right.remoteEmployeeCount ?? 0));
    if (sortKey === 'officeLocation') return direction * left.officeLocation.localeCompare(right.officeLocation);
    if (sortKey === 'total') {
      return compareMaybeNumber(
        !isAggregateView && !left.hasActivTrakCoverage ? null : left.total,
        !isAggregateView && !right.hasActivTrakCoverage ? null : right.total,
        direction,
      );
    }
    if (sortKey === 'avgPerWeek') {
      return compareMaybeNumber(
        !isAggregateView && !left.hasActivTrakCoverage ? null : left.avgPerWeek,
        !isAggregateView && !right.hasActivTrakCoverage ? null : right.avgPerWeek,
        direction,
      );
    }
    if (sortKey === 'status') {
      return compareMaybeNumber(
        !isAggregateView && !left.hasActivTrakCoverage ? null : left.scorePct,
        !isAggregateView && !right.hasActivTrakCoverage ? null : right.scorePct,
        direction,
      );
    }
    if (sortKey === 'trend') {
      const order = { up: 2, flat: 1, down: 0 };
      if (!isAggregateView) {
        if (!left.hasActivTrakCoverage && !right.hasActivTrakCoverage) return 0;
        if (!left.hasActivTrakCoverage) return 1;
        if (!right.hasActivTrakCoverage) return -1;
      }
      return direction * (order[left.trend] - order[right.trend]);
    }
    return compareMaybeNumber(
      !isAggregateView && !left.hasActivTrakCoverage ? null : (left.weeks[sortKey]?.officeDays ?? 0),
      !isAggregateView && !right.hasActivTrakCoverage ? null : (right.weeks[sortKey]?.officeDays ?? 0),
      direction,
    );
  });

  return sorted;
}

export function buildFilteredAttendanceSummary(params: {
  filteredRows: AttendanceRow[];
  groupedRows: GroupRow[];
  isAggregateView: boolean;
  scoredWeeks: string[];
}): FilteredAttendanceSummary {
  const { filteredRows, groupedRows, isAggregateView, scoredWeeks } = params;
  const totalEmployees = filteredRows.length;
  const numCompletedWeeks = scoredWeeks.length;
  const totalEligibleQuebecEmployees = groupedRows.reduce((sum, row) => sum + row.quebecEmployeeCount, 0);
  const unknownCoverageCount = filteredRows.filter((row) => !row.hasActivTrakCoverage).length;
  const measurableEmployees = filteredRows.filter((row) => row.hasActivTrakCoverage && hasEligibleEmployeeWeek(row, scoredWeeks)).length;
  const measurableGroups = groupedRows.filter((row) => hasEligibleGroupWeek(row, scoredWeeks)).length;
  const coveredEmployees = Math.max(0, totalEmployees - unknownCoverageCount);
  let zeroCount = 0;
  let sumOfficeDays = 0;
  let sumScorePct = 0;

  if (isAggregateView) {
    for (const row of groupedRows) {
      if (row.total === 0) zeroCount += 1;
      if (hasEligibleGroupWeek(row, scoredWeeks)) {
        sumScorePct += row.scorePct;
      }
      for (const week of scoredWeeks) {
        sumOfficeDays += row.weeks[week]?.officeDays ?? 0;
      }
    }
  } else {
    for (const row of filteredRows) {
      if (!row.hasActivTrakCoverage) continue;
      if (row.total === 0) zeroCount += 1;
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
}

function matchesRequestFilters(params: {
  department: string;
  officeLocation: string;
  searchableFields: Array<string | null | undefined>;
  selectedDepartmentSet: Set<string> | null;
  selectedLocationSet: Set<string> | null;
  search: string;
}): boolean {
  const {
    department,
    officeLocation,
    searchableFields,
    selectedDepartmentSet,
    selectedLocationSet,
    search,
  } = params;

  if (selectedDepartmentSet && !selectedDepartmentSet.has(department)) {
    return false;
  }
  if (selectedLocationSet && !selectedLocationSet.has(officeLocation)) {
    return false;
  }
  if (!search) return true;

  const query = search.toLowerCase();
  return searchableFields.some((value) => (value || '').toLowerCase().includes(query));
}

export function filterRemoteWorkRequests(params: {
  requests: AttendanceRemoteWorkRequest[];
  selectedDepartments: string[];
  selectedLocations: string[];
  search: string;
  sortDir: SortDir;
}): AttendanceRemoteWorkRequest[] {
  const { requests, selectedDepartments, selectedLocations, search, sortDir } = params;
  const selectedDepartmentSet = selectedDepartments.length > 0 ? new Set(selectedDepartments) : null;
  const selectedLocationSet = selectedLocations.length > 0 ? new Set(selectedLocations) : null;

  const filtered = requests.filter((request) => matchesRequestFilters({
    department: request.department,
    officeLocation: request.officeLocation,
    searchableFields: [
      request.employeeName,
      request.email,
      request.department,
      request.remoteWorkType,
      request.reason,
      request.managerName,
      request.authorizationStatusLabel,
    ],
    selectedDepartmentSet,
    selectedLocationSet,
    search,
  }));

  filtered.sort((left, right) => {
    if (sortDir === 'asc') {
      return left.remoteWorkStartDate.localeCompare(right.remoteWorkStartDate)
        || left.employeeName.localeCompare(right.employeeName);
    }
    return right.remoteWorkStartDate.localeCompare(left.remoteWorkStartDate)
      || left.employeeName.localeCompare(right.employeeName);
  });

  return filtered;
}

export function filterWorkAbroadRequests(params: {
  requests: AttendanceWorkAbroadRequest[];
  selectedDepartments: string[];
  selectedLocations: string[];
  search: string;
  sortDir: SortDir;
}): AttendanceWorkAbroadRequest[] {
  const { requests, selectedDepartments, selectedLocations, search, sortDir } = params;
  const selectedDepartmentSet = selectedDepartments.length > 0 ? new Set(selectedDepartments) : null;
  const selectedLocationSet = selectedLocations.length > 0 ? new Set(selectedLocations) : null;

  const filtered = requests.filter((request) => matchesRequestFilters({
    department: request.department,
    officeLocation: request.officeLocation,
    searchableFields: [
      request.employeeName,
      request.email,
      request.department,
      request.countryOrProvince,
      request.reason,
      request.approvedDeclinedBy,
      request.remoteWorkLocationAddress,
    ],
    selectedDepartmentSet,
    selectedLocationSet,
    search,
  }));

  filtered.sort((left, right) => {
    if (sortDir === 'asc') {
      return left.workAbroadStartDate.localeCompare(right.workAbroadStartDate)
        || left.employeeName.localeCompare(right.employeeName);
    }
    return right.workAbroadStartDate.localeCompare(left.workAbroadStartDate)
      || left.employeeName.localeCompare(right.employeeName);
  });

  return filtered;
}

export function buildApprovalRequestSummary(
  filteredRemoteWorkRequests: AttendanceRemoteWorkRequest[],
  filteredWorkAbroadRequests: AttendanceWorkAbroadRequest[],
): ApprovalRequestSummary {
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
}

export function buildCombinedApprovalRequests(params: {
  filteredRemoteWorkRequests: AttendanceRemoteWorkRequest[];
  filteredWorkAbroadRequests: AttendanceWorkAbroadRequest[];
  sortDir: SortDir;
}): ApprovalRequestRow[] {
  const { filteredRemoteWorkRequests, filteredWorkAbroadRequests, sortDir } = params;

  return [
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
      authorizationStatus: request.authorizationStatusLabel ?? (request.managerApprovalReceived ? 'Approved Request' : 'Approval Missing'),
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
      authorizationStatus: request.requestApproved,
      approver: request.approvedDeclinedBy,
      reason: request.reason,
      address: request.remoteWorkLocationAddress,
      schedule: request.workSchedule,
      supportingDocumentationSubmitted: null,
      alternateInOfficeWorkDate: null,
    })),
  ].sort((left, right) => {
    if (sortDir === 'asc') {
      return left.startDate.localeCompare(right.startDate) || left.employeeName.localeCompare(right.employeeName);
    }
    return right.startDate.localeCompare(left.startDate) || left.employeeName.localeCompare(right.employeeName);
  });
}

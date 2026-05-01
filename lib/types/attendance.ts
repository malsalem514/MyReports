export interface DayDetail {
  date: string;
  dayLabel: string;
  location: 'Office' | 'Remote' | 'PTO' | 'Unknown';
  ptoType?: string | null;
  tbsReportedHours?: number;
  activeHours?: number;
  officeHours?: number;
  officeWindowHours?: number | null;
  remoteHours?: number;
  firstActivityAt?: string | null;
  lastActivityAt?: string | null;
  officeFirstActivityAt?: string | null;
  officeLastActivityAt?: string | null;
  officeIpMatches?: string | null;
}

export type WfhExceptionType =
  | 'none'
  | 'standing_policy'
  | 'temporary_partial'
  | 'temporary_full';

export interface WeekCell {
  officeDays: number;
  remoteDays: number;
  ptoDays: number;
  days: DayDetail[];
  rawOfficeTarget: number;
  adjustedOfficeTarget: number | null;
  adjustedCompliant: boolean | null;
  isPtoExcused: boolean;
  hasApprovedWfhCoverage: boolean;
  hasApprovedRemoteCoverage: boolean;
  hasApprovedWorkAbroadCoverage: boolean;
  wfhExceptionType: WfhExceptionType;
  approvedCoverageWeekdays: number;
  exceptionLabel: string | null;
}

export interface AttendanceRow {
  email: string;
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
  hasAnyApprovedWfhCoverageInRange: boolean;
  remoteWorkStatusLabel: string;
  weeks: Record<string, WeekCell>;
  total: number;
  avgPerWeek: number;
  compliant: boolean;
  trend: 'up' | 'down' | 'flat';
  exemptWeekCount: number;
}

export interface AttendanceRemoteWorkRequest {
  bambooRowId: number;
  employeeId: string;
  email: string;
  employeeName: string;
  department: string;
  officeLocation: string;
  requestDate: string | null;
  remoteWorkStartDate: string;
  remoteWorkEndDate: string | null;
  remoteWorkType: string | null;
  reason: string | null;
  supportingDocumentationSubmitted: string | null;
  alternateInOfficeWorkDate: string | null;
  managerApprovalReceived: string | null;
  managerName: string | null;
  remoteWorkdayPolicyAssigned?: boolean;
  countsAsAuthorized?: boolean;
  authorizationStatusLabel?: string;
}

export interface AttendanceWorkAbroadRequest {
  bambooRowId: number;
  employeeId: string;
  email: string;
  employeeName: string;
  department: string;
  officeLocation: string;
  requestDate: string | null;
  workAbroadStartDate: string;
  workAbroadEndDate: string | null;
  remoteWorkLocationAddress: string | null;
  countryOrProvince: string | null;
  reason: string | null;
  workSchedule: string | null;
  requestApproved: string | null;
  approvedDeclinedBy: string | null;
}

export interface AttendanceSummary {
  totalEmployees: number;
  avgOfficeDays: number;
  complianceRate: number;
  zeroOfficeDaysCount: number;
  unknownCoverageCount: number;
}

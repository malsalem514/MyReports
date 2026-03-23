export interface DayDetail {
  date: string;
  dayLabel: string;
  location: 'Office' | 'Remote' | 'PTO' | 'Unknown';
  ptoType?: string | null;
  tbsReportedHours?: number;
  activeHours?: number;
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
  managerName: string;
  managerEmail: string | null;
  officeLocation: string;
  hasActivTrakCoverage: boolean;
  approvedRemoteWorkRequest: boolean;
  remoteWorkStatusLabel: string;
  weeks: Record<string, WeekCell>;
  total: number;
  avgPerWeek: number;
  compliant: boolean;
  trend: 'up' | 'down' | 'flat';
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
}

export interface AttendanceSummary {
  totalEmployees: number;
  avgOfficeDays: number;
  complianceRate: number;
  zeroOfficeDaysCount: number;
  unknownCoverageCount: number;
}

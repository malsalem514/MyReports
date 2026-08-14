export type RawDataCellValue = string | number | null;

export type RawDataCategory =
  | 'People & Mapping'
  | 'Attendance Evidence'
  | 'Time & TBS'
  | 'Approvals & Leave'
  | 'Security & Devices'
  | 'Operations';

export type RawDataDatasetKey =
  | 'employee-directory'
  | 'user-mappings'
  | 'tbs-employee-map'
  | 'tbs-employees'
  | 'tbs-time-entries'
  | 'attendance-daily'
  | 'productivity-daily'
  | 'office-ip-activity'
  | 'activtrak-ip-activity'
  | 'bamboo-time-off'
  | 'remote-work-requests'
  | 'work-abroad-requests'
  | 'activtrak-identifiers'
  | 'activtrak-user-stats'
  | 'duo-auth-logs'
  | 'office-ips'
  | 'duo-sync-state'
  | 'sync-log';

export interface RawDataColumn {
  key: string;
  label: string;
}

export interface RawDataDatasetSummary {
  key: RawDataDatasetKey;
  label: string;
  description: string;
  category: RawDataCategory;
  sourceLabel: string;
  audience: string;
  dateFieldLabel: string | null;
  columns: RawDataColumn[];
}

export interface RawDataRow {
  [key: string]: RawDataCellValue;
}

export interface RawDataResult {
  dataset: RawDataDatasetSummary;
  columns: RawDataColumn[];
  rows: RawDataRow[];
  totalRows: number;
  page: number;
  pageSize: number;
  startDate: string;
  endDate: string;
  search: string;
}

import { query } from './oracle';
import { toDateParam } from './report-date-defaults';
import type {
  RawDataCellValue,
  RawDataColumn,
  RawDataDatasetKey,
  RawDataDatasetSummary,
  RawDataResult,
  RawDataRow,
} from './raw-data-types';

export const RAW_DATA_PAGE_SIZE = 50;
export const DEFAULT_RAW_DATA_DATASET_KEY: RawDataDatasetKey = 'attendance-daily';

interface SqlColumn extends RawDataColumn {
  expression: string;
}

interface DatasetDefinition extends Omit<RawDataDatasetSummary, 'columns'> {
  columns: readonly SqlColumn[];
  fromSql: string;
  dateFilterSql?: string;
  searchExpressions: readonly string[];
  defaultOrderSql: string;
}

const dateOnly = (expression: string): string => `TO_CHAR(${expression}, 'YYYY-MM-DD')`;
const dateTime = (expression: string): string => `TO_CHAR(${expression}, 'YYYY-MM-DD HH24:MI:SS')`;
const hours = (expression: string): string => `ROUND(NVL(${expression}, 0) / 3600, 2)`;
const yesNo = (expression: string): string => `CASE WHEN NVL(${expression}, 0) = 1 THEN 'Yes' ELSE 'No' END`;
const dateRangeFilter = (expression: string): string =>
  `${expression} >= TO_DATE(:startDate, 'YYYY-MM-DD') AND ${expression} < TO_DATE(:endDate, 'YYYY-MM-DD') + 1`;
const timestampRangeFilter = (expression: string): string =>
  `${expression} >= TO_TIMESTAMP(:startDate || ' 00:00:00', 'YYYY-MM-DD HH24:MI:SS') AND ${expression} < TO_TIMESTAMP(:endDate || ' 00:00:00', 'YYYY-MM-DD HH24:MI:SS') + INTERVAL '1' DAY`;

export const RAW_DATA_DATASETS: readonly DatasetDefinition[] = [
  {
    key: 'employee-directory',
    label: 'Employee Directory',
    description: 'Current BambooHR employee profile rows used for scope, department, manager, and policy mapping.',
    category: 'People & Mapping',
    sourceLabel: 'TL_EMPLOYEES',
    audience: 'HR / report owners',
    dateFieldLabel: null,
    fromSql: 'TL_EMPLOYEES e',
    columns: [
      { key: 'employeeNumber', label: 'Employee #', expression: 'e.EMPLOYEE_NUMBER' },
      { key: 'employeeId', label: 'Bamboo ID', expression: 'e.ID' },
      { key: 'displayName', label: 'Employee', expression: 'NVL(e.DISPLAY_NAME, TRIM(NVL(e.FIRST_NAME, \'\') || \' \' || NVL(e.LAST_NAME, \'\')))' },
      { key: 'email', label: 'Email', expression: 'LOWER(e.EMAIL)' },
      { key: 'status', label: 'Status', expression: 'e.STATUS' },
      { key: 'department', label: 'Department', expression: 'e.DEPARTMENT' },
      { key: 'division', label: 'Division', expression: 'e.DIVISION' },
      { key: 'location', label: 'Location', expression: 'e.LOCATION' },
      { key: 'jobTitle', label: 'Job title', expression: 'e.JOB_TITLE' },
      { key: 'supervisorName', label: 'Manager', expression: 'e.SUPERVISOR_NAME' },
      { key: 'supervisorEmail', label: 'Manager email', expression: 'LOWER(e.SUPERVISOR_EMAIL)' },
      { key: 'hireDate', label: 'Hire date', expression: dateOnly('e.HIRE_DATE') },
      { key: 'remotePolicy', label: 'Remote policy', expression: yesNo('e.REMOTE_WORKDAY_POLICY_ASSIGNED') },
    ],
    searchExpressions: [
      'LOWER(NVL(TO_CHAR(e.EMPLOYEE_NUMBER), \'\'))',
      'LOWER(NVL(e.ID, \'\'))',
      'LOWER(NVL(e.DISPLAY_NAME, \'\'))',
      'LOWER(NVL(e.EMAIL, \'\'))',
      'LOWER(NVL(e.DEPARTMENT, \'\'))',
      'LOWER(NVL(e.SUPERVISOR_NAME, \'\'))',
    ],
    defaultOrderSql: 'NVL(e.DISPLAY_NAME, e.EMAIL), e.EMAIL',
  },
  {
    key: 'user-mappings',
    label: 'User Mappings',
    description: 'Resolved Bamboo, TBS, and ActivTrak identity mapping used by the audit and comparison reports.',
    category: 'People & Mapping',
    sourceLabel: 'V_USER_MAPPINGS_REPORT',
    audience: 'HR / report owners',
    dateFieldLabel: null,
    fromSql: 'V_USER_MAPPINGS_REPORT m',
    columns: [
      { key: 'employeeId', label: 'Bamboo ID', expression: 'm.EMPLOYEE_ID' },
      { key: 'email', label: 'Email', expression: 'm.EMAIL' },
      { key: 'displayName', label: 'Employee', expression: 'm.DISPLAY_NAME' },
      { key: 'department', label: 'Department', expression: 'm.DEPARTMENT' },
      { key: 'location', label: 'Location', expression: 'm.LOCATION' },
      { key: 'status', label: 'Status', expression: 'm.STATUS' },
      { key: 'tbsEmployeeNo', label: 'TBS #', expression: 'm.TBS_EMPLOYEE_NO' },
      { key: 'tbsEmployeeName', label: 'TBS name', expression: 'm.TBS_EMPLOYEE_NAME' },
      { key: 'activtrakUser', label: 'ActivTrak user', expression: 'm.ACTIVTRAK_USER' },
      { key: 'activtrakId', label: 'ActivTrak ID', expression: 'm.ACTRK_ID' },
      { key: 'hasActivtrakMapping', label: 'Mapped to ActivTrak', expression: yesNo('m.HAS_ACTIVTRAK_MAPPING') },
      { key: 'hasActivtrakUser', label: 'Seen in ActivTrak', expression: yesNo('m.HAS_ACTIVTRAK_USER') },
      { key: 'lastActivtrakActivity', label: 'Last ActivTrak', expression: dateTime('m.LAST_ACTIVTRAK_ACTIVITY') },
      { key: 'lastTbsEntry', label: 'Last TBS entry', expression: dateOnly('m.LAST_TBS_ENTRY') },
    ],
    searchExpressions: [
      'LOWER(NVL(m.EMPLOYEE_ID, \'\'))',
      'LOWER(NVL(m.EMAIL, \'\'))',
      'LOWER(NVL(m.DISPLAY_NAME, \'\'))',
      'LOWER(NVL(m.DEPARTMENT, \'\'))',
      'LOWER(NVL(TO_CHAR(m.TBS_EMPLOYEE_NO), \'\'))',
      'LOWER(NVL(TO_CHAR(m.ACTRK_ID), \'\'))',
      'LOWER(NVL(m.ACTIVTRAK_USER, \'\'))',
    ],
    defaultOrderSql: 'm.DISPLAY_NAME, m.EMAIL',
  },
  {
    key: 'tbs-employee-map',
    label: 'TBS Employee Map',
    description: 'Email-to-TBS employee-number matches, including the match method used by the sync.',
    category: 'People & Mapping',
    sourceLabel: 'TL_TBS_EMPLOYEE_MAP',
    audience: 'HR / report owners',
    dateFieldLabel: null,
    fromSql: `TL_TBS_EMPLOYEE_MAP m
      LEFT JOIN TL_EMPLOYEES e ON LOWER(e.EMAIL) = LOWER(m.EMAIL)
      LEFT JOIN TL_TBS_EMPLOYEES t ON t.EMPLOYEE_NO = m.TBS_EMPLOYEE_NO`,
    columns: [
      { key: 'email', label: 'Email', expression: 'LOWER(m.EMAIL)' },
      { key: 'displayName', label: 'Employee', expression: 'e.DISPLAY_NAME' },
      { key: 'department', label: 'Department', expression: 'e.DEPARTMENT' },
      { key: 'tbsEmployeeNo', label: 'TBS #', expression: 'm.TBS_EMPLOYEE_NO' },
      { key: 'tbsEmployeeName', label: 'TBS name', expression: 'TRIM(NVL(t.EMPLOYEE_FIRST_NAME, \'\') || \' \' || NVL(t.EMPLOYEE_LAST_NAME, \'\'))' },
      { key: 'matchMethod', label: 'Match method', expression: 'm.MATCH_METHOD' },
      { key: 'lastTbsEntry', label: 'Last TBS entry', expression: dateOnly('t.LAST_ENTRY') },
      { key: 'createdAt', label: 'Mapped at', expression: dateTime('m.CREATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(m.EMAIL, \'\'))',
      'LOWER(NVL(e.DISPLAY_NAME, \'\'))',
      'LOWER(NVL(e.DEPARTMENT, \'\'))',
      'LOWER(NVL(TO_CHAR(m.TBS_EMPLOYEE_NO), \'\'))',
      'LOWER(NVL(m.MATCH_METHOD, \'\'))',
      'LOWER(NVL(t.EMPLOYEE_FIRST_NAME, \'\'))',
      'LOWER(NVL(t.EMPLOYEE_LAST_NAME, \'\'))',
    ],
    defaultOrderSql: 'e.DISPLAY_NAME, m.EMAIL',
  },
  {
    key: 'tbs-employees',
    label: 'TBS Employees',
    description: 'Employees mirrored from the TBS source, including each person\'s latest known TBS entry date.',
    category: 'Time & TBS',
    sourceLabel: 'TL_TBS_EMPLOYEES',
    audience: 'Finance / report owners',
    dateFieldLabel: 'Last TBS entry',
    fromSql: 'TL_TBS_EMPLOYEES t',
    dateFilterSql: dateRangeFilter('t.LAST_ENTRY'),
    columns: [
      { key: 'employeeNo', label: 'TBS #', expression: 't.EMPLOYEE_NO' },
      { key: 'firstName', label: 'First name', expression: 't.EMPLOYEE_FIRST_NAME' },
      { key: 'lastName', label: 'Last name', expression: 't.EMPLOYEE_LAST_NAME' },
      { key: 'lastEntry', label: 'Last entry', expression: dateOnly('t.LAST_ENTRY') },
      { key: 'createdAt', label: 'Created at', expression: dateTime('t.CREATED_AT') },
      { key: 'updatedAt', label: 'Updated at', expression: dateTime('t.UPDATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(TO_CHAR(t.EMPLOYEE_NO), \'\'))',
      'LOWER(NVL(t.EMPLOYEE_FIRST_NAME, \'\'))',
      'LOWER(NVL(t.EMPLOYEE_LAST_NAME, \'\'))',
    ],
    defaultOrderSql: 't.LAST_ENTRY DESC NULLS LAST, t.EMPLOYEE_NO',
  },
  {
    key: 'tbs-time-entries',
    label: 'TBS Time Entries',
    description: 'Raw TBS time rows used by the TBS comparison and working-hours views.',
    category: 'Time & TBS',
    sourceLabel: 'TL_TBS_TIME_ENTRIES',
    audience: 'Finance / report owners',
    dateFieldLabel: 'Entry date',
    fromSql: `TL_TBS_TIME_ENTRIES t
      LEFT JOIN TL_TBS_EMPLOYEE_MAP m ON m.TBS_EMPLOYEE_NO = t.EMPLOYEE_NO
      LEFT JOIN TL_EMPLOYEES e ON LOWER(e.EMAIL) = LOWER(m.EMAIL)`,
    dateFilterSql: dateRangeFilter('t.ENTRY_DATE'),
    columns: [
      { key: 'entryDate', label: 'Entry date', expression: dateOnly('t.ENTRY_DATE') },
      { key: 'employeeNo', label: 'TBS #', expression: 't.EMPLOYEE_NO' },
      { key: 'email', label: 'Email', expression: 'LOWER(m.EMAIL)' },
      { key: 'displayName', label: 'Employee', expression: 'e.DISPLAY_NAME' },
      { key: 'department', label: 'Department', expression: 'e.DEPARTMENT' },
      { key: 'workCode', label: 'Work code', expression: 't.WORK_CODE' },
      { key: 'workDescription', label: 'Work description', expression: 't.WORK_DESCRIPTION' },
      { key: 'timeHours', label: 'TBS hours', expression: 't.TIME_HOURS' },
      { key: 'entryType', label: 'Entry type', expression: 't.ENTRY_TYPE' },
      { key: 'defectCase', label: 'Defect/case', expression: 't.DEFECT_CASE' },
      { key: 'remark', label: 'Remark', expression: 't.REMARK' },
      { key: 'createdAt', label: 'Loaded at', expression: dateTime('t.CREATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(TO_CHAR(t.EMPLOYEE_NO), \'\'))',
      'LOWER(NVL(m.EMAIL, \'\'))',
      'LOWER(NVL(e.DISPLAY_NAME, \'\'))',
      'LOWER(NVL(e.DEPARTMENT, \'\'))',
      'LOWER(NVL(t.WORK_CODE, \'\'))',
      'LOWER(NVL(t.WORK_DESCRIPTION, \'\'))',
      'LOWER(NVL(t.ENTRY_TYPE, \'\'))',
      'LOWER(NVL(t.DEFECT_CASE, \'\'))',
      'LOWER(NVL(t.REMARK, \'\'))',
    ],
    defaultOrderSql: 't.ENTRY_DATE DESC, t.EMPLOYEE_NO, t.ID DESC',
  },
  {
    key: 'attendance-daily',
    label: 'Daily Attendance',
    description: 'Daily ActivTrak attendance rows after office-IP override logic is applied.',
    category: 'Attendance Evidence',
    sourceLabel: 'TL_ATTENDANCE',
    audience: 'HR / report owners',
    dateFieldLabel: 'Record date',
    fromSql: `TL_ATTENDANCE a
      LEFT JOIN TL_EMPLOYEES e ON LOWER(e.EMAIL) = LOWER(a.EMAIL)`,
    dateFilterSql: dateRangeFilter('a.RECORD_DATE'),
    columns: [
      { key: 'recordDate', label: 'Date', expression: dateOnly('a.RECORD_DATE') },
      { key: 'email', label: 'Email', expression: 'LOWER(a.EMAIL)' },
      { key: 'displayName', label: 'Employee', expression: 'NVL(a.DISPLAY_NAME, e.DISPLAY_NAME)' },
      { key: 'department', label: 'Department', expression: 'e.DEPARTMENT' },
      { key: 'location', label: 'Location', expression: 'a.LOCATION' },
      { key: 'rawLocation', label: 'Raw location', expression: 'a.RAW_LOCATION' },
      { key: 'officeIpOverride', label: 'Office IP override', expression: yesNo('a.OFFICE_IP_OVERRIDE') },
      { key: 'officeIpMatches', label: 'Office IP matches', expression: 'a.OFFICE_IP_MATCHES' },
      { key: 'totalHours', label: 'Total hours', expression: 'a.TOTAL_HOURS' },
      { key: 'isPto', label: 'PTO', expression: yesNo('a.IS_PTO') },
      { key: 'ptoType', label: 'PTO type', expression: 'a.PTO_TYPE' },
      { key: 'ptoHours', label: 'PTO hours', expression: 'a.PTO_HOURS' },
      { key: 'createdAt', label: 'Loaded at', expression: dateTime('a.CREATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(a.EMAIL, \'\'))',
      'LOWER(NVL(a.DISPLAY_NAME, \'\'))',
      'LOWER(NVL(e.DISPLAY_NAME, \'\'))',
      'LOWER(NVL(e.DEPARTMENT, \'\'))',
      'LOWER(NVL(a.LOCATION, \'\'))',
      'LOWER(NVL(a.RAW_LOCATION, \'\'))',
      'LOWER(NVL(a.OFFICE_IP_MATCHES, \'\'))',
      'LOWER(NVL(a.PTO_TYPE, \'\'))',
    ],
    defaultOrderSql: 'a.RECORD_DATE DESC, a.EMAIL',
  },
  {
    key: 'productivity-daily',
    label: 'Daily Productivity',
    description: 'Daily ActivTrak productivity totals behind working-hours and variance calculations.',
    category: 'Attendance Evidence',
    sourceLabel: 'TL_PRODUCTIVITY',
    audience: 'HR / report owners',
    dateFieldLabel: 'Record date',
    fromSql: `TL_PRODUCTIVITY p
      LEFT JOIN TL_EMPLOYEES e ON LOWER(e.EMAIL) = LOWER(p.EMAIL)`,
    dateFilterSql: dateRangeFilter('p.RECORD_DATE'),
    columns: [
      { key: 'recordDate', label: 'Date', expression: dateOnly('p.RECORD_DATE') },
      { key: 'email', label: 'Email', expression: 'LOWER(p.EMAIL)' },
      { key: 'displayName', label: 'Employee', expression: 'e.DISPLAY_NAME' },
      { key: 'department', label: 'Department', expression: 'e.DEPARTMENT' },
      { key: 'location', label: 'Location', expression: 'p.LOCATION' },
      { key: 'utilizationLevel', label: 'Utilization', expression: 'p.UTILIZATION_LEVEL' },
      { key: 'activeHours', label: 'Active hrs', expression: hours('p.ACTIVE_TIME') },
      { key: 'totalHours', label: 'Total hrs', expression: hours('p.TOTAL_TIME') },
      { key: 'productiveActiveHours', label: 'Prod active hrs', expression: hours('p.PRODUCTIVE_ACTIVE_TIME') },
      { key: 'productivePassiveHours', label: 'Prod passive hrs', expression: hours('p.PRODUCTIVE_PASSIVE_TIME') },
      { key: 'undefinedActiveHours', label: 'Undefined active hrs', expression: hours('p.UNDEFINED_ACTIVE_TIME') },
      { key: 'undefinedPassiveHours', label: 'Undefined passive hrs', expression: hours('p.UNDEFINED_PASSIVE_TIME') },
      { key: 'unproductiveActiveHours', label: 'Unprod active hrs', expression: hours('p.UNPRODUCTIVE_ACTIVE_TIME') },
      { key: 'unproductivePassiveHours', label: 'Unprod passive hrs', expression: hours('p.UNPRODUCTIVE_PASSIVE_TIME') },
      { key: 'timeOffHours', label: 'Time-off hrs', expression: hours('p.TIME_OFF_TIME') },
      { key: 'timeOffType', label: 'Time-off type', expression: 'p.TIME_OFF_TYPE' },
      { key: 'firstActivityAt', label: 'First activity', expression: dateTime('p.FIRST_ACTIVITY_AT') },
      { key: 'lastActivityAt', label: 'Last activity', expression: dateTime('p.LAST_ACTIVITY_AT') },
      { key: 'createdAt', label: 'Loaded at', expression: dateTime('p.CREATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(p.EMAIL, \'\'))',
      'LOWER(NVL(e.DISPLAY_NAME, \'\'))',
      'LOWER(NVL(e.DEPARTMENT, \'\'))',
      'LOWER(NVL(p.LOCATION, \'\'))',
      'LOWER(NVL(p.UTILIZATION_LEVEL, \'\'))',
      'LOWER(NVL(p.TIME_OFF_TYPE, \'\'))',
    ],
    defaultOrderSql: 'p.RECORD_DATE DESC, p.EMAIL',
  },
  {
    key: 'office-ip-activity',
    label: 'Office IP Activity',
    description: 'Office-network activity rows used to confirm office presence when location is otherwise unclear.',
    category: 'Attendance Evidence',
    sourceLabel: 'TL_OFFICE_IP_ACTIVITY',
    audience: 'HR / report owners',
    dateFieldLabel: 'Record date',
    fromSql: `TL_OFFICE_IP_ACTIVITY o
      LEFT JOIN TL_EMPLOYEES e ON LOWER(e.EMAIL) = LOWER(o.EMAIL)
      LEFT JOIN TL_OFFICE_IPS ip ON ip.PUBLIC_IP = o.PUBLIC_IP`,
    dateFilterSql: dateRangeFilter('o.RECORD_DATE'),
    columns: [
      { key: 'recordDate', label: 'Date', expression: dateOnly('o.RECORD_DATE') },
      { key: 'email', label: 'Email', expression: 'LOWER(o.EMAIL)' },
      { key: 'displayName', label: 'Employee', expression: 'NVL(o.DISPLAY_NAME, e.DISPLAY_NAME)' },
      { key: 'department', label: 'Department', expression: 'e.DEPARTMENT' },
      { key: 'publicIp', label: 'Public IP', expression: 'o.PUBLIC_IP' },
      { key: 'officeLocation', label: 'Office location', expression: 'ip.OFFICE_LOCATION' },
      { key: 'durationHours', label: 'Duration hrs', expression: hours('o.DURATION_SECONDS') },
      { key: 'eventCount', label: 'Events', expression: 'o.EVENT_COUNT' },
      { key: 'firstActivityAt', label: 'First activity', expression: dateTime('o.FIRST_ACTIVITY_AT') },
      { key: 'lastActivityAt', label: 'Last activity', expression: dateTime('o.LAST_ACTIVITY_AT') },
      { key: 'createdAt', label: 'Loaded at', expression: dateTime('o.CREATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(o.EMAIL, \'\'))',
      'LOWER(NVL(o.DISPLAY_NAME, \'\'))',
      'LOWER(NVL(e.DISPLAY_NAME, \'\'))',
      'LOWER(NVL(e.DEPARTMENT, \'\'))',
      'LOWER(NVL(o.PUBLIC_IP, \'\'))',
      'LOWER(NVL(ip.OFFICE_LOCATION, \'\'))',
    ],
    defaultOrderSql: 'o.RECORD_DATE DESC, o.EMAIL, o.PUBLIC_IP',
  },
  {
    key: 'activtrak-ip-activity',
    label: 'ActivTrak IP Activity',
    description: 'ActivTrak public-IP activity used by office evidence and Duo reconciliation checks.',
    category: 'Security & Devices',
    sourceLabel: 'TL_ACTIVTRAK_IP_ACTIVITY',
    audience: 'IT / report owners',
    dateFieldLabel: 'Record date',
    fromSql: `TL_ACTIVTRAK_IP_ACTIVITY a
      LEFT JOIN TL_EMPLOYEES e ON LOWER(e.EMAIL) = LOWER(a.EMAIL)`,
    dateFilterSql: dateRangeFilter('a.RECORD_DATE'),
    columns: [
      { key: 'recordDate', label: 'Date', expression: dateOnly('a.RECORD_DATE') },
      { key: 'email', label: 'Email', expression: 'LOWER(a.EMAIL)' },
      { key: 'userId', label: 'ActivTrak ID', expression: 'a.USER_ID' },
      { key: 'displayName', label: 'Employee', expression: 'NVL(a.DISPLAY_NAME, e.DISPLAY_NAME)' },
      { key: 'department', label: 'Department', expression: 'e.DEPARTMENT' },
      { key: 'publicIp', label: 'Public IP', expression: 'a.PUBLIC_IP' },
      { key: 'isOfficeIp', label: 'Office IP', expression: yesNo('a.IS_OFFICE_IP') },
      { key: 'officeLocation', label: 'Office location', expression: 'a.OFFICE_LOCATION' },
      { key: 'durationHours', label: 'Duration hrs', expression: hours('a.DURATION_SECONDS') },
      { key: 'eventCount', label: 'Events', expression: 'a.EVENT_COUNT' },
      { key: 'firstActivityAt', label: 'First activity', expression: dateTime('a.FIRST_ACTIVITY_AT') },
      { key: 'lastActivityAt', label: 'Last activity', expression: dateTime('a.LAST_ACTIVITY_AT') },
      { key: 'createdAt', label: 'Loaded at', expression: dateTime('a.CREATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(a.EMAIL, \'\'))',
      'LOWER(NVL(TO_CHAR(a.USER_ID), \'\'))',
      'LOWER(NVL(a.DISPLAY_NAME, \'\'))',
      'LOWER(NVL(e.DISPLAY_NAME, \'\'))',
      'LOWER(NVL(e.DEPARTMENT, \'\'))',
      'LOWER(NVL(a.PUBLIC_IP, \'\'))',
      'LOWER(NVL(a.OFFICE_LOCATION, \'\'))',
    ],
    defaultOrderSql: 'a.RECORD_DATE DESC, a.EMAIL, a.PUBLIC_IP',
  },
  {
    key: 'bamboo-time-off',
    label: 'Bamboo Time Off',
    description: 'Approved or requested Bamboo time-off rows used to adjust attendance expectations.',
    category: 'Approvals & Leave',
    sourceLabel: 'TL_TIME_OFF',
    audience: 'HR / report owners',
    dateFieldLabel: 'Time-off overlap',
    fromSql: 'TL_TIME_OFF t',
    dateFilterSql: 't.START_DATE <= TO_DATE(:endDate, \'YYYY-MM-DD\') AND t.END_DATE >= TO_DATE(:startDate, \'YYYY-MM-DD\')',
    columns: [
      { key: 'email', label: 'Email', expression: 'LOWER(t.EMAIL)' },
      { key: 'employeeName', label: 'Employee', expression: 't.EMPLOYEE_NAME' },
      { key: 'employeeId', label: 'Bamboo ID', expression: 't.EMPLOYEE_ID' },
      { key: 'department', label: 'Department', expression: 't.DEPARTMENT' },
      { key: 'startDate', label: 'Start date', expression: dateOnly('t.START_DATE') },
      { key: 'endDate', label: 'End date', expression: dateOnly('t.END_DATE') },
      { key: 'type', label: 'Type', expression: 't.TYPE' },
      { key: 'status', label: 'Status', expression: 't.STATUS' },
      { key: 'amount', label: 'Amount', expression: 't.AMOUNT' },
      { key: 'unit', label: 'Unit', expression: 't.UNIT' },
      { key: 'createdAt', label: 'Loaded at', expression: dateTime('t.CREATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(t.EMAIL, \'\'))',
      'LOWER(NVL(t.EMPLOYEE_NAME, \'\'))',
      'LOWER(NVL(t.EMPLOYEE_ID, \'\'))',
      'LOWER(NVL(t.DEPARTMENT, \'\'))',
      'LOWER(NVL(t.TYPE, \'\'))',
      'LOWER(NVL(t.STATUS, \'\'))',
    ],
    defaultOrderSql: 't.START_DATE DESC, t.EMAIL',
  },
  {
    key: 'remote-work-requests',
    label: 'Remote Work Requests',
    description: 'Temporary remote-work requests, including manager approval and alternate in-office dates.',
    category: 'Approvals & Leave',
    sourceLabel: 'TL_REMOTE_WORK_REQUESTS',
    audience: 'HR / report owners',
    dateFieldLabel: 'Remote-work overlap',
    fromSql: 'TL_REMOTE_WORK_REQUESTS r',
    dateFilterSql: 'r.REMOTE_WORK_START_DATE <= TO_DATE(:endDate, \'YYYY-MM-DD\') AND NVL(r.REMOTE_WORK_END_DATE, r.REMOTE_WORK_START_DATE) >= TO_DATE(:startDate, \'YYYY-MM-DD\')',
    columns: [
      { key: 'requestDate', label: 'Request date', expression: dateOnly('r.REQUEST_DATE') },
      { key: 'startDate', label: 'Start date', expression: dateOnly('r.REMOTE_WORK_START_DATE') },
      { key: 'endDate', label: 'End date', expression: dateOnly('r.REMOTE_WORK_END_DATE') },
      { key: 'email', label: 'Email', expression: 'LOWER(r.EMAIL)' },
      { key: 'employeeName', label: 'Employee', expression: 'r.EMPLOYEE_NAME' },
      { key: 'employeeId', label: 'Bamboo ID', expression: 'r.EMPLOYEE_ID' },
      { key: 'department', label: 'Department', expression: 'r.DEPARTMENT' },
      { key: 'remoteWorkType', label: 'Type', expression: 'r.REMOTE_WORK_TYPE' },
      { key: 'managerApproval', label: 'Manager approval', expression: 'r.MANAGER_APPROVAL_RECEIVED' },
      { key: 'managerName', label: 'Manager', expression: 'r.MANAGER_NAME' },
      { key: 'alternateOfficeDate', label: 'Alternate office date', expression: 'r.ALTERNATE_IN_OFFICE_WORK_DATE' },
      { key: 'supportingDocs', label: 'Supporting docs', expression: 'r.SUPPORTING_DOCUMENTATION_SUBMITTED' },
      { key: 'reason', label: 'Reason', expression: 'r.REASON' },
      { key: 'bambooRowId', label: 'Bamboo row', expression: 'r.BAMBOO_ROW_ID' },
      { key: 'updatedAt', label: 'Updated at', expression: dateTime('r.UPDATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(r.EMAIL, \'\'))',
      'LOWER(NVL(r.EMPLOYEE_NAME, \'\'))',
      'LOWER(NVL(r.EMPLOYEE_ID, \'\'))',
      'LOWER(NVL(r.DEPARTMENT, \'\'))',
      'LOWER(NVL(r.REMOTE_WORK_TYPE, \'\'))',
      'LOWER(NVL(r.MANAGER_APPROVAL_RECEIVED, \'\'))',
      'LOWER(NVL(r.MANAGER_NAME, \'\'))',
      'LOWER(NVL(r.ALTERNATE_IN_OFFICE_WORK_DATE, \'\'))',
      'LOWER(NVL(r.REASON, \'\'))',
    ],
    defaultOrderSql: 'r.REMOTE_WORK_START_DATE DESC, r.EMAIL',
  },
  {
    key: 'work-abroad-requests',
    label: 'Work Abroad Requests',
    description: 'Work-abroad/province request rows used to explain office-attendance exceptions.',
    category: 'Approvals & Leave',
    sourceLabel: 'TL_WORK_ABROAD_REQUESTS',
    audience: 'HR / report owners',
    dateFieldLabel: 'Work-abroad overlap',
    fromSql: 'TL_WORK_ABROAD_REQUESTS r',
    dateFilterSql: 'r.WORK_ABROAD_START_DATE <= TO_DATE(:endDate, \'YYYY-MM-DD\') AND NVL(r.WORK_ABROAD_END_DATE, r.WORK_ABROAD_START_DATE) >= TO_DATE(:startDate, \'YYYY-MM-DD\')',
    columns: [
      { key: 'requestDate', label: 'Request date', expression: dateOnly('r.REQUEST_DATE') },
      { key: 'startDate', label: 'Start date', expression: dateOnly('r.WORK_ABROAD_START_DATE') },
      { key: 'endDate', label: 'End date', expression: dateOnly('r.WORK_ABROAD_END_DATE') },
      { key: 'email', label: 'Email', expression: 'LOWER(r.EMAIL)' },
      { key: 'employeeName', label: 'Employee', expression: 'r.EMPLOYEE_NAME' },
      { key: 'employeeId', label: 'Bamboo ID', expression: 'r.EMPLOYEE_ID' },
      { key: 'department', label: 'Department', expression: 'r.DEPARTMENT' },
      { key: 'countryOrProvince', label: 'Country/province', expression: 'r.COUNTRY_OR_PROVINCE' },
      { key: 'approved', label: 'Approved', expression: 'r.REQUEST_APPROVED' },
      { key: 'approvedDeclinedBy', label: 'Approved/declined by', expression: 'r.APPROVED_DECLINED_BY' },
      { key: 'schedule', label: 'Schedule', expression: 'r.WORK_SCHEDULE' },
      { key: 'locationAddress', label: 'Location address', expression: 'r.REMOTE_WORK_LOCATION_ADDRESS' },
      { key: 'reason', label: 'Reason', expression: 'r.REASON' },
      { key: 'bambooRowId', label: 'Bamboo row', expression: 'r.BAMBOO_ROW_ID' },
      { key: 'updatedAt', label: 'Updated at', expression: dateTime('r.UPDATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(r.EMAIL, \'\'))',
      'LOWER(NVL(r.EMPLOYEE_NAME, \'\'))',
      'LOWER(NVL(r.EMPLOYEE_ID, \'\'))',
      'LOWER(NVL(r.DEPARTMENT, \'\'))',
      'LOWER(NVL(r.COUNTRY_OR_PROVINCE, \'\'))',
      'LOWER(NVL(r.REQUEST_APPROVED, \'\'))',
      'LOWER(NVL(r.APPROVED_DECLINED_BY, \'\'))',
      'LOWER(NVL(r.WORK_SCHEDULE, \'\'))',
      'LOWER(NVL(r.REASON, \'\'))',
    ],
    defaultOrderSql: 'r.WORK_ABROAD_START_DATE DESC, r.EMAIL',
  },
  {
    key: 'activtrak-identifiers',
    label: 'ActivTrak Identifiers',
    description: 'ActivTrak user identifiers used to detect mapping gaps, shared devices, and non-email identities.',
    category: 'Security & Devices',
    sourceLabel: 'TL_ACTIVTRAK_IDENTIFIERS',
    audience: 'IT / report owners',
    dateFieldLabel: null,
    fromSql: `TL_ACTIVTRAK_IDENTIFIERS i
      LEFT JOIN TL_ACTIVTRAK_USER_STATS s ON s.USER_ID = i.USER_ID`,
    columns: [
      { key: 'userId', label: 'ActivTrak ID', expression: 'i.USER_ID' },
      { key: 'identifierEmail', label: 'Identifier', expression: 'LOWER(i.IDENTIFIER_EMAIL)' },
      { key: 'userName', label: 'User name', expression: 's.USER_NAME' },
      { key: 'firstSeen', label: 'First seen', expression: dateOnly('s.FIRST_SEEN') },
      { key: 'lastSeen', label: 'Last seen', expression: dateOnly('s.LAST_SEEN') },
      { key: 'activityRowCount', label: 'Activity rows', expression: 's.ACTIVITY_ROW_COUNT' },
      { key: 'createdAt', label: 'Loaded at', expression: dateTime('i.CREATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(TO_CHAR(i.USER_ID), \'\'))',
      'LOWER(NVL(i.IDENTIFIER_EMAIL, \'\'))',
      'LOWER(NVL(s.USER_NAME, \'\'))',
    ],
    defaultOrderSql: 'i.USER_ID, i.IDENTIFIER_EMAIL',
  },
  {
    key: 'activtrak-user-stats',
    label: 'ActivTrak User Stats',
    description: 'ActivTrak user-level first/last-seen and activity-row counts.',
    category: 'Security & Devices',
    sourceLabel: 'TL_ACTIVTRAK_USER_STATS',
    audience: 'IT / report owners',
    dateFieldLabel: 'Last seen',
    fromSql: 'TL_ACTIVTRAK_USER_STATS s',
    dateFilterSql: dateRangeFilter('s.LAST_SEEN'),
    columns: [
      { key: 'userId', label: 'ActivTrak ID', expression: 's.USER_ID' },
      { key: 'userName', label: 'User name', expression: 's.USER_NAME' },
      { key: 'firstSeen', label: 'First seen', expression: dateOnly('s.FIRST_SEEN') },
      { key: 'lastSeen', label: 'Last seen', expression: dateOnly('s.LAST_SEEN') },
      { key: 'activityRowCount', label: 'Activity rows', expression: 's.ACTIVITY_ROW_COUNT' },
      { key: 'createdAt', label: 'Created at', expression: dateTime('s.CREATED_AT') },
      { key: 'updatedAt', label: 'Updated at', expression: dateTime('s.UPDATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(TO_CHAR(s.USER_ID), \'\'))',
      'LOWER(NVL(s.USER_NAME, \'\'))',
    ],
    defaultOrderSql: 's.LAST_SEEN DESC NULLS LAST, s.USER_ID',
  },
  {
    key: 'duo-auth-logs',
    label: 'Duo Auth Logs',
    description: 'Successful and failed Duo authentication evidence behind device and ActivTrak reconciliation.',
    category: 'Security & Devices',
    sourceLabel: 'TL_DUO_AUTH_LOGS',
    audience: 'IT / report owners',
    dateFieldLabel: 'Event time',
    fromSql: 'TL_DUO_AUTH_LOGS d',
    dateFilterSql: timestampRangeFilter('d.EVENT_TS'),
    columns: [
      { key: 'eventTs', label: 'Event time', expression: dateTime('d.EVENT_TS') },
      { key: 'email', label: 'Email', expression: 'LOWER(d.EMAIL)' },
      { key: 'username', label: 'Username', expression: 'LOWER(d.USERNAME)' },
      { key: 'alias', label: 'Alias', expression: 'LOWER(d.ALIAS)' },
      { key: 'eventType', label: 'Event type', expression: 'd.EVENT_TYPE' },
      { key: 'result', label: 'Result', expression: 'd.RESULT' },
      { key: 'reason', label: 'Reason', expression: 'd.REASON' },
      { key: 'factor', label: 'Factor', expression: 'd.FACTOR' },
      { key: 'applicationName', label: 'Application', expression: 'd.APPLICATION_NAME' },
      { key: 'destinationName', label: 'Destination', expression: 'd.DESTINATION_NAME' },
      { key: 'accessDeviceIp', label: 'Access IP', expression: 'd.ACCESS_DEVICE_IP' },
      { key: 'accessDeviceHostname', label: 'Device host', expression: 'd.ACCESS_DEVICE_HOSTNAME' },
      { key: 'accessDeviceOs', label: 'OS', expression: 'd.ACCESS_DEVICE_OS' },
      { key: 'accessDeviceBrowser', label: 'Browser', expression: 'd.ACCESS_DEVICE_BROWSER' },
      { key: 'accessDeviceCity', label: 'City', expression: 'd.ACCESS_DEVICE_CITY' },
      { key: 'accessDeviceState', label: 'State', expression: 'd.ACCESS_DEVICE_STATE' },
      { key: 'accessDeviceCountry', label: 'Country', expression: 'd.ACCESS_DEVICE_COUNTRY' },
      { key: 'authDeviceName', label: 'Auth device', expression: 'd.AUTH_DEVICE_NAME' },
      { key: 'trustedEndpointStatus', label: 'Trusted endpoint', expression: 'd.TRUSTED_ENDPOINT_STATUS' },
      { key: 'txid', label: 'Duo TXID', expression: 'd.TXID' },
      { key: 'loadedAt', label: 'Loaded at', expression: dateTime('d.CREATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(d.EMAIL, \'\'))',
      'LOWER(NVL(d.USERNAME, \'\'))',
      'LOWER(NVL(d.ALIAS, \'\'))',
      'LOWER(NVL(d.RESULT, \'\'))',
      'LOWER(NVL(d.REASON, \'\'))',
      'LOWER(NVL(d.FACTOR, \'\'))',
      'LOWER(NVL(d.APPLICATION_NAME, \'\'))',
      'LOWER(NVL(d.DESTINATION_NAME, \'\'))',
      'LOWER(NVL(d.ACCESS_DEVICE_IP, \'\'))',
      'LOWER(NVL(d.ACCESS_DEVICE_HOSTNAME, \'\'))',
      'LOWER(NVL(d.ACCESS_DEVICE_OS, \'\'))',
      'LOWER(NVL(d.ACCESS_DEVICE_CITY, \'\'))',
      'LOWER(NVL(d.ACCESS_DEVICE_COUNTRY, \'\'))',
      'LOWER(NVL(d.AUTH_DEVICE_NAME, \'\'))',
      'LOWER(NVL(d.TXID, \'\'))',
    ],
    defaultOrderSql: 'd.EVENT_TS DESC, d.TXID',
  },
  {
    key: 'office-ips',
    label: 'Office IP Rules',
    description: 'Configured office public IP addresses that can turn network evidence into office presence.',
    category: 'Operations',
    sourceLabel: 'TL_OFFICE_IPS',
    audience: 'IT / report owners',
    dateFieldLabel: null,
    fromSql: 'TL_OFFICE_IPS ip',
    columns: [
      { key: 'publicIp', label: 'Public IP', expression: 'ip.PUBLIC_IP' },
      { key: 'label', label: 'Label', expression: 'ip.LABEL' },
      { key: 'officeLocation', label: 'Office location', expression: 'ip.OFFICE_LOCATION' },
      { key: 'isActive', label: 'Active', expression: yesNo('ip.IS_ACTIVE') },
      { key: 'notes', label: 'Notes', expression: 'ip.NOTES' },
      { key: 'createdAt', label: 'Created at', expression: dateTime('ip.CREATED_AT') },
      { key: 'updatedAt', label: 'Updated at', expression: dateTime('ip.UPDATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(ip.PUBLIC_IP, \'\'))',
      'LOWER(NVL(ip.LABEL, \'\'))',
      'LOWER(NVL(ip.OFFICE_LOCATION, \'\'))',
      'LOWER(NVL(ip.NOTES, \'\'))',
    ],
    defaultOrderSql: 'ip.IS_ACTIVE DESC, ip.OFFICE_LOCATION, ip.PUBLIC_IP',
  },
  {
    key: 'duo-sync-state',
    label: 'Duo Sync State',
    description: 'Duo high-water marks used to decide what the next auth-log sync should request.',
    category: 'Operations',
    sourceLabel: 'TL_DUO_SYNC_STATE',
    audience: 'IT / report owners',
    dateFieldLabel: null,
    fromSql: 'TL_DUO_SYNC_STATE s',
    columns: [
      { key: 'stateKey', label: 'State key', expression: 's.STATE_KEY' },
      { key: 'lastEventTsMs', label: 'Last event ms', expression: 's.LAST_EVENT_TS_MS' },
      { key: 'lastEventAt', label: 'Last event at', expression: `CASE WHEN s.LAST_EVENT_TS_MS IS NULL THEN NULL ELSE TO_CHAR(TO_TIMESTAMP_TZ('1970-01-01 00:00:00 UTC', 'YYYY-MM-DD HH24:MI:SS TZR') + NUMTODSINTERVAL(s.LAST_EVENT_TS_MS / 1000, 'SECOND'), 'YYYY-MM-DD HH24:MI:SS') END` },
      { key: 'updatedAt', label: 'Updated at', expression: dateTime('s.UPDATED_AT') },
    ],
    searchExpressions: [
      'LOWER(NVL(s.STATE_KEY, \'\'))',
      'LOWER(NVL(TO_CHAR(s.LAST_EVENT_TS_MS), \'\'))',
    ],
    defaultOrderSql: 's.STATE_KEY',
  },
  {
    key: 'sync-log',
    label: 'Sync Log',
    description: 'Sync job status rows, counts, errors, and source date windows.',
    category: 'Operations',
    sourceLabel: 'TL_SYNC_LOG',
    audience: 'Operations / report owners',
    dateFieldLabel: 'Started at',
    fromSql: 'TL_SYNC_LOG s',
    dateFilterSql: timestampRangeFilter('s.STARTED_AT'),
    columns: [
      { key: 'syncType', label: 'Sync type', expression: 's.SYNC_TYPE' },
      { key: 'status', label: 'Status', expression: 's.STATUS' },
      { key: 'recordsSynced', label: 'Rows synced', expression: 's.RECORDS_SYNCED' },
      { key: 'dateRangeStart', label: 'Source start', expression: dateOnly('s.DATE_RANGE_START') },
      { key: 'dateRangeEnd', label: 'Source end', expression: dateOnly('s.DATE_RANGE_END') },
      { key: 'startedAt', label: 'Started at', expression: dateTime('s.STARTED_AT') },
      { key: 'completedAt', label: 'Completed at', expression: dateTime('s.COMPLETED_AT') },
      { key: 'errorMessage', label: 'Error', expression: 's.ERROR_MESSAGE' },
    ],
    searchExpressions: [
      'LOWER(NVL(s.SYNC_TYPE, \'\'))',
      'LOWER(NVL(s.STATUS, \'\'))',
      'LOWER(NVL(s.ERROR_MESSAGE, \'\'))',
    ],
    defaultOrderSql: 's.STARTED_AT DESC, s.ID DESC',
  },
] as const;

const DATASET_BY_KEY = new Map<RawDataDatasetKey, DatasetDefinition>(
  RAW_DATA_DATASETS.map((dataset) => [dataset.key, dataset]),
);

function toSummary(dataset: DatasetDefinition): RawDataDatasetSummary {
  return {
    key: dataset.key,
    label: dataset.label,
    description: dataset.description,
    category: dataset.category,
    sourceLabel: dataset.sourceLabel,
    audience: dataset.audience,
    dateFieldLabel: dataset.dateFieldLabel,
    columns: dataset.columns.map(({ key, label }) => ({ key, label })),
  };
}

export function isRawDataDatasetKey(value: string | null | undefined): value is RawDataDatasetKey {
  return Boolean(value && DATASET_BY_KEY.has(value as RawDataDatasetKey));
}

export function normalizeRawDataDatasetKey(value: string | null | undefined): RawDataDatasetKey {
  return isRawDataDatasetKey(value) ? value : DEFAULT_RAW_DATA_DATASET_KEY;
}

export function getRawDataCatalog(): RawDataDatasetSummary[] {
  return RAW_DATA_DATASETS.map(toSummary);
}

export function getRawDataDatasetSummary(key: RawDataDatasetKey): RawDataDatasetSummary {
  const dataset = DATASET_BY_KEY.get(key);
  if (!dataset) return toSummary(DATASET_BY_KEY.get(DEFAULT_RAW_DATA_DATASET_KEY)!);
  return toSummary(dataset);
}

function normalizeSearch(search: string | null | undefined): string {
  return (search || '').trim().slice(0, 120).toLowerCase();
}

function normalizePage(page: number | null | undefined): number {
  if (!Number.isFinite(page)) return 0;
  return Math.max(0, Math.floor(page || 0));
}

function normalizePageSize(pageSize: number | null | undefined): number {
  if (!Number.isFinite(pageSize)) return RAW_DATA_PAGE_SIZE;
  return Math.min(100, Math.max(10, Math.floor(pageSize || RAW_DATA_PAGE_SIZE)));
}

function buildWhereClause(
  dataset: DatasetDefinition,
  search: string,
): string {
  const clauses: string[] = [];
  if (dataset.dateFilterSql) {
    clauses.push(`(${dataset.dateFilterSql})`);
  }
  if (search && dataset.searchExpressions.length > 0) {
    clauses.push(`(${dataset.searchExpressions.map((expression) => `${expression} LIKE :search`).join(' OR ')})`);
  }
  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
}

function normalizeValue(value: unknown): RawDataCellValue {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'bigint') return Number(value);
  return String(value);
}

function normalizeRows(rows: Record<string, unknown>[], columns: RawDataColumn[]): RawDataRow[] {
  return rows.map((row) => {
    const normalized: RawDataRow = {};
    for (const column of columns) {
      normalized[column.key] = normalizeValue(row[column.key]);
    }
    return normalized;
  });
}

export function getEmptyRawDataResult(options: {
  datasetKey: RawDataDatasetKey;
  startDate: Date | string;
  endDate: Date | string;
  search?: string | null;
  page?: number;
  pageSize?: number;
}): RawDataResult {
  const dataset = getRawDataDatasetSummary(options.datasetKey);
  return {
    dataset,
    columns: dataset.columns,
    rows: [],
    totalRows: 0,
    page: normalizePage(options.page),
    pageSize: normalizePageSize(options.pageSize),
    startDate: typeof options.startDate === 'string' ? options.startDate : toDateParam(options.startDate),
    endDate: typeof options.endDate === 'string' ? options.endDate : toDateParam(options.endDate),
    search: normalizeSearch(options.search),
  };
}

export async function getRawDataReport(options: {
  datasetKey: RawDataDatasetKey;
  startDate: Date | string;
  endDate: Date | string;
  search?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<RawDataResult> {
  const dataset = DATASET_BY_KEY.get(options.datasetKey) || DATASET_BY_KEY.get(DEFAULT_RAW_DATA_DATASET_KEY)!;
  const columns = dataset.columns.map(({ key, label }) => ({ key, label }));
  const startDate = typeof options.startDate === 'string' ? options.startDate : toDateParam(options.startDate);
  const endDate = typeof options.endDate === 'string' ? options.endDate : toDateParam(options.endDate);
  const search = normalizeSearch(options.search);
  const page = normalizePage(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const offset = page * pageSize;
  const whereClause = buildWhereClause(dataset, search);
  const filterBinds: Record<string, unknown> = {};
  if (dataset.dateFilterSql) {
    filterBinds.startDate = startDate;
    filterBinds.endDate = endDate;
  }
  if (search) {
    filterBinds.search = `%${search}%`;
  }
  const dataBinds: Record<string, unknown> = {
    ...filterBinds,
    offset,
    limit: pageSize,
  };

  const selectList = dataset.columns
    .map((column) => `${column.expression} AS "${column.key}"`)
    .join(',\n        ');
  const dataSql = `
    SELECT ${selectList}
      FROM ${dataset.fromSql}
      ${whereClause}
      ORDER BY ${dataset.defaultOrderSql}
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
  `;
  const countSql = `
    SELECT COUNT(*) AS "totalRows"
      FROM ${dataset.fromSql}
      ${whereClause}
  `;

  const [rows, countRows] = await Promise.all([
    query<Record<string, unknown>>(dataSql, dataBinds),
    query<{ totalRows: number }>(countSql, filterBinds),
  ]);
  const totalRows = Number(countRows[0]?.totalRows || 0);

  return {
    dataset: toSummary(dataset),
    columns,
    rows: normalizeRows(rows, columns),
    totalRows,
    page,
    pageSize,
    startDate,
    endDate,
    search,
  };
}

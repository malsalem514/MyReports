import {
  formatEmployeeWeekValue,
  formatNameBucket,
  getEmployeeCellHex,
  getWeekLabel,
  type ApprovalRequestRow,
  type DisplayRow,
  type FilteredAttendanceSummary,
} from './office-attendance-view.ts';

export type ExportCell = string | number;

export interface ExportSheetData {
  headers: string[];
  rows: ExportCell[][];
  columnWidths: number[];
}

export interface ApprovalRequestExportData {
  sheet: ExportSheetData;
}

export interface AttendanceExportData {
  mainSheet: ExportSheetData & {
    summaryRow: ExportCell[];
    weekFillHexes: string[][];
    weekColumnStartIndex: number;
  };
  detailSheet?: ExportSheetData & {
    title: string;
  };
}

const APPROVAL_REQUEST_HEADERS = [
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

const AGGREGATE_WEEKLY_BREAKDOWN_HEADERS = [
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

export function toCsvRow(cells: ExportCell[]): string {
  return cells.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',');
}

function withCsvFormattedScore(mainSheet: AttendanceExportData['mainSheet'], row: ExportCell[]): ExportCell[] {
  const scoreColumnIndex = mainSheet.headers.length - 2;
  const csvRow = [...row];
  const scoreValue = csvRow[scoreColumnIndex];
  if (typeof scoreValue === 'number') {
    csvRow[scoreColumnIndex] = `${scoreValue}%`;
  }
  return csvRow;
}

export function buildApprovalRequestCsvContent(data: ApprovalRequestExportData): string {
  return [
    toCsvRow(data.sheet.headers),
    ...data.sheet.rows.map(toCsvRow),
  ].join('\n');
}

export function buildAttendanceCsvContent(data: AttendanceExportData): string {
  const lines = [
    toCsvRow(data.mainSheet.headers),
    ...data.mainSheet.rows.map((row) => toCsvRow(withCsvFormattedScore(data.mainSheet, row))),
  ];

  if (data.detailSheet) {
    lines.push('');
    lines.push(data.detailSheet.title);
    lines.push(toCsvRow(data.detailSheet.headers));
    lines.push(...data.detailSheet.rows.map(toCsvRow));
  }

  return lines.join('\n');
}

export function buildApprovalRequestExportData(combinedApprovalRequests: ApprovalRequestRow[]): ApprovalRequestExportData {
  return {
    sheet: {
      headers: APPROVAL_REQUEST_HEADERS,
      rows: combinedApprovalRequests.map((request) => [
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
      ]),
      columnWidths: APPROVAL_REQUEST_HEADERS.map((_, index) => (index >= 13 ? 24 : 18)),
    },
  };
}

function getAggregateWeekFillHex(row: DisplayRow, week: string): string {
  const compliance = row.weeklyCompliance?.[week];
  if ((compliance?.eligibleEmployees ?? 0) <= 0) return 'F3F4F6';
  if ((compliance?.compliancePct ?? 0) >= 80) return 'DCFCE7';
  if ((compliance?.compliancePct ?? 0) >= 50) return 'FEF3C7';
  return 'FEE2E2';
}

export function buildAttendanceExportData(params: {
  rows: DisplayRow[];
  weeks: string[];
  isAggregateView: boolean;
  aggregateLabel: string;
  aggregatePluralLabel: string;
  filteredSummary: FilteredAttendanceSummary;
}): AttendanceExportData {
  const {
    rows,
    weeks,
    isAggregateView,
    aggregateLabel,
    aggregatePluralLabel,
    filteredSummary,
  } = params;

  const headers = [
    isAggregateView ? aggregateLabel : 'Employee',
    isAggregateView ? 'Employees' : 'Department',
    ...(isAggregateView ? ['Quebec Employees', 'Remote/Exempt Employees'] : []),
    'Location',
    'Coverage Status',
    ...(isAggregateView ? [] : ['Standing WFH Policy', 'Approved Coverage In Range', 'ActivTrak Coverage']),
    ...weeks.map((week) => getWeekLabel(week)),
    isAggregateView ? 'Total Office Days' : 'Total',
    'Avg/Week',
    'Score %',
    'Trend',
  ];

  const summaryRow = [
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
  ];

  const weekFillHexes = rows.map((row) =>
    weeks.map((week) => isAggregateView
      ? getAggregateWeekFillHex(row, week)
      : (!row.hasActivTrakCoverage ? 'F3F4F6' : getEmployeeCellHex(row.weeks[week]))
    ),
  );

  const mainRows = rows.map((row) => [
    row.label,
    row.secondary,
    ...(isAggregateView ? [row.quebecEmployeeCount ?? 0, row.remoteEmployeeCount ?? 0] : []),
    row.officeLocation,
    isAggregateView ? '—' : row.remoteWorkStatusLabel,
    ...(isAggregateView ? [] : [
      row.hasStandingWfhPolicy ? 'Yes' : 'No',
      row.hasAnyApprovedWfhCoverageInRange ? 'Yes' : 'No',
      row.hasActivTrakCoverage ? 'Covered' : 'Unknown',
    ]),
    ...weeks.map((week) => isAggregateView
      ? `${row.weeklyCompliance?.[week]?.compliancePct ?? 0}%`
      : formatEmployeeWeekValue(row.weeks[week], row.hasActivTrakCoverage)),
    isAggregateView ? row.total : (row.hasActivTrakCoverage ? row.total : ''),
    isAggregateView ? row.avgPerWeek : (row.hasActivTrakCoverage ? row.avgPerWeek : ''),
    isAggregateView ? row.scorePct : (row.hasActivTrakCoverage ? row.scorePct : ''),
    isAggregateView ? row.trend : (row.hasActivTrakCoverage ? row.trend : ''),
  ]);

  const mainSheet: AttendanceExportData['mainSheet'] = {
    headers,
    summaryRow,
    rows: mainRows,
    columnWidths: headers.map((_, index) => (index === 0 ? 24 : 14)),
    weekFillHexes,
    weekColumnStartIndex: isAggregateView ? 6 : 7,
  };

  if (!isAggregateView) {
    return { mainSheet };
  }

  return {
    mainSheet,
    detailSheet: {
      title: 'Weekly Breakdown',
      headers: AGGREGATE_WEEKLY_BREAKDOWN_HEADERS,
      rows: rows.flatMap((row) =>
        weeks.flatMap((week) => {
          const compliance = row.weeklyCompliance?.[week];
          if (!compliance) return [];
          return [[
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
          ]];
        }),
      ),
      columnWidths: AGGREGATE_WEEKLY_BREAKDOWN_HEADERS.map((_, index) => (index >= 5 ? 42 : index === 0 ? 28 : 18)),
    },
  };
}

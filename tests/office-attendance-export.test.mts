import assert from 'node:assert/strict';
import test from 'node:test';
import * as officeAttendanceExport from '../lib/office-attendance-export.ts';
import * as officeAttendanceView from '../lib/office-attendance-view.ts';
import type {
  ApprovalRequestRow,
  DisplayRow,
  FilteredAttendanceSummary,
  WeeklyCompliance,
} from '../lib/office-attendance-view.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as T & { default?: T; 'module.exports'?: T }).default
    ?? (mod as T & { default?: T; 'module.exports'?: T })['module.exports']
    ?? mod);
}

const {
  buildApprovalRequestCsvContent,
  buildApprovalRequestExportData,
  buildAttendanceCsvContent,
  buildAttendanceExportData,
  toCsvRow,
} = getModuleExports(officeAttendanceExport);
const { createEmptyWeekCell } = getModuleExports(officeAttendanceView);
import type { WeekCell } from '../lib/types/attendance.ts';

function createWeekCell(overrides: Partial<WeekCell> = {}): WeekCell {
  return {
    ...createEmptyWeekCell(),
    ...overrides,
  };
}

function createSummary(overrides: Partial<FilteredAttendanceSummary> = {}): FilteredAttendanceSummary {
  return {
    totalEmployees: 2,
    totalDepartments: 1,
    measurableEmployees: 1,
    unknownCoverageCount: 1,
    avgOfficeDays: 1.5,
    complianceRate: 100,
    zeroOfficeDaysCount: 0,
    zeroOfficeDepartments: 0,
    ...overrides,
  };
}

function createWeeklyCompliance(overrides: Partial<WeeklyCompliance> = {}): WeeklyCompliance {
  return {
    compliantEmployees: 1,
    eligibleEmployees: 1,
    exemptEmployees: 0,
    excusedEmployees: 0,
    unknownEmployees: 0,
    compliancePct: 100,
    compliantNames: ['Alice Example'],
    nonCompliantNames: [],
    exemptNames: [],
    excusedNames: [],
    ...overrides,
  };
}

function createDisplayRow(overrides: Partial<DisplayRow> = {}): DisplayRow {
  return {
    id: 'alice@example.com',
    label: 'Alice Example',
    secondary: 'Technology',
    officeLocation: 'Quebec (Montreal Head Office)',
    hasActivTrakCoverage: true,
    approvedRemoteWorkRequest: false,
    hasStandingWfhPolicy: false,
    hasApprovedRemoteRequestInRange: false,
    hasApprovedWorkAbroadRequestInRange: false,
    hasAnyApprovedWfhCoverageInRange: false,
    remoteWorkStatusLabel: 'Standard Policy',
    weeks: {},
    total: 2,
    avgPerWeek: 2,
    scorePct: 100,
    trend: 'flat',
    ...overrides,
  };
}

test('buildApprovalRequestExportData shares one header/row shape for request exports', () => {
  const requests: ApprovalRequestRow[] = [{
    source: 'remote-work',
    sourceLabel: 'Remote Work',
    bambooRowId: 10,
    employeeId: '1',
    employeeName: 'Alice "Quoted" Example',
    email: 'alice@example.com',
    department: 'Technology',
    officeLocation: 'Quebec',
    requestDate: '2026-03-01',
    startDate: '2026-03-10',
    endDate: '2026-03-11',
    category: 'Scheduled Office Day Remote Work',
    approvalStatus: 'Approved',
    authorizationStatus: 'Approved Request',
    approver: 'Manager Example',
    reason: 'Family',
    address: null,
    schedule: null,
    supportingDocumentationSubmitted: 'Yes',
    alternateInOfficeWorkDate: null,
  }];

  const exportData = buildApprovalRequestExportData(requests);

  assert.equal(exportData.sheet.headers[0], 'Source');
  assert.equal(exportData.sheet.rows.length, 1);
  assert.equal(exportData.sheet.rows[0]?.[3], 'Alice "Quoted" Example');
  assert.equal(exportData.sheet.columnWidths[0], 18);
  assert.equal(exportData.sheet.columnWidths[13], 24);
  assert.equal(
    toCsvRow(exportData.sheet.rows[0]!),
    '"Remote Work","10","1","Alice ""Quoted"" Example","alice@example.com","Technology","Quebec","2026-03-01","2026-03-10","2026-03-11","Scheduled Office Day Remote Work","Approved","Approved Request","Manager Example","Family","","","Yes",""',
  );
  assert.equal(
    buildApprovalRequestCsvContent(exportData),
    [
      '"Source","Bamboo Row ID","Employee ID","Employee Name","Email","Department","Office Location","Request Date","Start Date","End Date","Category","Approval Status","Authorization Status","Approver","Reason","Address","Work Schedule","Supporting Documentation Submitted","Alternate In-Office Work Date"',
      '"Remote Work","10","1","Alice ""Quoted"" Example","alice@example.com","Technology","Quebec","2026-03-01","2026-03-10","2026-03-11","Scheduled Office Day Remote Work","Approved","Approved Request","Manager Example","Family","","","Yes",""',
    ].join('\n'),
  );
});

test('buildAttendanceExportData preserves employee export rows and week colors', () => {
  const week = '2026-03-03';
  const row = createDisplayRow({
    weeks: {
      [week]: createWeekCell({
        officeDays: 1,
        adjustedOfficeTarget: 2,
        adjustedCompliant: false,
        hasApprovedRemoteCoverage: true,
      }),
    },
    total: 1,
    avgPerWeek: 1,
    scorePct: 50,
    trend: 'down',
  });

  const exportData = buildAttendanceExportData({
    rows: [row],
    weeks: [week],
    isAggregateView: false,
    aggregateLabel: 'Department',
    aggregatePluralLabel: 'departments',
    filteredSummary: createSummary({
      totalEmployees: 1,
      unknownCoverageCount: 0,
      avgOfficeDays: 1,
      complianceRate: 50,
      zeroOfficeDaysCount: 0,
    }),
  });

  assert.deepEqual(exportData.mainSheet.headers.slice(0, 5), [
    'Employee',
    'Department',
    'Location',
    'Coverage Status',
    'Standing WFH Policy',
  ]);
  assert.equal(exportData.mainSheet.summaryRow[0], '1 employees');
  assert.equal(exportData.mainSheet.rows[0]?.[7], '1 [House]');
  assert.equal(exportData.mainSheet.rows[0]?.at(-1), 'down');
  assert.deepEqual(exportData.mainSheet.weekFillHexes[0], ['FFEDD5']);
  assert.equal(exportData.mainSheet.weekColumnStartIndex, 7);
  assert.equal(exportData.detailSheet, undefined);
  assert.equal(
    buildAttendanceCsvContent(exportData),
    [
      '"Employee","Department","Location","Coverage Status","Standing WFH Policy","Approved Coverage In Range","ActivTrak Coverage","Mar 3 - Mar 7","Total","Avg/Week","Score %","Trend"',
      '"Alice Example","Technology","Quebec (Montreal Head Office)","Standard Policy","No","No","Covered","1 [House]","1","1","50%","down"',
    ].join('\n'),
  );
});

test('buildAttendanceExportData includes aggregate weekly breakdown sheet', () => {
  const week = '2026-03-09';
  const row = createDisplayRow({
    id: 'technology',
    label: 'Technology',
    secondary: '3',
    weeks: {
      [week]: createWeekCell({
        officeDays: 100,
        adjustedOfficeTarget: 2,
        adjustedCompliant: true,
      }),
    },
    weeklyCompliance: {
      [week]: createWeeklyCompliance({
        eligibleEmployees: 2,
        compliantEmployees: 1,
        nonCompliantNames: ['Bob Example'],
        compliancePct: 50,
      }),
    },
    total: 4,
    avgPerWeek: 2,
    scorePct: 50,
    employeeCount: 3,
    quebecEmployeeCount: 2,
    remoteEmployeeCount: 1,
  });

  const exportData = buildAttendanceExportData({
    rows: [row],
    weeks: [week],
    isAggregateView: true,
    aggregateLabel: 'Department',
    aggregatePluralLabel: 'departments',
    filteredSummary: createSummary({
      totalEmployees: 3,
      totalDepartments: 1,
      avgOfficeDays: 2,
      complianceRate: 50,
    }),
  });

  assert.equal(exportData.mainSheet.headers[0], 'Department');
  assert.equal(exportData.mainSheet.rows[0]?.[0], 'Technology');
  assert.equal(exportData.mainSheet.rows[0]?.[6], '50%');
  assert.deepEqual(exportData.mainSheet.weekFillHexes[0], ['FEF3C7']);
  assert.equal(exportData.detailSheet?.title, 'Weekly Breakdown');
  assert.deepEqual(exportData.detailSheet?.headers.slice(0, 4), [
    'Group',
    'Week',
    'Compliance %',
    'Eligible Quebec',
  ]);
  assert.deepEqual(exportData.detailSheet?.rows[0], [
    'Technology',
    'Mar 9 - Mar 13',
    '50%',
    2,
    1,
    0,
    0,
    'Alice Example',
    'Bob Example',
    '—',
    '—',
  ]);
});

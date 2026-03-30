import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildApprovalRequestSummary,
  buildCombinedApprovalRequests,
  buildFilteredAttendanceSummary,
  buildGroupedRows,
  createEmptyWeekCell,
  filterAttendanceRows,
  getDefaultSortDirectionForKey,
  sortDisplayRows,
  type DisplayRow,
} from '../lib/office-attendance-view.ts';
import type {
  AttendanceRemoteWorkRequest,
  AttendanceRow,
  AttendanceWorkAbroadRequest,
  WeekCell,
} from '../lib/types/attendance.ts';

function createWeekCell(overrides: Partial<WeekCell> = {}): WeekCell {
  return {
    ...createEmptyWeekCell(),
    ...overrides,
  };
}

function createAttendanceRow(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    email: 'alice@example.com',
    name: 'Alice Example',
    department: 'Technology',
    managerName: 'Manager Example',
    managerEmail: 'manager@example.com',
    officeLocation: 'Quebec (Montreal Head Office)',
    hasActivTrakCoverage: true,
    approvedRemoteWorkRequest: false,
    hasStandingWfhPolicy: false,
    hasApprovedRemoteRequestInRange: false,
    hasApprovedWorkAbroadRequestInRange: false,
    hasAnyApprovedWfhCoverageInRange: false,
    remoteWorkStatusLabel: 'Standard Policy',
    weeks: {},
    total: 0,
    avgPerWeek: 0,
    compliant: false,
    trend: 'flat',
    exemptWeekCount: 0,
    ...overrides,
  };
}

function createRemoteWorkRequest(overrides: Partial<AttendanceRemoteWorkRequest> = {}): AttendanceRemoteWorkRequest {
  return {
    bambooRowId: 10,
    employeeId: '1',
    email: 'alice@example.com',
    employeeName: 'Alice Example',
    department: 'Technology',
    officeLocation: 'Quebec (Montreal Head Office)',
    requestDate: '2026-03-01',
    remoteWorkStartDate: '2026-03-10',
    remoteWorkEndDate: '2026-03-12',
    remoteWorkType: 'Scheduled Office Day Remote Work',
    reason: 'Family appointment',
    supportingDocumentationSubmitted: 'Yes',
    alternateInOfficeWorkDate: null,
    managerApprovalReceived: 'Approved',
    managerName: 'Manager Example',
    ...overrides,
  };
}

function createWorkAbroadRequest(overrides: Partial<AttendanceWorkAbroadRequest> = {}): AttendanceWorkAbroadRequest {
  return {
    bambooRowId: 20,
    employeeId: '2',
    email: 'bob@example.com',
    employeeName: 'Bob Example',
    department: 'Technology',
    officeLocation: 'Quebec (Montreal Head Office)',
    requestDate: '2026-03-02',
    workAbroadStartDate: '2026-03-17',
    workAbroadEndDate: '2026-03-28',
    remoteWorkLocationAddress: 'Casablanca',
    countryOrProvince: 'Morocco',
    reason: 'Family visit',
    workSchedule: 'Regular schedule',
    requestApproved: 'Yes',
    approvedDeclinedBy: 'HR Approver',
    ...overrides,
  };
}

test('filterAttendanceRows preserves approved and standard-only filters', () => {
  const rows = [
    createAttendanceRow({
      name: 'Alice Example',
      email: 'alice@example.com',
      hasAnyApprovedWfhCoverageInRange: true,
      hasApprovedRemoteRequestInRange: true,
    }),
    createAttendanceRow({
      name: 'Bob Example',
      email: 'bob@example.com',
      department: 'Operations',
      hasStandingWfhPolicy: true,
      hasAnyApprovedWfhCoverageInRange: false,
    }),
  ];

  const approvedOnly = filterAttendanceRows({
    rows,
    selectedDepartments: [],
    selectedLocations: [],
    isAggregateView: false,
    isApprovedRemoteWorkView: false,
    search: '',
    wfhFilter: 'approved-only',
  });
  const standardOnly = filterAttendanceRows({
    rows,
    selectedDepartments: [],
    selectedLocations: [],
    isAggregateView: false,
    isApprovedRemoteWorkView: false,
    search: '',
    wfhFilter: 'standard-only',
  });

  assert.deepEqual(approvedOnly.map((row) => row.email), ['alice@example.com']);
  assert.deepEqual(standardOnly.map((row) => row.email), ['bob@example.com']);
});

test('buildGroupedRows does not fabricate missing manager fallback employees', () => {
  const week = '2026-03-02';
  const filteredRows = [
    createAttendanceRow({
      email: 'alice@example.com',
      name: 'Alice Example',
      managerName: 'Manager Missing',
      managerEmail: 'manager@example.com',
      weeks: {
        [week]: createWeekCell({
          officeDays: 2,
          adjustedOfficeTarget: 2,
          adjustedCompliant: true,
        }),
      },
      total: 2,
    }),
  ];

  const groupedRows = buildGroupedRows({
    filteredRows,
    isManagerView: true,
    weeks: [week],
    scoredWeeks: [week],
    defaultEmployeeLocation: 'Quebec (Montreal Head Office)',
  });

  assert.equal(groupedRows.length, 1);
  assert.equal(groupedRows[0]?.employeeCount, 1);
  assert.equal(groupedRows[0]?.remoteEmployeeCount, 0);
  assert.equal(groupedRows[0]?.weeklyCompliance[week]?.exemptEmployees, 0);
  assert.deepEqual(groupedRows[0]?.weeklyCompliance[week]?.exemptNames, []);
});

test('buildGroupedRows and summary keep compliant and unknown coverage math intact', () => {
  const week = '2026-03-02';
  const filteredRows = [
    createAttendanceRow({
      email: 'alice@example.com',
      total: 2,
      weeks: {
        [week]: createWeekCell({
          officeDays: 2,
          adjustedOfficeTarget: 2,
          adjustedCompliant: true,
        }),
      },
    }),
    createAttendanceRow({
      email: 'bob@example.com',
      name: 'Bob Example',
      hasActivTrakCoverage: false,
      total: 0,
      weeks: {
        [week]: createWeekCell({
          adjustedOfficeTarget: null,
          adjustedCompliant: null,
        }),
      },
    }),
  ];

  const groupedRows = buildGroupedRows({
    filteredRows,
    isManagerView: false,
    weeks: [week],
    scoredWeeks: [week],
    defaultEmployeeLocation: 'Quebec (Montreal Head Office)',
  });
  const summary = buildFilteredAttendanceSummary({
    filteredRows,
    groupedRows,
    isAggregateView: false,
    scoredWeeks: [week],
  });

  assert.equal(groupedRows.length, 1);
  assert.equal(groupedRows[0]?.quebecEmployeeCount, 1);
  assert.equal(groupedRows[0]?.unknownCoverageCount, 1);
  assert.equal(groupedRows[0]?.weeklyCompliance[week]?.eligibleEmployees, 1);
  assert.equal(groupedRows[0]?.weeklyCompliance[week]?.compliantEmployees, 1);
  assert.equal(groupedRows[0]?.weeklyCompliance[week]?.unknownEmployees, 1);
  assert.equal(groupedRows[0]?.scorePct, 100);
  assert.equal(summary.totalEmployees, 2);
  assert.equal(summary.unknownCoverageCount, 1);
  assert.equal(summary.avgOfficeDays, 2);
  assert.equal(summary.complianceRate, 100);
});

test('buildCombinedApprovalRequests merges both request sources in date order', () => {
  const combinedAsc = buildCombinedApprovalRequests({
    filteredRemoteWorkRequests: [createRemoteWorkRequest()],
    filteredWorkAbroadRequests: [createWorkAbroadRequest()],
    sortDir: 'asc',
  });
  const combinedDesc = buildCombinedApprovalRequests({
    filteredRemoteWorkRequests: [createRemoteWorkRequest()],
    filteredWorkAbroadRequests: [createWorkAbroadRequest()],
    sortDir: 'desc',
  });
  const summary = buildApprovalRequestSummary(
    [createRemoteWorkRequest()],
    [createWorkAbroadRequest()],
  );

  assert.equal(combinedAsc[0]?.source, 'remote-work');
  assert.equal(combinedAsc[1]?.source, 'work-abroad');
  assert.equal(combinedDesc[0]?.source, 'work-abroad');
  assert.equal(combinedDesc[1]?.source, 'remote-work');
  assert.equal(summary.totalRequests, 2);
  assert.equal(summary.uniqueEmployees, 2);
});

test('sortDisplayRows keeps unknown coverage rows at the end for numeric sorts', () => {
  const rows: DisplayRow[] = [
    {
      id: 'alice@example.com',
      label: 'Alice Example',
      secondary: 'Technology',
      officeLocation: 'Quebec',
      hasActivTrakCoverage: true,
      approvedRemoteWorkRequest: false,
      hasStandingWfhPolicy: false,
      hasApprovedRemoteRequestInRange: false,
      hasApprovedWorkAbroadRequestInRange: false,
      hasAnyApprovedWfhCoverageInRange: false,
      remoteWorkStatusLabel: 'Standard Policy',
      weeks: {},
      total: 4,
      avgPerWeek: 2,
      scorePct: 100,
      trend: 'up',
    },
    {
      id: 'bob@example.com',
      label: 'Bob Example',
      secondary: 'Technology',
      officeLocation: 'Quebec',
      hasActivTrakCoverage: false,
      approvedRemoteWorkRequest: false,
      hasStandingWfhPolicy: false,
      hasApprovedRemoteRequestInRange: false,
      hasApprovedWorkAbroadRequestInRange: false,
      hasAnyApprovedWfhCoverageInRange: false,
      remoteWorkStatusLabel: 'Standard Policy',
      weeks: {},
      total: 0,
      avgPerWeek: 0,
      scorePct: 0,
      trend: 'flat',
    },
  ];

  const sorted = sortDisplayRows({
    rows,
    sortKey: 'total',
    sortDir: 'desc',
    isAggregateView: false,
  });

  assert.deepEqual(sorted.map((row) => row.id), ['alice@example.com', 'bob@example.com']);
  assert.equal(getDefaultSortDirectionForKey('total'), 'desc');
  assert.equal(getDefaultSortDirectionForKey('name'), 'asc');
});

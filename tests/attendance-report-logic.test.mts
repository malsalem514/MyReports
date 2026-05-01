import assert from 'node:assert/strict';
import test from 'node:test';
import * as attendanceReportLogic from '../lib/attendance-report-logic.ts';
import type {
  AttendanceDayAccumulator,
  AttendanceApprovalIndex,
  AttendanceEmployeeMetaRow,
} from '../lib/attendance-report-logic.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as T & { default?: T; 'module.exports'?: T }).default
    ?? (mod as T & { default?: T; 'module.exports'?: T })['module.exports']
    ?? mod);
}

const {
  calculateAttendanceWeekCell,
  createAttendanceEmployeeAccumulator,
  ensureAttendanceEmployeeAccumulator,
  toWeekDayDetails,
} = getModuleExports(attendanceReportLogic);

function createApprovalIndex(overrides: Partial<AttendanceApprovalIndex> = {}): AttendanceApprovalIndex {
  return {
    standingPolicyEmails: new Set<string>(),
    approvedRemoteRequestEmails: new Set<string>(),
    approvedWorkAbroadRequestEmails: new Set<string>(),
    approvedRemoteWorkTypesByEmail: new Map<string, Set<string>>(),
    approvedWorkAbroadCountriesByEmail: new Map<string, Set<string>>(),
    ...overrides,
  };
}

function createEmployeeMeta(overrides: Partial<AttendanceEmployeeMetaRow> = {}): AttendanceEmployeeMetaRow {
  return {
    EMAIL: 'alice@example.com',
    DISPLAY_NAME: 'Alice Example',
    DEPARTMENT: 'Technology',
    LOCATION: 'Quebec',
    MANAGER_NAME: 'Manager Example',
    MANAGER_EMAIL: 'manager@example.com',
    HAS_ACTIVTRAK_USER: 1,
    REMOTE_WORKDAY_POLICY_ASSIGNED: 0,
    ...overrides,
  };
}

test('createAttendanceEmployeeAccumulator preserves standing and temporary approval labels', () => {
  const email = 'alice@example.com';
  const approvalIndex = createApprovalIndex({
    standingPolicyEmails: new Set([email]),
    approvedRemoteRequestEmails: new Set([email]),
    approvedWorkAbroadRequestEmails: new Set([email]),
    approvedRemoteWorkTypesByEmail: new Map([[email, new Set(['Scheduled Office Day Remote Work'])]]),
    approvedWorkAbroadCountriesByEmail: new Map([[email, new Set(['Morocco'])]]),
  });

  const employee = createAttendanceEmployeeAccumulator(email, createEmployeeMeta(), approvalIndex);

  assert.equal(employee.hasStandingWfhPolicy, true);
  assert.equal(employee.hasApprovedRemoteRequestInRange, true);
  assert.equal(employee.hasApprovedWorkAbroadRequestInRange, true);
  assert.equal(employee.hasAnyApprovedWfhCoverageInRange, true);
  assert.equal(
    employee.remoteWorkStatusLabel,
    'Standing WFH Policy + Temporary Remote Work (Scheduled Office Day Remote Work) + Work Abroad / Another Province (Morocco)',
  );
});

test('createAttendanceEmployeeAccumulator treats standing policy as authorized WFH coverage', () => {
  const email = 'alice@example.com';
  const approvalIndex = createApprovalIndex({
    standingPolicyEmails: new Set([email]),
  });

  const employee = createAttendanceEmployeeAccumulator(email, createEmployeeMeta(), approvalIndex);

  assert.equal(employee.hasStandingWfhPolicy, true);
  assert.equal(employee.hasApprovedRemoteRequestInRange, false);
  assert.equal(employee.hasApprovedWorkAbroadRequestInRange, false);
  assert.equal(employee.hasAnyApprovedWfhCoverageInRange, true);
  assert.equal(employee.remoteWorkStatusLabel, 'Standing WFH Policy');
});

test('createAttendanceEmployeeAccumulator shows Bamboo arrangements that are missing approval', () => {
  const email = 'alice@example.com';
  const approvalIndex = createApprovalIndex({
    unapprovedRemoteRequestEmails: new Set([email]),
    unapprovedRemoteWorkTypesByEmail: new Map([[email, new Set(['Permanent'])]]),
  });

  const employee = createAttendanceEmployeeAccumulator(email, createEmployeeMeta(), approvalIndex);

  assert.equal(employee.hasStandingWfhPolicy, false);
  assert.equal(employee.hasApprovedRemoteRequestInRange, false);
  assert.equal(employee.hasAnyApprovedWfhCoverageInRange, false);
  assert.equal(employee.remoteWorkStatusLabel, 'Bamboo Arrangement - Approval Missing (Permanent)');
});

test('ensureAttendanceEmployeeAccumulator reuses existing accumulators', () => {
  const email = 'alice@example.com';
  const employeesByEmail = new Map();
  const approvalIndex = createApprovalIndex();

  const first = ensureAttendanceEmployeeAccumulator(
    employeesByEmail,
    email,
    createEmployeeMeta(),
    approvalIndex,
  );
  first.weeks['2026-03-16'] = calculateAttendanceWeekCell({
    currentCell: { officeDays: 2, remoteDays: 0, ptoDays: 0, days: [] },
    officeDaysRequired: 2,
    hasActivTrakCoverage: true,
    approvedCoverageWeekdays: 0,
    hasApprovedRemoteCoverage: false,
    hasApprovedWorkAbroadCoverage: false,
    exceptionLabel: null,
  });

  const second = ensureAttendanceEmployeeAccumulator(
    employeesByEmail,
    email,
    createEmployeeMeta({ DISPLAY_NAME: 'Changed Name' }),
    approvalIndex,
  );

  assert.equal(first, second);
  assert.equal(second.name, 'Alice Example');
  assert.ok(second.weeks['2026-03-16']);
});

test('toWeekDayDetails includes elapsed office window separately from activity hours', () => {
  const days: AttendanceDayAccumulator[] = [
    {
      date: '2026-03-30',
      dayLabel: 'Mon',
      location: 'Office',
      ptoType: null,
      tbsReportedHours: 8,
      activeHours: 8,
      officeDurationSeconds: 9_000,
      officeHours: 2.5,
      officeWindowHours: 7.3,
      remoteHours: 5.5,
      firstActivityAt: '2026-03-30 08:30:00',
      lastActivityAt: '2026-03-30 17:10:00',
      officeFirstActivityAt: '2026-03-30 09:00:00',
      officeLastActivityAt: '2026-03-30 16:18:00',
      officeIpMatches: new Set(['203.0.113.7', '203.0.113.2']),
    },
  ];

  const [detail] = toWeekDayDetails(days);

  assert.equal(detail?.officeWindowHours, 7.3);
  assert.equal(detail?.officeHours, 2.5);
  assert.equal(detail?.remoteHours, 5.5);
  assert.equal(detail?.officeFirstActivityAt, '2026-03-30 09:00:00');
  assert.equal(detail?.officeLastActivityAt, '2026-03-30 16:18:00');
  assert.equal(detail?.officeIpMatches, '203.0.113.2, 203.0.113.7');
});

test('calculateAttendanceWeekCell marks fully approved coverage as compliant with zero target', () => {
  const cell = calculateAttendanceWeekCell({
    currentCell: { officeDays: 0, remoteDays: 3, ptoDays: 0, days: [] },
    officeDaysRequired: 2,
    hasActivTrakCoverage: true,
    approvedCoverageWeekdays: 2,
    hasApprovedRemoteCoverage: true,
    hasApprovedWorkAbroadCoverage: false,
    exceptionLabel: 'Temporary Remote Work',
  });

  assert.equal(cell.adjustedOfficeTarget, 0);
  assert.equal(cell.adjustedCompliant, true);
  assert.equal(cell.hasApprovedWfhCoverage, true);
  assert.equal(cell.wfhExceptionType, 'temporary_full');
});

test('calculateAttendanceWeekCell reduces target for partial approved coverage', () => {
  const cell = calculateAttendanceWeekCell({
    currentCell: { officeDays: 1, remoteDays: 2, ptoDays: 0, days: [] },
    officeDaysRequired: 2,
    hasActivTrakCoverage: true,
    approvedCoverageWeekdays: 1,
    hasApprovedRemoteCoverage: false,
    hasApprovedWorkAbroadCoverage: true,
    exceptionLabel: 'Work Abroad / Another Province (Morocco)',
  });

  assert.equal(cell.adjustedOfficeTarget, 1);
  assert.equal(cell.adjustedCompliant, true);
  assert.equal(cell.wfhExceptionType, 'temporary_partial');
  assert.equal(cell.hasApprovedWorkAbroadCoverage, true);
});

test('calculateAttendanceWeekCell treats insufficient non-PTO days as PTO-excused', () => {
  const cell = calculateAttendanceWeekCell({
    currentCell: { officeDays: 0, remoteDays: 0, ptoDays: 4, days: [] },
    officeDaysRequired: 2,
    hasActivTrakCoverage: true,
    approvedCoverageWeekdays: 0,
    hasApprovedRemoteCoverage: false,
    hasApprovedWorkAbroadCoverage: false,
    exceptionLabel: null,
  });

  assert.equal(cell.adjustedOfficeTarget, null);
  assert.equal(cell.adjustedCompliant, true);
  assert.equal(cell.isPtoExcused, true);
});

test('calculateAttendanceWeekCell keeps unknown coverage neutral when ActivTrak data is missing', () => {
  const cell = calculateAttendanceWeekCell({
    currentCell: { officeDays: 0, remoteDays: 0, ptoDays: 0, days: [] },
    officeDaysRequired: 2,
    hasActivTrakCoverage: false,
    approvedCoverageWeekdays: 2,
    hasApprovedRemoteCoverage: true,
    hasApprovedWorkAbroadCoverage: false,
    exceptionLabel: 'Temporary Remote Work',
  });

  assert.equal(cell.adjustedOfficeTarget, null);
  assert.equal(cell.adjustedCompliant, null);
  assert.equal(cell.hasApprovedWfhCoverage, false);
});

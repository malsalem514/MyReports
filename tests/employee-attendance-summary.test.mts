import assert from 'node:assert/strict';
import test from 'node:test';
import * as employeeAttendanceSummary from '../lib/employee-attendance-summary.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as T & { default?: T; 'module.exports'?: T }).default
    ?? (mod as T & { default?: T; 'module.exports'?: T })['module.exports']
    ?? mod);
}

const {
  calculateEmployeeAttendanceSummary,
  isTimeOffDate,
  isWeekendDate,
  isWorkingAttendanceDay,
} = getModuleExports(employeeAttendanceSummary);

test('calculateEmployeeAttendanceSummary averages total hours over weekday non-PTO attendance days', () => {
  const summary = calculateEmployeeAttendanceSummary([
    { date: '2026-03-22', location: 'Remote', totalHours: 6.2, isPTO: false },
    { date: '2026-03-23', location: 'Remote', totalHours: 5.0, isPTO: false },
    { date: '2026-03-24', location: 'Remote', totalHours: 8.2, isPTO: false },
    { date: '2026-03-25', location: 'Remote', totalHours: 10.0, isPTO: false },
    { date: '2026-03-26', location: 'Remote', totalHours: 10.3, isPTO: false },
    { date: '2026-03-27', location: 'Remote', totalHours: 7.8, isPTO: false },
    { date: '2026-03-29', location: 'Remote', totalHours: 0.0, isPTO: false },
    { date: '2026-03-30', location: 'Office', totalHours: 8.5, isPTO: false },
    { date: '2026-03-31', location: 'Remote', totalHours: 8.7, isPTO: false },
    { date: '2026-04-01', location: 'Remote', totalHours: 9.4, isPTO: false },
    { date: '2026-04-02', location: 'Remote', totalHours: 8.1, isPTO: false },
    { date: '2026-04-05', location: 'Remote', totalHours: 2.9, isPTO: false },
    { date: '2026-04-06', location: 'Remote', totalHours: 8.6, isPTO: false },
    { date: '2026-04-07', location: 'Office', totalHours: 10.1, isPTO: false },
    { date: '2026-04-08', location: 'Remote', totalHours: 0.9, isPTO: true },
    { date: '2026-04-09', location: 'Remote', totalHours: 1.6, isPTO: true },
    { date: '2026-04-10', location: 'Unknown', totalHours: 0.0, isPTO: true },
    { date: '2026-04-13', location: 'Remote', totalHours: 4.2, isPTO: true },
    { date: '2026-04-14', location: 'Remote', totalHours: 8.7, isPTO: false },
    { date: '2026-04-15', location: 'Remote', totalHours: 8.5, isPTO: false },
    { date: '2026-04-16', location: 'Remote', totalHours: 9.0, isPTO: false },
    { date: '2026-04-17', location: 'Remote', totalHours: 8.9, isPTO: false },
    { date: '2026-04-18', location: 'Remote', totalHours: 1.0, isPTO: false },
    { date: '2026-04-19', location: 'Remote', totalHours: 0.0, isPTO: false },
  ]);

  assert.equal(summary.officeDays, 2);
  assert.equal(summary.remoteDays, 21);
  assert.equal(summary.totalHours, 146.6);
  assert.equal(summary.workingDayCount, 15);
  assert.equal(summary.avgHours.toFixed(1), '9.8');
});

test('isWorkingAttendanceDay excludes weekends and PTO days', () => {
  assert.equal(isWeekendDate('2026-04-18'), true);
  assert.equal(isWorkingAttendanceDay({ date: '2026-04-17', isPTO: false }), true);
  assert.equal(isWorkingAttendanceDay({ date: '2026-04-18', isPTO: false }), false);
  assert.equal(isWorkingAttendanceDay({ date: '2026-04-13', isPTO: true }), false);
});

test('calculateEmployeeAttendanceSummary uses non-denied time off ranges when attendance PTO flags are missing', () => {
  const timeOff = [
    { startDate: '2026-04-08', endDate: '2026-04-13', status: 'approved' },
    { startDate: '2026-04-15', endDate: '2026-04-15', status: 'denied' },
  ];
  const summary = calculateEmployeeAttendanceSummary(
    [
      { date: '2026-04-07', location: 'Office', totalHours: 10.1, isPTO: false },
      { date: '2026-04-08', location: 'Remote', totalHours: 0.9, isPTO: false },
      { date: '2026-04-09', location: 'Remote', totalHours: 1.6, isPTO: false },
      { date: '2026-04-10', location: 'Unknown', totalHours: 0.0, isPTO: false },
      { date: '2026-04-11', location: 'Remote', totalHours: 2.0, isPTO: false },
      { date: '2026-04-13', location: 'Remote', totalHours: 4.2, isPTO: false },
      { date: '2026-04-15', location: 'Remote', totalHours: 8.5, isPTO: false },
    ],
    timeOff,
  );

  assert.equal(isTimeOffDate('2026-04-08', timeOff), true);
  assert.equal(isTimeOffDate('2026-04-15', timeOff), false);
  assert.equal(summary.totalHours, 27.3);
  assert.equal(summary.workingDayCount, 2);
  assert.equal(summary.avgHours.toFixed(1), '13.7');
});

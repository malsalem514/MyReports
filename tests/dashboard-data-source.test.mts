import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardDataSource = readFileSync(new URL('../lib/dashboard-data.ts', import.meta.url), 'utf8');

test('attendance report wires alternate in-office makeup dates into fulfillment evidence', () => {
  assert.match(dashboardDataSource, /alternateInOfficeLookupByKey/);
  assert.match(dashboardDataSource, /WHERE \(\$\{alternateAttendanceFilter\.sql\}\)/);
  assert.match(dashboardDataSource, /WHERE \(\$\{alternateOfficeIpFilter\.sql\}\)/);
  assert.match(dashboardDataSource, /alternateInOfficeFulfilledByKey/);
  assert.match(dashboardDataSource, /for \(const r of alternateDailyRows\)/);
  assert.match(
    dashboardDataSource,
    /for \(const record of alternateOfficeIpActivityRows\)/,
  );
});

test('Duo reconciliation freshness comes from Duo sync state', () => {
  const functionStart = dashboardDataSource.indexOf('export async function getDuoActivTrakReconciliationReport');
  const functionEnd = dashboardDataSource.indexOf('export async function getEmployeeByEmail', functionStart);
  const duoReportSource = dashboardDataSource.slice(functionStart, functionEnd);

  assert.match(duoReportSource, /FROM TL_DUO_SYNC_STATE\s*WHERE STATE_KEY = 'auth_logs'/);
  assert.doesNotMatch(
    duoReportSource,
    /FROM TL_SYNC_LOG/,
  );
});

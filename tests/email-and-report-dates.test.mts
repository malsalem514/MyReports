import assert from 'node:assert/strict';
import test from 'node:test';
import * as emailModule from '../lib/email.ts';
import * as dateModule from '../lib/report-date-defaults.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as { default?: T }).default || mod) as T;
}

const {
  expandEmailIdentityCandidates,
  normalizeEmail,
} = getModuleExports(emailModule);
const {
  getOfficeAttendanceDefaultRange,
  toDateParam,
} = getModuleExports(dateModule);

test('ActivTrak username aliases normalize to their BambooHR email', () => {
  assert.equal(normalizeEmail('sdnatarajan'), 'sdnatarajan@jestais.com');
  assert.equal(normalizeEmail('SDNATARAJAN'), 'sdnatarajan@jestais.com');
  assert.deepEqual(
    new Set(expandEmailIdentityCandidates(['sdnatarajan@jestais.com'])),
    new Set(['sdnatarajan@jestais.com', 'sdnatarajan']),
  );
});

test('office attendance defaults include the current week through today', () => {
  const { startDate, endDate } = getOfficeAttendanceDefaultRange(
    2,
    new Date('2026-07-31T12:00:00-04:00'),
  );

  assert.equal(toDateParam(startDate), '2026-07-20');
  assert.equal(toDateParam(endDate), '2026-07-31');
  assert.equal(endDate.getHours(), 23);
  assert.equal(endDate.getMinutes(), 59);
});

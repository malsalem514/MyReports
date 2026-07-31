import assert from 'node:assert/strict';
import test from 'node:test';
import * as supervisorModule from '../lib/bamboohr-identifiers.ts';

const { getSupervisorEmployeeId } =
  ((supervisorModule as { default?: typeof supervisorModule }).default || supervisorModule);

test('prefers the BambooHR employee record ID for supervisor relationships', () => {
  assert.equal(
    getSupervisorEmployeeId({
      supervisorId: '2957',
      supervisorEId: '413',
    }),
    '413',
  );
});

test('falls back to supervisorId when supervisorEId is unavailable', () => {
  assert.equal(
    getSupervisorEmployeeId({
      supervisorId: '2957',
    }),
    '2957',
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as dataFlowHealthModule from '../lib/data-flow-health.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as T & { default?: T }).default ?? mod) as T;
}

const {
  assessDataFlowHealth,
  businessDayLag,
  getDataFreshnessMaxBusinessDays,
} = getModuleExports(dataFlowHealthModule);

test('businessDayLag ignores weekends', () => {
  assert.equal(businessDayLag(new Date(2026, 7, 14), new Date(2026, 7, 17)), 1);
});

test('data-flow health rejects sources stuck more than two business days', () => {
  const assessment = assessDataFlowHealth({
    now: new Date(2026, 7, 14, 12),
    sources: [
      { name: 'attendance', latestDate: new Date(2026, 7, 11) },
      { name: 'productivity', latestDate: new Date(2026, 7, 13) },
    ],
  });

  assert.equal(assessment.ok, false);
  assert.deepEqual(assessment.staleSources, ['attendance']);
  assert.deepEqual(assessment.missingSources, []);
});

test('data-flow health rejects missing critical sources', () => {
  const assessment = assessDataFlowHealth({
    now: new Date(2026, 7, 14),
    sources: [{ name: 'productivity', latestDate: null }],
  });

  assert.equal(assessment.ok, false);
  assert.deepEqual(assessment.missingSources, ['productivity']);
});

test('data freshness threshold accepts positive integer overrides', () => {
  assert.equal(getDataFreshnessMaxBusinessDays('4'), 4);
  assert.equal(getDataFreshnessMaxBusinessDays('0'), 2);
  assert.equal(getDataFreshnessMaxBusinessDays('invalid'), 2);
});

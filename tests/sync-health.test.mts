import assert from 'node:assert/strict';
import test from 'node:test';
import * as syncHealthModule from '../lib/sync-health.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as T & { default?: T }).default ?? mod) as T;
}

const { assessSyncHealth } = getModuleExports(syncHealthModule);

test('sync health accepts a recent successful run', () => {
  const result = assessSyncHealth({
    now: new Date('2026-08-04T14:00:00Z'),
    latestSuccessfulCompletedAt: new Date('2026-08-04T10:05:00Z'),
    latestAttemptStartedAt: new Date('2026-08-04T10:00:00Z'),
    latestAttemptStatus: 'completed',
    oldestRunningStartedAt: null,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
});

test('sync health rejects a stale latest success', () => {
  const result = assessSyncHealth({
    now: new Date('2026-08-04T14:00:00Z'),
    latestSuccessfulCompletedAt: new Date('2026-08-03T10:00:00Z'),
    latestAttemptStartedAt: new Date('2026-08-03T10:00:00Z'),
    latestAttemptStatus: 'completed',
    oldestRunningStartedAt: null,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['Latest successful sync is stale']);
});

test('sync health rejects a failed latest attempt even when prior data is fresh', () => {
  const result = assessSyncHealth({
    now: new Date('2026-08-04T14:00:00Z'),
    latestSuccessfulCompletedAt: new Date('2026-08-04T12:00:00Z'),
    latestAttemptStartedAt: new Date('2026-08-04T13:00:00Z'),
    latestAttemptStatus: 'completed_error',
    oldestRunningStartedAt: null,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['Latest sync attempt completed with errors']);
});

test('sync health rejects an orphaned running sync', () => {
  const result = assessSyncHealth({
    now: new Date('2026-08-04T14:00:00Z'),
    latestSuccessfulCompletedAt: new Date('2026-08-04T12:00:00Z'),
    latestAttemptStartedAt: new Date('2026-08-04T13:00:00Z'),
    latestAttemptStatus: 'running',
    oldestRunningStartedAt: new Date('2026-08-04T09:00:00Z'),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['A sync has been running longer than expected']);
});

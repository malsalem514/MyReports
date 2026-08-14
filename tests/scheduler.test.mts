import assert from 'node:assert/strict';
import test from 'node:test';
import * as schedulerModule from '../lib/scheduler.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as T & { default?: T }).default ?? mod) as T;
}

const {
  assertSyncSummarySucceeded,
  runWithRetry,
  shouldRetryScheduledSync,
} = getModuleExports(schedulerModule);

test('runWithRetry retries failed scheduler operations using the configured delays', async () => {
  let attempts = 0;
  const waits: number[] = [];
  const retryAttempts: number[] = [];

  await runWithRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('temporary outage');
    },
    [10, 20, 30],
    async (delayMs) => { waits.push(delayMs); },
    ({ attempt }) => { retryAttempts.push(attempt); },
  );

  assert.equal(attempts, 3);
  assert.deepEqual(waits, [10, 20]);
  assert.deepEqual(retryAttempts, [1, 2]);
});

test('runWithRetry surfaces the final scheduler failure after retries are exhausted', async () => {
  let attempts = 0;
  await assert.rejects(
    runWithRetry(
      async () => {
        attempts += 1;
        throw new Error('still unavailable');
      },
      [10, 20],
      async () => {},
    ),
    /still unavailable/,
  );
  assert.equal(attempts, 3);
});

test('runWithRetry stops immediately for permanent authentication failures', async () => {
  let attempts = 0;
  const waits: number[] = [];

  await assert.rejects(
    runWithRetry(
      async () => {
        attempts += 1;
        throw new Error('invalid_grant: Account has been deleted');
      },
      [10, 20],
      async (delayMs) => { waits.push(delayMs); },
      undefined,
      shouldRetryScheduledSync,
    ),
    /invalid_grant/,
  );

  assert.equal(attempts, 1);
  assert.deepEqual(waits, []);
});

test('partial sync summaries fail the scheduled operation', () => {
  assert.doesNotThrow(() => assertSyncSummarySucceeded({ errors: [] }));
  assert.throws(
    () => assertSyncSummarySucceeded({ errors: ['Productivity sync failed: temporary outage'] }),
    /scheduled sync completed with 1 error/i,
  );
});

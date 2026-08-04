import assert from 'node:assert/strict';
import test from 'node:test';
import * as schedulerModule from '../lib/scheduler.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as T & { default?: T }).default ?? mod) as T;
}

const { runWithRetry } = getModuleExports(schedulerModule);

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

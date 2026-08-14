import assert from 'node:assert/strict';
import test from 'node:test';
import * as oracleModule from '../lib/oracle.ts';

const { runOracleTransaction } = oracleModule.default ?? oracleModule;

test('runOracleTransaction commits successful operations', async () => {
  const calls: string[] = [];
  const result = await runOracleTransaction(
    {
      async commit() { calls.push('commit'); },
      async rollback() { calls.push('rollback'); },
    },
    async () => {
      calls.push('operation');
      return 42;
    },
  );

  assert.equal(result, 42);
  assert.deepEqual(calls, ['operation', 'commit']);
});

test('runOracleTransaction rolls back and preserves the original error', async () => {
  const calls: string[] = [];
  const expected = new Error('insert failed');

  await assert.rejects(
    runOracleTransaction(
      {
        async commit() { calls.push('commit'); },
        async rollback() { calls.push('rollback'); },
      },
      async () => {
        calls.push('operation');
        throw expected;
      },
    ),
    (error) => error === expected,
  );

  assert.deepEqual(calls, ['operation', 'rollback']);
});

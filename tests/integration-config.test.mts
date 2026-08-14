import assert from 'node:assert/strict';
import test from 'node:test';
import * as configModule from '../lib/integration-config.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as T & { default?: T }).default ?? mod) as T;
}

const {
  DEFAULT_BIGQUERY_QUERY_TIMEOUT_MS,
  DEFAULT_EXTERNAL_HTTP_TIMEOUT_MS,
  DEFAULT_ORACLE_CALL_TIMEOUT_MS,
  DEFAULT_ORACLE_QUEUE_TIMEOUT_MS,
  getIntegrationTimeouts,
} = getModuleExports(configModule);

test('integration timeouts use bounded production defaults', () => {
  assert.deepEqual(getIntegrationTimeouts({}), {
    externalHttpMs: DEFAULT_EXTERNAL_HTTP_TIMEOUT_MS,
    bigQueryQueryMs: DEFAULT_BIGQUERY_QUERY_TIMEOUT_MS,
    oracleCallMs: DEFAULT_ORACLE_CALL_TIMEOUT_MS,
    oracleQueueMs: DEFAULT_ORACLE_QUEUE_TIMEOUT_MS,
  });
});

test('integration timeouts accept positive overrides and reject invalid values', () => {
  assert.deepEqual(getIntegrationTimeouts({
    EXTERNAL_HTTP_TIMEOUT_MS: '45000',
    BIGQUERY_QUERY_TIMEOUT_MS: '900000',
    ORACLE_CALL_TIMEOUT_MS: '-1',
    ORACLE_QUEUE_TIMEOUT_MS: 'not-a-number',
  }), {
    externalHttpMs: 45_000,
    bigQueryQueryMs: 900_000,
    oracleCallMs: DEFAULT_ORACLE_CALL_TIMEOUT_MS,
    oracleQueueMs: DEFAULT_ORACLE_QUEUE_TIMEOUT_MS,
  });
});

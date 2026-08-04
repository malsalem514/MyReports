import assert from 'node:assert/strict';
import test from 'node:test';
import * as syncConfig from '../lib/sync-config.ts';
import * as sync from '../lib/sync.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as T & { default?: T; 'module.exports'?: T }).default
    ?? (mod as T & { default?: T; 'module.exports'?: T })['module.exports']
    ?? mod);
}

const {
  calculateDuoAuthenticationLogSyncWindow,
  calculateNextDuoAuthenticationLogCheckpoint,
} = getModuleExports(sync);
const {
  DEFAULT_SYNC_LOOKBACK_DAYS,
  getSyncDaysBackFromEnv,
  parseSyncDaysBack,
} = getModuleExports(syncConfig);

test('default sync lookback covers the longest configured TBS report window', () => {
  assert.equal(DEFAULT_SYNC_LOOKBACK_DAYS, 112);
  assert.equal(parseSyncDaysBack(undefined), DEFAULT_SYNC_LOOKBACK_DAYS);
  assert.equal(parseSyncDaysBack('42'), 42);
  assert.equal(parseSyncDaysBack('0'), DEFAULT_SYNC_LOOKBACK_DAYS);
  assert.equal(getSyncDaysBackFromEnv({ SYNC_DAYS_BACK: '113.2' }), 114);
});

test('calculateDuoAuthenticationLogSyncWindow reopens a rolling overlap after a checkpoint', () => {
  const now = new Date('2026-06-08T12:00:00Z');
  const checkpointMs = Date.parse('2026-06-08T10:00:00Z');
  const window = calculateDuoAuthenticationLogSyncWindow({
    startDate: new Date('2026-05-01T00:00:00Z'),
    now,
    checkpointMs,
  });

  assert.equal(window.mintimeMs, Date.parse('2026-06-07T10:00:00Z'));
  assert.equal(window.maxtimeMs, Date.parse('2026-06-08T11:58:00Z'));
});

test('calculateNextDuoAuthenticationLogCheckpoint advances empty windows without moving backwards', () => {
  const checkpointMs = Date.parse('2026-06-08T10:00:00Z');
  const maxtimeMs = Date.parse('2026-06-08T11:58:00Z');

  assert.equal(
    calculateNextDuoAuthenticationLogCheckpoint({
      checkpointMs,
      maxtimeMs,
      newestTimestampMs: null,
    }),
    maxtimeMs,
  );
  assert.equal(
    calculateNextDuoAuthenticationLogCheckpoint({
      checkpointMs: maxtimeMs,
      maxtimeMs: checkpointMs,
      newestTimestampMs: null,
    }),
    maxtimeMs,
  );
});

test('calculateNextDuoAuthenticationLogCheckpoint advances duplicate-only overlap windows', () => {
  const checkpointMs = Date.parse('2026-06-08T10:00:00Z');
  const maxtimeMs = Date.parse('2026-06-08T11:58:00Z');
  const duplicateOnlyNewestTimestampMs = Date.parse('2026-06-08T09:30:00Z');

  assert.equal(
    calculateNextDuoAuthenticationLogCheckpoint({
      checkpointMs,
      maxtimeMs,
      newestTimestampMs: duplicateOnlyNewestTimestampMs,
    }),
    maxtimeMs,
  );
});

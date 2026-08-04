import {
  DEFAULT_OFFICE_ATTENDANCE_LOOKBACK_WEEKS,
  LOOKBACK_OPTIONS,
} from './constants';

const WORKING_HOURS_DEFAULT_LOOKBACK_DAYS = 30;
const MAX_REPORT_LOOKBACK_DAYS = Math.max(
  WORKING_HOURS_DEFAULT_LOOKBACK_DAYS,
  DEFAULT_OFFICE_ATTENDANCE_LOOKBACK_WEEKS * 7,
  Math.max(...LOOKBACK_OPTIONS) * 7,
);

export const DEFAULT_SYNC_LOOKBACK_DAYS = MAX_REPORT_LOOKBACK_DAYS;

interface SyncEnv {
  [key: string]: string | undefined;
  SYNC_DAYS_BACK?: string;
}

export function parseSyncDaysBack(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return DEFAULT_SYNC_LOOKBACK_DAYS;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SYNC_LOOKBACK_DAYS;

  return Math.ceil(parsed);
}

export function getSyncDaysBackFromEnv(
  env: SyncEnv = process.env,
): number {
  return parseSyncDaysBack(env.SYNC_DAYS_BACK);
}

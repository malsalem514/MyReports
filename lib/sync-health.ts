export const MAX_SUCCESSFUL_SYNC_AGE_MS = 26 * 60 * 60 * 1000;
export const MAX_RUNNING_SYNC_AGE_MS = 4 * 60 * 60 * 1000;

export interface SyncHealthInput {
  now: Date;
  latestSuccessfulCompletedAt: Date | null;
  latestAttemptStartedAt: Date | null;
  latestAttemptStatus: string | null;
  oldestRunningStartedAt: Date | null;
  maxSuccessfulSyncAgeMs?: number;
  maxRunningSyncAgeMs?: number;
}

export interface SyncHealthAssessment {
  ok: boolean;
  latestSuccessfulCompletedAt: string | null;
  latestAttemptStartedAt: string | null;
  latestAttemptStatus: string | null;
  oldestRunningStartedAt: string | null;
  successfulSyncAgeMs: number | null;
  runningSyncAgeMs: number | null;
  reasons: string[];
}

function toTimestamp(value: Date | null): number | null {
  if (!value) return null;
  const timestamp = value.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toIsoString(value: Date | null): string | null {
  const timestamp = toTimestamp(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

export function assessSyncHealth(input: SyncHealthInput): SyncHealthAssessment {
  const nowMs = input.now.getTime();
  const latestSuccessMs = toTimestamp(input.latestSuccessfulCompletedAt);
  const oldestRunningMs = toTimestamp(input.oldestRunningStartedAt);
  const successfulSyncAgeMs = latestSuccessMs === null
    ? null
    : Math.max(0, nowMs - latestSuccessMs);
  const runningSyncAgeMs = oldestRunningMs === null
    ? null
    : Math.max(0, nowMs - oldestRunningMs);
  const maxSuccessfulSyncAgeMs = input.maxSuccessfulSyncAgeMs ?? MAX_SUCCESSFUL_SYNC_AGE_MS;
  const maxRunningSyncAgeMs = input.maxRunningSyncAgeMs ?? MAX_RUNNING_SYNC_AGE_MS;
  const reasons: string[] = [];

  if (successfulSyncAgeMs === null) {
    reasons.push('No successful sync has been recorded');
  } else if (successfulSyncAgeMs > maxSuccessfulSyncAgeMs) {
    reasons.push('Latest successful sync is stale');
  }

  if (input.latestAttemptStatus === 'completed_error') {
    reasons.push('Latest sync attempt completed with errors');
  }

  if (runningSyncAgeMs !== null && runningSyncAgeMs > maxRunningSyncAgeMs) {
    reasons.push('A sync has been running longer than expected');
  }

  return {
    ok: reasons.length === 0,
    latestSuccessfulCompletedAt: toIsoString(input.latestSuccessfulCompletedAt),
    latestAttemptStartedAt: toIsoString(input.latestAttemptStartedAt),
    latestAttemptStatus: input.latestAttemptStatus,
    oldestRunningStartedAt: toIsoString(input.oldestRunningStartedAt),
    successfulSyncAgeMs,
    runningSyncAgeMs,
    reasons,
  };
}

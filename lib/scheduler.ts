import cron from 'node-cron';
import { validateGoogleCredentialFile } from './google-credentials';
import { initializeSchema } from './oracle';
import { getSyncDaysBackFromEnv } from './sync-config';

let schedulerInitialized = false;

export const SCHEDULED_SYNC_RETRY_DELAYS_MS = Object.freeze(
  Array.from({ length: 12 }, () => 30 * 60 * 1000),
);

type Sleep = (delayMs: number) => Promise<void>;

const PERMANENT_SYNC_ERROR_PATTERNS = [
  /invalid_grant/i,
  /account has been deleted/i,
  /credential.*(?:deleted|disabled|expired|revoked)/i,
  /missing required .*configuration/i,
  /must use a google service account/i,
];

export class ScheduledSyncError extends Error {
  readonly syncErrors: readonly string[];

  constructor(syncErrors: readonly string[]) {
    super(`Scheduled sync completed with ${syncErrors.length} error(s): ${syncErrors.join(' | ')}`);
    this.name = 'ScheduledSyncError';
    this.syncErrors = syncErrors;
  }
}

export function assertSyncSummarySucceeded(summary: { errors: readonly string[] }): void {
  if (summary.errors.length > 0) {
    throw new ScheduledSyncError(summary.errors);
  }
}

export function shouldRetryScheduledSync(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return !PERMANENT_SYNC_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runWithRetry(
  operation: () => Promise<void>,
  retryDelaysMs: readonly number[],
  wait: Sleep = sleep,
  onRetry?: (details: { attempt: number; delayMs: number; error: unknown }) => void,
  shouldRetry: (error: unknown) => boolean = () => true,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      if (!shouldRetry(error)) throw error;
      const delayMs = retryDelaysMs[attempt - 1];
      if (delayMs === undefined) throw error;
      onRetry?.({ attempt, delayMs, error });
      await wait(delayMs);
    }
  }
}

export function initializeScheduler(): void {
  if (schedulerInitialized) return;

  const explicitlyDisabled = process.env.ENABLE_SCHEDULER === 'false';
  const enabledInDevelopment = process.env.ENABLE_SCHEDULER === 'true';
  if (explicitlyDisabled || (process.env.NODE_ENV !== 'production' && !enabledInDevelopment)) {
    console.log('Scheduler disabled. Set ENABLE_SCHEDULER=true to enable.');
    return;
  }

  console.log('Initializing data sync scheduler...');
  validateGoogleCredentialFile();
  const daysBack = getSyncDaysBackFromEnv();

  // 6 AM — daily source exports and Oracle refresh
  cron.schedule('0 6 * * *', async () => {
    try {
      await runWithRetry(
        () => runFullSync(daysBack),
        SCHEDULED_SYNC_RETRY_DELAYS_MS,
        sleep,
        ({ attempt, delayMs, error }) => {
          console.error(
            `[Scheduler] 6 AM sync attempt ${attempt} failed; retrying in ${delayMs / 60000} minutes:`,
            error,
          );
        },
        shouldRetryScheduledSync,
      );
    } catch (error) {
      console.error('[Scheduler] 6 AM sync failed after all retries:', error);
    }
  }, {
    timezone: 'America/Toronto',
    noOverlap: true,
    name: 'myreports-daily-full-sync',
  });

  schedulerInitialized = true;
  console.log(`Scheduler initialized. Syncs the last ${daysBack} day(s) once daily at 6 AM ET.`);
}

export async function initializeDataStore(runBackfill: boolean = false): Promise<void> {
  await initializeSchema();
  if (runBackfill) {
    await runFullSync(90);
  }
}

async function runFullSync(daysBack: number): Promise<void> {
  const { runFullSync: runSync } = await import('./sync');
  const summary = await runSync(daysBack);
  assertSyncSummarySucceeded(summary);
}

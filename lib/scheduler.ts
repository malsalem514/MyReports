import cron from 'node-cron';
import { initializeSchema } from './oracle';
import { getSyncDaysBackFromEnv } from './sync-config';

let schedulerInitialized = false;

export const SCHEDULED_SYNC_RETRY_DELAYS_MS = Object.freeze(
  Array.from({ length: 12 }, () => 30 * 60 * 1000),
);

type Sleep = (delayMs: number) => Promise<void>;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runWithRetry(
  operation: () => Promise<void>,
  retryDelaysMs: readonly number[],
  wait: Sleep = sleep,
  onRetry?: (details: { attempt: number; delayMs: number; error: unknown }) => void,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      const delayMs = retryDelaysMs[attempt - 1];
      if (delayMs === undefined) throw error;
      onRetry?.({ attempt, delayMs, error });
      await wait(delayMs);
    }
  }
}

export function initializeScheduler(): void {
  if (schedulerInitialized) return;

  if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_SCHEDULER !== 'true') {
    console.log('Scheduler disabled in development. Set ENABLE_SCHEDULER=true to enable.');
    return;
  }

  console.log('Initializing data sync scheduler...');
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
      );
    } catch (error) {
      console.error('[Scheduler] 6 AM sync failed after all retries:', error);
    }
  }, { timezone: 'America/Toronto' });

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
  await runSync(daysBack);
}

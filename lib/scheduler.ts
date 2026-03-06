import cron from 'node-cron';
import { initializeSchema } from './oracle';

let schedulerInitialized = false;

export function initializeScheduler(): void {
  if (schedulerInitialized) return;

  if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_SCHEDULER !== 'true') {
    console.log('Scheduler disabled in development. Set ENABLE_SCHEDULER=true to enable.');
    return;
  }

  console.log('Initializing data sync scheduler...');

  // 6 AM — daily ActivTrak export and Oracle refresh
  cron.schedule('0 6 * * *', async () => {
    try { await runFullSync(7); } catch (e) { console.error('[Scheduler] 6 AM sync failed:', e); }
  }, { timezone: 'America/Toronto' });

  schedulerInitialized = true;
  console.log('Scheduler initialized. Syncs once daily at 6 AM ET.');
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

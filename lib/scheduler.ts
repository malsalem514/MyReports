import cron from 'node-cron';
import { runFullSync } from './sync';
import { initializeSchema } from './oracle';

let schedulerInitialized = false;

export function initializeScheduler(): void {
  if (schedulerInitialized) return;

  if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_SCHEDULER !== 'true') {
    console.log('Scheduler disabled in development. Set ENABLE_SCHEDULER=true to enable.');
    return;
  }

  console.log('Initializing data sync scheduler...');

  // 6 AM — full 7-day sync
  cron.schedule('0 6 * * *', async () => {
    try { await runFullSync(7); } catch (e) { console.error('[Scheduler] 6 AM sync failed:', e); }
  }, { timezone: 'America/Toronto' });

  // 12 PM — quick refresh
  cron.schedule('0 12 * * *', async () => {
    try { await runFullSync(1); } catch (e) { console.error('[Scheduler] 12 PM sync failed:', e); }
  }, { timezone: 'America/Toronto' });

  // 3 PM — quick refresh
  cron.schedule('0 15 * * *', async () => {
    try { await runFullSync(1); } catch (e) { console.error('[Scheduler] 3 PM sync failed:', e); }
  }, { timezone: 'America/Toronto' });

  schedulerInitialized = true;
  console.log('Scheduler initialized. Syncs at 6 AM, 12 PM, 3 PM ET.');
}

export async function initializeDataStore(runBackfill: boolean = false): Promise<void> {
  await initializeSchema();
  if (runBackfill) {
    await runFullSync(90);
  }
}

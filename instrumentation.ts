export async function register() {
  // Only run in Node.js server runtime — not edge runtime, not client
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Initialize Oracle schema on every startup (idempotent — safe to re-run)
  try {
    const { initializeDataStore } = await import('./lib/scheduler');
    await initializeDataStore(false);
  } catch (err) {
    // Log but don't crash — app should start even if Oracle is temporarily down
    console.error('[startup] Schema initialization failed:', err);
  }

  // Start the cron scheduler
  try {
    const { initializeScheduler } = await import('./lib/scheduler');
    initializeScheduler();
  } catch (err) {
    console.error('[startup] Scheduler initialization failed:', err);
  }
}

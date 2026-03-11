export async function register() {
  // Only run in Node.js server runtime — not edge runtime, not client
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const startupEnabled =
    process.env.NODE_ENV === 'production' ||
    process.env.ENABLE_SCHEDULER === 'true';

  if (!startupEnabled) {
    return;
  }

  // Initialize Oracle schema on every startup (idempotent — safe to re-run)
  try {
    const { initializeSchema } = await (0, eval)('import("./lib/oracle.js")');
    await initializeSchema();
  } catch (err) {
    // Log but don't crash — app should start even if Oracle is temporarily down
    console.error('[startup] Schema initialization failed:', err);
  }

  // Start the cron scheduler
  try {
    const { initializeScheduler } = await (0, eval)('import("./lib/scheduler.js")');
    initializeScheduler();
  } catch (err) {
    console.error('[startup] Scheduler initialization failed:', err);
  }
}

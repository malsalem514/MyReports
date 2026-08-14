export async function registerNodeInstrumentation(): Promise<void> {
  const startupEnabled =
    (process.env.NODE_ENV === 'production' && process.env.ENABLE_SCHEDULER !== 'false') ||
    process.env.ENABLE_SCHEDULER === 'true';

  if (!startupEnabled) return;

  try {
    const { initializeSchema } = await import('./lib/oracle');
    await initializeSchema();
  } catch (error) {
    // Keep the web app available during a temporary Oracle startup outage.
    console.error('[startup] Schema initialization failed:', error);
  }

  try {
    const { initializeScheduler } = await import('./lib/scheduler');
    initializeScheduler();
  } catch (error) {
    console.error('[startup] Scheduler initialization failed:', error);
  }
}

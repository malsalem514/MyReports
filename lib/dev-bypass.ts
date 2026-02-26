const isProd = process.env.NODE_ENV === 'production';
const bypassRequested = process.env.DEV_BYPASS_AUTH === 'true';
const bypassEmail = process.env.DEV_BYPASS_EMAIL?.trim() || '';

const warned = new Set<string>();

function warnOnce(scope: string, message: string): void {
  const key = `${scope}:${message}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.error(`[Auth Config][${scope}] ${message}`);
}

/**
 * Dev bypass must never be active in production.
 * If someone sets DEV_BYPASS_AUTH=true in production, we force-disable it and log clearly.
 */
export function isDevBypassEnabled(scope: string): boolean {
  if (!bypassRequested) return false;
  if (isProd) {
    warnOnce(
      scope,
      'DEV_BYPASS_AUTH=true is not allowed in production. Bypass has been disabled.',
    );
    return false;
  }
  return true;
}

/**
 * Returns bypass email only when bypass is allowed and configured.
 */
export function getDevBypassEmail(scope: string): string | null {
  if (!isDevBypassEnabled(scope)) return null;
  if (!bypassEmail) {
    warnOnce(
      scope,
      'DEV_BYPASS_AUTH=true but DEV_BYPASS_EMAIL is empty. Bypass has been ignored.',
    );
    return null;
  }
  return bypassEmail;
}

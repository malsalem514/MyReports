import crypto from 'node:crypto';
import { z } from 'zod';

const DUO_AUTH_LOG_PATH = '/admin/v2/logs/authentication';
const DEFAULT_LIMIT = 1000;
const DEFAULT_RATE_LIMIT_RETRY_MS = 65_000;
const MAX_RATE_LIMIT_RETRIES = 6;

export interface DuoAuthLog {
  accessDeviceBrowserVersion: string | null;
  accessDeviceIp: string | null;
  accessDeviceHostname: string | null;
  accessDeviceOs: string | null;
  accessDeviceOsVersion: string | null;
  accessDeviceBrowser: string | null;
  accessDeviceLocationCity: string | null;
  accessDeviceLocationCountry: string | null;
  accessDeviceLocationState: string | null;
  alias: string | null;
  applicationKey: string | null;
  applicationName: string | null;
  authDeviceIp: string | null;
  authDeviceKey: string | null;
  authDeviceName: string | null;
  destinationName: string | null;
  email: string | null;
  eventType: string | null;
  factor: string | null;
  isotimestamp: string | null;
  raw: Record<string, unknown>;
  reason: string | null;
  result: string | null;
  timestamp: number;
  trustedEndpointStatus: string | null;
  txid: string;
  userKey: string | null;
  username: string | null;
}

export interface DuoFetchResult {
  logs: DuoAuthLog[];
  newestTimestampMs: number | null;
}

interface DuoConfig {
  host: string;
  ikey: string;
  skey: string;
}

const DuoLocationSchema = z
  .object({
    city: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
  })
  .passthrough();

const DuoAuthenticationLogSchema = z
  .object({
    access_device: z
      .object({
        browser: z.string().nullable().optional(),
        browser_version: z.string().nullable().optional(),
        hostname: z.string().nullable().optional(),
        ip: z.string().nullable().optional(),
        location: DuoLocationSchema.nullable().optional(),
        os: z.string().nullable().optional(),
        os_version: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    alias: z.string().nullable().optional(),
    application: z
      .object({
        destination_name: z.string().nullable().optional(),
        key: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    auth_device: z
      .object({
        ip: z.string().nullable().optional(),
        key: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    email: z.string().nullable().optional(),
    event_type: z.string().nullable().optional(),
    factor: z.string().nullable().optional(),
    isotimestamp: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    result: z.string().nullable().optional(),
    timestamp: z.number(),
    trusted_endpoint_status: z.string().nullable().optional(),
    txid: z.string(),
    user: z
      .object({
        key: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const DuoResponseSchema = z.object({
  stat: z.literal('OK'),
  response: z.object({
    authlogs: z.array(DuoAuthenticationLogSchema),
    metadata: z
      .object({
        next_offset: z.union([z.string(), z.array(z.string())]).nullable().optional(),
      })
      .passthrough()
      .optional(),
  }),
});

export function isDuoConfigured(): boolean {
  return Boolean(
    process.env.DUO_IKEY?.trim() &&
      process.env.DUO_SKEY?.trim() &&
      process.env.DUO_HOST?.trim(),
  );
}

export async function fetchDuoAuthenticationLogs(
  mintimeMs: number,
  maxtimeMs: number,
): Promise<DuoFetchResult> {
  const config = getDuoConfig();
  const logs: DuoAuthLog[] = [];
  let newestTimestampMs: number | null = null;
  let nextOffset: string | null = null;

  do {
    const params: Record<string, string | number> = {
      event_types: 'authentication',
      limit: DEFAULT_LIMIT,
      maxtime: maxtimeMs,
      mintime: mintimeMs,
      sort: 'ts:asc',
    };

    if (nextOffset) {
      params.next_offset = nextOffset;
    }

    const page = await fetchDuoAuthenticationLogPage(config, params);
    logs.push(...page.logs);

    for (const log of page.logs) {
      const timestampMs = log.timestamp * 1000;
      if (newestTimestampMs === null || timestampMs > newestTimestampMs) {
        newestTimestampMs = timestampMs;
      }
    }

    nextOffset = page.nextOffset;
    if (nextOffset) {
      await sleep(getPageDelayMs());
    }
  } while (nextOffset);

  return { logs, newestTimestampMs };
}

function getDuoConfig(): DuoConfig {
  const host = process.env.DUO_HOST?.trim().toLowerCase();
  const ikey = process.env.DUO_IKEY?.trim();
  const skey = process.env.DUO_SKEY?.trim();
  const missing = [
    !host ? 'DUO_HOST' : null,
    !ikey ? 'DUO_IKEY' : null,
    !skey ? 'DUO_SKEY' : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required Duo configuration: ${missing.join(', ')}`);
  }

  return { host: host!, ikey: ikey!, skey: skey! };
}

async function fetchDuoAuthenticationLogPage(
  config: DuoConfig,
  params: Record<string, string | number>,
): Promise<{ logs: DuoAuthLog[]; nextOffset: string | null }> {
  let response: Response;
  let body: unknown;

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const date = new Date().toUTCString();
    const canonicalParams = canonicalizeParams(params);
    const signature = signDuoRequest(config, date, 'GET', DUO_AUTH_LOG_PATH, canonicalParams);
    const url = `https://${config.host}${DUO_AUTH_LOG_PATH}?${canonicalParams}`;

    response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.ikey}:${signature}`).toString('base64')}`,
        Date: date,
      },
    });
    body = await response.json().catch(() => null) as unknown;

    if (response.ok) {
      break;
    }

    const message = extractDuoError(body) || `HTTP ${response.status}`;
    if (!isRateLimitResponse(response.status, body) || attempt === MAX_RATE_LIMIT_RETRIES) {
      throw new Error(`Duo authentication logs request failed: ${message}`);
    }

    const retryMs = getRetryDelayMs(response) || DEFAULT_RATE_LIMIT_RETRY_MS;
    console.warn(`[Duo] Rate limited fetching authentication logs. Retrying in ${Math.round(retryMs / 1000)}s.`);
    await sleep(retryMs);
  }

  if (!response!.ok) {
    const message = extractDuoError(body) || `HTTP ${response!.status}`;
    throw new Error(`Duo authentication logs request failed: ${message}`);
  }

  const parsed = DuoResponseSchema.parse(body);
  const nextOffset = parsed.response.metadata?.next_offset;

  return {
    logs: parsed.response.authlogs.map(toDuoAuthLog),
    nextOffset: Array.isArray(nextOffset) ? nextOffset.join(',') : nextOffset || null,
  };
}

function signDuoRequest(
  config: DuoConfig,
  date: string,
  method: string,
  path: string,
  canonicalParams: string,
): string {
  const canonical = [date, method, config.host, path, canonicalParams].join('\n');
  return crypto.createHmac('sha1', config.skey).update(canonical).digest('hex');
}

function canonicalizeParams(params: Record<string, string | number>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeDuoComponent(key)}=${encodeDuoComponent(String(params[key]))}`)
    .join('&');
}

function encodeDuoComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function toDuoAuthLog(raw: z.infer<typeof DuoAuthenticationLogSchema>): DuoAuthLog {
  return {
    accessDeviceBrowserVersion: raw.access_device?.browser_version || null,
    accessDeviceIp: raw.access_device?.ip || null,
    accessDeviceHostname: raw.access_device?.hostname || null,
    accessDeviceOs: raw.access_device?.os || null,
    accessDeviceOsVersion: raw.access_device?.os_version || null,
    accessDeviceBrowser: raw.access_device?.browser || null,
    accessDeviceLocationCity: raw.access_device?.location?.city || null,
    accessDeviceLocationCountry: raw.access_device?.location?.country || null,
    accessDeviceLocationState: raw.access_device?.location?.state || null,
    alias: raw.alias || null,
    applicationKey: raw.application?.key || null,
    applicationName: raw.application?.name || null,
    authDeviceIp: raw.auth_device?.ip || null,
    authDeviceKey: raw.auth_device?.key || null,
    authDeviceName: raw.auth_device?.name || null,
    destinationName: raw.application?.destination_name || null,
    email: raw.email || null,
    eventType: raw.event_type || null,
    factor: raw.factor || null,
    isotimestamp: raw.isotimestamp || null,
    raw,
    reason: raw.reason || null,
    result: raw.result || null,
    timestamp: raw.timestamp,
    trustedEndpointStatus: raw.trusted_endpoint_status || null,
    txid: raw.txid,
    userKey: raw.user?.key || null,
    username: raw.user?.name || null,
  };
}

function extractDuoError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : null;
  const code = typeof record.code === 'number' || typeof record.code === 'string' ? String(record.code) : null;
  return [code, message].filter(Boolean).join(' ') || null;
}

function isRateLimitResponse(status: number, body: unknown): boolean {
  if (status === 429) return true;
  if (!body || typeof body !== 'object') return false;
  const code = (body as Record<string, unknown>).code;
  return code === 42901 || code === '42901';
}

function getRetryDelayMs(response: Response): number | null {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return null;
  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  const retryAfterDate = new Date(retryAfter);
  const delayMs = retryAfterDate.getTime() - Date.now();
  return Number.isFinite(delayMs) && delayMs > 0 ? delayMs : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPageDelayMs(): number {
  const configuredDelay = Number(process.env.DUO_PAGE_DELAY_MS || 0);
  return Number.isFinite(configuredDelay) && configuredDelay > 0 ? configuredDelay : 0;
}

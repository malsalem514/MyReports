interface IntegrationEnv {
  [key: string]: string | undefined;
  EXTERNAL_HTTP_TIMEOUT_MS?: string;
  BIGQUERY_QUERY_TIMEOUT_MS?: string;
  ORACLE_CALL_TIMEOUT_MS?: string;
  ORACLE_QUEUE_TIMEOUT_MS?: string;
}

export const DEFAULT_EXTERNAL_HTTP_TIMEOUT_MS = 30_000;
export const DEFAULT_BIGQUERY_QUERY_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_ORACLE_CALL_TIMEOUT_MS = 2 * 60 * 1000;
export const DEFAULT_ORACLE_QUEUE_TIMEOUT_MS = 30_000;

export function parsePositiveInteger(
  value: string | number | undefined | null,
  fallback: number,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.ceil(parsed);
}

export function getIntegrationTimeouts(env: IntegrationEnv = process.env) {
  return {
    externalHttpMs: parsePositiveInteger(
      env.EXTERNAL_HTTP_TIMEOUT_MS,
      DEFAULT_EXTERNAL_HTTP_TIMEOUT_MS,
    ),
    bigQueryQueryMs: parsePositiveInteger(
      env.BIGQUERY_QUERY_TIMEOUT_MS,
      DEFAULT_BIGQUERY_QUERY_TIMEOUT_MS,
    ),
    oracleCallMs: parsePositiveInteger(
      env.ORACLE_CALL_TIMEOUT_MS,
      DEFAULT_ORACLE_CALL_TIMEOUT_MS,
    ),
    oracleQueueMs: parsePositiveInteger(
      env.ORACLE_QUEUE_TIMEOUT_MS,
      DEFAULT_ORACLE_QUEUE_TIMEOUT_MS,
    ),
  };
}

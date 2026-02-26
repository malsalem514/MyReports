import { NextRequest, NextResponse } from 'next/server';
import { query as oracleQuery } from '@/lib/oracle';
import { getBigQueryClient } from '@/lib/bigquery';

interface CheckResult {
  ok: boolean;
  error?: string;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function checkOracle(): Promise<CheckResult> {
  try {
    const rows = await oracleQuery<{ RESULT: number }>('SELECT 1 AS RESULT FROM DUAL');
    return { ok: rows[0]?.RESULT === 1 };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

async function checkBigQuery(): Promise<CheckResult> {
  try {
    const client = getBigQueryClient();
    const [rows] = await client.query({ query: 'SELECT 1 as result', location: 'US' });
    const ok = (rows[0] as { result?: number } | undefined)?.result === 1;
    return { ok };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

async function checkBambooHR(): Promise<CheckResult> {
  const apiKey = process.env.BAMBOOHR_API_KEY || '';
  const subdomain = process.env.BAMBOOHR_SUBDOMAIN || '';

  if (!apiKey || !subdomain || apiKey.toLowerCase().includes('dummy')) {
    return { ok: false, error: 'BAMBOOHR_API_KEY or BAMBOOHR_SUBDOMAIN is missing/placeholder' };
  }

  try {
    const authHeader = Buffer.from(`${apiKey}:x`).toString('base64');
    const response = await fetch(
      `https://api.bamboohr.com/api/gateway.php/${subdomain}/v1/meta/users`,
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        error: `BambooHR HTTP ${response.status} ${response.statusText}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

export async function GET(request: NextRequest) {
  const deep = request.nextUrl.searchParams.get('deep') === '1';

  if (!deep) {
    return NextResponse.json({
      status: 'ok',
      service: 'myreports',
      timestamp: new Date().toISOString(),
    });
  }

  const [oracleResult, bigQueryResult, bambooResult] = await Promise.all([
    withTimeout(checkOracle(), 2500, { ok: false, error: 'Oracle check timeout' }),
    withTimeout(checkBigQuery(), 3500, { ok: false, error: 'BigQuery check timeout' }),
    withTimeout(checkBambooHR(), 3500, { ok: false, error: 'BambooHR check timeout' }),
  ]);

  const ok = oracleResult.ok && bigQueryResult.ok && bambooResult.ok;

  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      service: 'myreports',
      timestamp: new Date().toISOString(),
      checks: {
        oracle: oracleResult.ok,
        bigQuery: bigQueryResult.ok,
        bambooHR: bambooResult.ok,
      },
      details: {
        oracle: oracleResult,
        bigQuery: bigQueryResult,
        bambooHR: bambooResult,
      },
    },
    { status: ok ? 200 : 503 },
  );
}

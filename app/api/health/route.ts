import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdminEmail } from '@/lib/admin';
import { query as oracleQuery } from '@/lib/oracle';

interface CheckResult {
  ok: boolean;
  error?: string;
  metrics?: Record<string, unknown>;
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

async function checkOracleDataFlow(): Promise<CheckResult> {
  try {
    const rows = await oracleQuery<{
      ACTIVE_EMPLOYEES: number;
      ATTENDANCE_ROWS: number;
      ATTENDANCE_MAX_DATE: Date | null;
      PRODUCTIVITY_ROWS: number;
      PRODUCTIVITY_MAX_DATE: Date | null;
      OFFICE_IP_ROWS: number;
      OFFICE_IP_MAX_DATE: Date | null;
      TBS_TIME_ENTRIES: number;
      TBS_MAX_DATE: Date | null;
      REMOTE_WORK_REQUESTS: number;
      WORK_ABROAD_REQUESTS: number;
      TIME_OFF_ROWS: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM TL_EMPLOYEES WHERE EMAIL IS NOT NULL AND (STATUS IS NULL OR UPPER(STATUS) != 'INACTIVE')) AS ACTIVE_EMPLOYEES,
         (SELECT COUNT(*) FROM TL_ATTENDANCE) AS ATTENDANCE_ROWS,
         (SELECT MAX(RECORD_DATE) FROM TL_ATTENDANCE) AS ATTENDANCE_MAX_DATE,
         (SELECT COUNT(*) FROM TL_PRODUCTIVITY) AS PRODUCTIVITY_ROWS,
         (SELECT MAX(RECORD_DATE) FROM TL_PRODUCTIVITY) AS PRODUCTIVITY_MAX_DATE,
         (SELECT COUNT(*) FROM TL_OFFICE_IP_ACTIVITY) AS OFFICE_IP_ROWS,
         (SELECT MAX(RECORD_DATE) FROM TL_OFFICE_IP_ACTIVITY) AS OFFICE_IP_MAX_DATE,
         (SELECT COUNT(*) FROM TL_TBS_TIME_ENTRIES) AS TBS_TIME_ENTRIES,
         (SELECT MAX(ENTRY_DATE) FROM TL_TBS_TIME_ENTRIES) AS TBS_MAX_DATE,
         (SELECT COUNT(*) FROM TL_REMOTE_WORK_REQUESTS) AS REMOTE_WORK_REQUESTS,
         (SELECT COUNT(*) FROM TL_WORK_ABROAD_REQUESTS) AS WORK_ABROAD_REQUESTS,
         (SELECT COUNT(*) FROM TL_TIME_OFF) AS TIME_OFF_ROWS
       FROM DUAL`,
    );

    const metrics = rows[0];
    const ok = Boolean(
      metrics &&
      metrics.ACTIVE_EMPLOYEES > 0 &&
      metrics.ATTENDANCE_ROWS > 0 &&
      metrics.PRODUCTIVITY_ROWS > 0,
    );

    return { ok, metrics };
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

  // Deep diagnostic exposes internal error messages — restrict to admins.
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!isAdminEmail(email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [oracleResult, dataFlowResult] = await Promise.all([
    withTimeout(checkOracle(), 2500, { ok: false, error: 'Oracle check timeout' }),
    withTimeout(checkOracleDataFlow(), 3500, { ok: false, error: 'Oracle data-flow check timeout' }),
  ]);

  const ok = oracleResult.ok && dataFlowResult.ok;

  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      service: 'myreports',
      timestamp: new Date().toISOString(),
      checks: {
        oracle: oracleResult.ok,
        oracleDataFlow: dataFlowResult.ok,
      },
      details: {
        oracle: oracleResult,
        oracleDataFlow: dataFlowResult,
      },
    },
    { status: ok ? 200 : 503 },
  );
}

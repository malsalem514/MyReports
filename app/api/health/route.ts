import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdminEmail } from '@/lib/admin';
import { assessDataFlowHealth, getDataFreshnessMaxBusinessDays } from '@/lib/data-flow-health';
import { query as oracleQuery } from '@/lib/oracle';
import { assessSyncHealth } from '@/lib/sync-health';

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

async function checkSyncFreshness(): Promise<CheckResult> {
  try {
    const rows = await oracleQuery<{
      LAST_SUCCESS_COMPLETED_AT: Date | null;
      LATEST_ATTEMPT_STARTED_AT: Date | null;
      LATEST_ATTEMPT_STATUS: string | null;
      OLDEST_RUNNING_STARTED_AT: Date | null;
    }>(
      `SELECT
         (SELECT MAX(COMPLETED_AT)
            FROM TL_SYNC_LOG
           WHERE STATUS = 'completed') AS LAST_SUCCESS_COMPLETED_AT,
         (SELECT STARTED_AT
            FROM (SELECT STARTED_AT FROM TL_SYNC_LOG ORDER BY STARTED_AT DESC, ID DESC)
           WHERE ROWNUM = 1) AS LATEST_ATTEMPT_STARTED_AT,
         (SELECT STATUS
            FROM (SELECT STATUS FROM TL_SYNC_LOG ORDER BY STARTED_AT DESC, ID DESC)
           WHERE ROWNUM = 1) AS LATEST_ATTEMPT_STATUS,
         (SELECT MIN(STARTED_AT)
            FROM TL_SYNC_LOG
           WHERE STATUS = 'running') AS OLDEST_RUNNING_STARTED_AT
       FROM DUAL`,
    );
    const row = rows[0];
    const assessment = assessSyncHealth({
      now: new Date(),
      latestSuccessfulCompletedAt: row?.LAST_SUCCESS_COMPLETED_AT ?? null,
      latestAttemptStartedAt: row?.LATEST_ATTEMPT_STARTED_AT ?? null,
      latestAttemptStatus: row?.LATEST_ATTEMPT_STATUS ?? null,
      oldestRunningStartedAt: row?.OLDEST_RUNNING_STARTED_AT ?? null,
    });
    return { ok: assessment.ok, metrics: { ...assessment } };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

async function checkDataFreshness(): Promise<CheckResult> {
  try {
    const rows = await oracleQuery<{
      ATTENDANCE_MAX_DATE: Date | null;
      PRODUCTIVITY_MAX_DATE: Date | null;
    }>(
      `SELECT
         (SELECT MAX(RECORD_DATE) FROM TL_ATTENDANCE) AS ATTENDANCE_MAX_DATE,
         (SELECT MAX(RECORD_DATE) FROM TL_PRODUCTIVITY) AS PRODUCTIVITY_MAX_DATE
       FROM DUAL`,
    );
    const row = rows[0];
    const assessment = assessDataFlowHealth({
      now: new Date(),
      maxBusinessDayLag: getDataFreshnessMaxBusinessDays(),
      sources: [
        { name: 'attendance', latestDate: row?.ATTENDANCE_MAX_DATE ?? null },
        { name: 'productivity', latestDate: row?.PRODUCTIVITY_MAX_DATE ?? null },
      ],
    });
    return { ok: assessment.ok, metrics: { ...assessment } };
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
      TBS_MAPPED_EMPLOYEES: number;
      TBS_UNMAPPED_ACTIVE_EMPLOYEES: number;
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
         (SELECT COUNT(*) FROM TL_TBS_EMPLOYEE_MAP) AS TBS_MAPPED_EMPLOYEES,
         (SELECT COUNT(*)
            FROM TL_EMPLOYEES e
           WHERE e.EMAIL IS NOT NULL
             AND (e.STATUS IS NULL OR UPPER(e.STATUS) != 'INACTIVE')
             AND NOT EXISTS (
               SELECT 1
                 FROM TL_TBS_EMPLOYEE_MAP m
                WHERE LOWER(m.EMAIL) = LOWER(e.EMAIL)
             )) AS TBS_UNMAPPED_ACTIVE_EMPLOYEES,
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
      metrics.PRODUCTIVITY_ROWS > 0 &&
      metrics.TBS_MAPPED_EMPLOYEES > 0 &&
      metrics.TBS_TIME_ENTRIES > 0,
    );

    return { ok, metrics };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

export async function GET(request: NextRequest) {
  const deep = request.nextUrl.searchParams.get('deep') === '1';

  if (!deep) {
    const [syncResult, dataFreshnessResult] = await Promise.all([
      withTimeout(checkSyncFreshness(), 2500, { ok: false, error: 'Sync freshness check timeout' }),
      withTimeout(checkDataFreshness(), 2500, { ok: false, error: 'Data freshness check timeout' }),
    ]);
    const ok = syncResult.ok && dataFreshnessResult.ok;
    return NextResponse.json(
      {
        status: ok ? 'ok' : 'degraded',
        service: 'myreports',
        timestamp: new Date().toISOString(),
        checks: {
          syncFreshness: syncResult.ok,
          dataFreshness: dataFreshnessResult.ok,
        },
      },
      { status: ok ? 200 : 503 },
    );
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

  const [oracleResult, dataFlowResult, syncResult, dataFreshnessResult] = await Promise.all([
    withTimeout(checkOracle(), 2500, { ok: false, error: 'Oracle check timeout' }),
    withTimeout(checkOracleDataFlow(), 3500, { ok: false, error: 'Oracle data-flow check timeout' }),
    withTimeout(checkSyncFreshness(), 2500, { ok: false, error: 'Sync freshness check timeout' }),
    withTimeout(checkDataFreshness(), 2500, { ok: false, error: 'Data freshness check timeout' }),
  ]);

  const ok = oracleResult.ok && dataFlowResult.ok && syncResult.ok && dataFreshnessResult.ok;

  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      service: 'myreports',
      timestamp: new Date().toISOString(),
      checks: {
        oracle: oracleResult.ok,
        oracleDataFlow: dataFlowResult.ok,
        syncFreshness: syncResult.ok,
        dataFreshness: dataFreshnessResult.ok,
      },
      details: {
        oracle: oracleResult,
        oracleDataFlow: dataFlowResult,
        syncFreshness: syncResult,
        dataFreshness: dataFreshnessResult,
      },
    },
    { status: ok ? 200 : 503 },
  );
}

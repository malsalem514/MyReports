import { Suspense } from 'react';
import { sub } from 'date-fns';
import { getAccessContext } from '@/lib/access';
import { getAttendanceReport } from '@/lib/dashboard-data';
import { OFFICE_DAYS_REQUIRED, DEFAULT_LOOKBACK_WEEKS, LOOKBACK_OPTIONS } from '@/lib/constants';
import { AttendanceClient } from './attendance-client';

async function AttendanceData({ lookbackWeeks }: { lookbackWeeks: number }) {
  const endDate = new Date();
  const startDate = sub(endDate, { weeks: lookbackWeeks });

  const access = await getAccessContext();
  const allowedEmails = access.isHRAdmin ? undefined : access.allowedEmails;

  try {
    const { rows, weeks, currentWeek, departments, locations, summary } = await getAttendanceReport(
      startDate,
      endDate,
      OFFICE_DAYS_REQUIRED,
      allowedEmails,
    );

    return (
      <AttendanceClient
        rows={rows}
        weeks={weeks}
        currentWeek={currentWeek}
        departments={departments}
        locations={locations}
        summary={summary}
        lookbackWeeks={lookbackWeeks}
        validationEnabled
      />
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Attendance datasource unavailable';
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          Attendance data is currently unavailable. {message}
        </div>
        <AttendanceClient
          rows={[]}
          weeks={[]}
          departments={[]}
          locations={[]}
          summary={{ totalEmployees: 0, avgOfficeDays: 0, complianceRate: 0, zeroOfficeDaysCount: 0 }}
          lookbackWeeks={lookbackWeeks}
          validationEnabled={false}
        />
      </div>
    );
  }
}

function AttendanceSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex justify-between">
        <div><div className="h-5 w-40 rounded bg-gray-200" /><div className="mt-1 h-3 w-56 rounded bg-gray-100" /></div>
        <div className="flex gap-2"><div className="h-8 w-20 rounded bg-gray-100" /><div className="h-8 w-14 rounded bg-gray-100" /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="h-3 w-16 rounded bg-gray-100" />
            <div className="mt-2 h-7 w-12 rounded bg-gray-200" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-6"><div className="h-64 rounded bg-gray-50" /></div>
    </div>
  );
}

export default async function OfficeAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ lookbackWeeks?: string }>;
}) {
  const params = await searchParams;
  const lookbackWeeks = LOOKBACK_OPTIONS.includes(Number(params.lookbackWeeks) as any)
    ? (Number(params.lookbackWeeks) as (typeof LOOKBACK_OPTIONS)[number])
    : DEFAULT_LOOKBACK_WEEKS;

  return (
    <Suspense fallback={<AttendanceSkeleton />}>
      <AttendanceData lookbackWeeks={lookbackWeeks} />
    </Suspense>
  );
}

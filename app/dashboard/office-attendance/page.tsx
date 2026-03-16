import { Suspense } from 'react';
import { getAccessContext, getScopedReportEmails } from '@/lib/access';
import { requireVisibleTab } from '@/lib/tab-config';
import { getAttendanceReport } from '@/lib/dashboard-data';
import { OFFICE_DAYS_REQUIRED, LOOKBACK_OPTIONS } from '@/lib/constants';
import { getOfficeAttendanceDefaultRange, toDateParam } from '@/lib/report-date-defaults';
import { AttendanceClient } from './attendance-client';

const OFFICE_ATTENDANCE_DEFAULT_WEEKS = 4;

function parseDateInput(
  value: string | undefined,
  fallback: Date,
  endOfDay: boolean,
): Date {
  const parsed = value ? new Date(`${value}T00:00:00`) : new Date(fallback);
  if (Number.isNaN(parsed.getTime())) {
    const fallbackDate = new Date(fallback);
    if (endOfDay) {
      fallbackDate.setHours(23, 59, 59, 999);
    } else {
      fallbackDate.setHours(0, 0, 0, 0);
    }
    return fallbackDate;
  }
  if (endOfDay) {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }
  return parsed;
}

async function AttendanceData({
  startDate,
  endDate,
  startDateLabel,
  endDateLabel,
}: {
  startDate: Date;
  endDate: Date;
  startDateLabel: string;
  endDateLabel: string;
}) {
  const access = await getAccessContext();
  await requireVisibleTab(access.userEmail, access, 'office-attendance');
  const allowedEmails = getScopedReportEmails(access);

  try {
    const { rows, remoteWorkRequests, weeks, dataWeeks, currentWeek, departments, locations, summary } = await getAttendanceReport(
      startDate,
      endDate,
      OFFICE_DAYS_REQUIRED,
      allowedEmails,
    );

    return (
      <AttendanceClient
        rows={rows}
        remoteWorkRequests={remoteWorkRequests}
        weeks={weeks}
        dataWeeks={dataWeeks}
        currentWeek={currentWeek}
        departments={departments}
        locations={locations}
        summary={summary}
        startDate={startDateLabel}
        endDate={endDateLabel}
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
          remoteWorkRequests={[]}
          weeks={[]}
          dataWeeks={[]}
          departments={[]}
          locations={[]}
          summary={{ totalEmployees: 0, avgOfficeDays: 0, complianceRate: 0, zeroOfficeDaysCount: 0 }}
          startDate={startDateLabel}
          endDate={endDateLabel}
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
  searchParams: Promise<{ lookbackWeeks?: string; startDate?: string; endDate?: string }>;
}) {
  const params = await searchParams;
  const lookbackWeeks = LOOKBACK_OPTIONS.includes(Number(params.lookbackWeeks) as any)
    ? (Number(params.lookbackWeeks) as (typeof LOOKBACK_OPTIONS)[number])
    : OFFICE_ATTENDANCE_DEFAULT_WEEKS;
  const { startDate: fallbackStartDate, endDate: fallbackEndDate } = getOfficeAttendanceDefaultRange(lookbackWeeks);

  let startDate = parseDateInput(params.startDate, fallbackStartDate, false);
  let endDate = parseDateInput(params.endDate, fallbackEndDate, true);
  if (startDate > endDate) {
    const nextStart = new Date(endDate);
    nextStart.setHours(0, 0, 0, 0);
    const nextEnd = new Date(startDate);
    nextEnd.setHours(23, 59, 59, 999);
    startDate = nextStart;
    endDate = nextEnd;
  }

  const startDateLabel = toDateParam(startDate);
  const endDateLabel = toDateParam(endDate);

  return (
    <Suspense fallback={<AttendanceSkeleton />}>
      <AttendanceData
        startDate={startDate}
        endDate={endDate}
        startDateLabel={startDateLabel}
        endDateLabel={endDateLabel}
      />
    </Suspense>
  );
}

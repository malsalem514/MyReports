import { Suspense } from 'react';
import { getAccessContext, getScopedReportEmails } from '@/lib/access';
import { requireVisibleTab } from '@/lib/tab-config';
import { getWorkingHoursReport } from '@/lib/dashboard-data';
import { getTrailingDaysDateRange, parseDateInput, toDateParam } from '@/lib/report-date-defaults';
import { WorkingHoursClient } from './working-hours-client';

async function WorkingHoursData({
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
  await requireVisibleTab(access.userEmail, access, 'working-hours');
  const allowedEmails = getScopedReportEmails(access);

  try {
    const { weeks, groups, employeeNumbers, users, weekOptions, lastSyncedAt } = await getWorkingHoursReport(
      startDate,
      endDate,
      allowedEmails,
    );

    return (
      <WorkingHoursClient
        weeks={weeks}
        groups={groups}
        employeeNumbers={employeeNumbers}
        users={users}
        weekOptions={weekOptions}
        startDate={startDateLabel}
        endDate={endDateLabel}
        lastSyncedAt={lastSyncedAt}
      />
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Working hours datasource unavailable';
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          Working hours data is currently unavailable. {message}
        </div>
        <WorkingHoursClient
          weeks={[]}
          groups={[]}
          employeeNumbers={[]}
          users={[]}
          weekOptions={[]}
          startDate={startDateLabel}
          endDate={endDateLabel}
          lastSyncedAt={null}
        />
      </div>
    );
  }
}

function WorkingHoursSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex justify-between">
        <div><div className="h-5 w-40 rounded bg-gray-200" /><div className="mt-1 h-3 w-64 rounded bg-gray-100" /></div>
        <div className="h-8 w-16 rounded bg-gray-100" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="h-3 w-20 rounded bg-gray-100" />
            <div className="mt-2 h-7 w-14 rounded bg-gray-200" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-6"><div className="h-64 rounded bg-gray-50" /></div>
    </div>
  );
}

export default async function WorkingHoursPage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string }>;
}) {
  const params = await searchParams;

  const { startDate: defaultStartDate, endDate: defaultEndDate } = getTrailingDaysDateRange(30);

  let startDate = parseDateInput(params.startDate, defaultStartDate, false);
  let endDate = parseDateInput(params.endDate, defaultEndDate, true);

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
    <Suspense fallback={<WorkingHoursSkeleton />}>
      <WorkingHoursData
        startDate={startDate}
        endDate={endDate}
        startDateLabel={startDateLabel}
        endDateLabel={endDateLabel}
      />
    </Suspense>
  );
}

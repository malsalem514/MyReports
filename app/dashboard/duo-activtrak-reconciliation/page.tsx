import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getAccessContext } from '@/lib/access';
import { getDuoActivTrakReconciliationReport } from '@/lib/dashboard-data';
import { getTrailingDaysDateRange, parseDateInput, toDateParam } from '@/lib/report-date-defaults';
import { requireVisibleTab } from '@/lib/tab-config';
import { DuoActivTrakReconciliationClient } from './report-client';

async function DuoReconciliationData({
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
  if (!access.userEmail) {
    redirect('/login');
  }
  if (!access.isRootAdmin && !access.isHRAdmin) {
    redirect('/dashboard');
  }
  await requireVisibleTab(access.userEmail, access, 'duo-activtrak-reconciliation');

  try {
    const { rows, deviceRows, lastSyncedAt } = await getDuoActivTrakReconciliationReport(startDate, endDate);
    return (
      <DuoActivTrakReconciliationClient
        rows={rows}
        deviceRows={deviceRows}
        startDate={startDateLabel}
        endDate={endDateLabel}
        lastSyncedAt={lastSyncedAt}
      />
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Duo reconciliation report unavailable';
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          Duo reconciliation report is currently unavailable. {message}
        </div>
        <DuoActivTrakReconciliationClient
          rows={[]}
          deviceRows={[]}
          startDate={startDateLabel}
          endDate={endDateLabel}
          lastSyncedAt={null}
        />
      </div>
    );
  }
}

function DuoReconciliationSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex justify-between">
        <div>
          <div className="h-5 w-52 rounded bg-gray-200" />
          <div className="mt-1 h-3 w-80 rounded bg-gray-100" />
        </div>
        <div className="h-8 w-20 rounded bg-gray-100" />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="h-3 w-24 rounded bg-gray-100" />
            <div className="mt-2 h-7 w-14 rounded bg-gray-200" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="h-64 rounded bg-gray-50" />
      </div>
    </div>
  );
}

export default async function DuoActivTrakReconciliationPage({
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

  return (
    <Suspense fallback={<DuoReconciliationSkeleton />}>
      <DuoReconciliationData
        startDate={startDate}
        endDate={endDate}
        startDateLabel={toDateParam(startDate)}
        endDateLabel={toDateParam(endDate)}
      />
    </Suspense>
  );
}

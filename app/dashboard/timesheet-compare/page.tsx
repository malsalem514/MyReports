import { Suspense } from 'react';
import { sub } from 'date-fns';
import { getAccessContext, getScopedReportEmails } from '@/lib/access';
import { requireVisibleTab } from '@/lib/tab-config';
import { getTbsComparisonReport } from '@/lib/dashboard-data';
import { DEFAULT_LOOKBACK_WEEKS, LOOKBACK_OPTIONS } from '@/lib/constants';
import { CompareClient } from './compare-client';

async function CompareData({
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
  await requireVisibleTab(access.userEmail, access, 'timesheet-compare');
  const allowedEmails = getScopedReportEmails(access);

  try {
    const { rows, weeks, departments, summary, unmappedEmails } = await getTbsComparisonReport(
      startDate,
      endDate,
      allowedEmails,
    );

    return (
      <CompareClient
        rows={rows}
        weeks={weeks}
        departments={departments}
        summary={summary}
        unmappedEmails={unmappedEmails}
        startDate={startDateLabel}
        endDate={endDateLabel}
      />
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Timesheet datasource unavailable';
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          TBS comparison data is currently unavailable. {message}
        </div>
        <CompareClient
          rows={[]}
          weeks={[]}
          departments={[]}
          summary={{
            totalEmployees: 0,
            mappedEmployees: 0,
            unmappedEmployees: 0,
            totalDiscrepancies: 0,
            bambooPtoNotInTbs: 0,
            tbsPtoNotInBamboo: 0,
          }}
          unmappedEmails={[]}
          startDate={startDateLabel}
          endDate={endDateLabel}
        />
      </div>
    );
  }
}

function CompareSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex justify-between">
        <div><div className="h-5 w-52 rounded bg-gray-200" /><div className="mt-1 h-3 w-72 rounded bg-gray-100" /></div>
        <div className="flex gap-2"><div className="h-8 w-20 rounded bg-gray-100" /><div className="h-8 w-14 rounded bg-gray-100" /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
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

export default async function TimesheetComparePage({
  searchParams,
}: {
  searchParams: Promise<{ lookbackWeeks?: string; startDate?: string; endDate?: string }>;
}) {
  const params = await searchParams;
  const lookbackWeeks = LOOKBACK_OPTIONS.includes(Number(params.lookbackWeeks) as any)
    ? (Number(params.lookbackWeeks) as (typeof LOOKBACK_OPTIONS)[number])
    : DEFAULT_LOOKBACK_WEEKS;

  const defaultEndDate = new Date();
  defaultEndDate.setHours(23, 59, 59, 999);
  const defaultStartDate = sub(defaultEndDate, { days: (lookbackWeeks * 7) - 1 });
  defaultStartDate.setHours(0, 0, 0, 0);

  let startDate = params.startDate ? new Date(`${params.startDate}T00:00:00`) : new Date(defaultStartDate);
  let endDate = params.endDate ? new Date(`${params.endDate}T23:59:59.999`) : new Date(defaultEndDate);

  if (Number.isNaN(startDate.getTime())) startDate = new Date(defaultStartDate);
  if (Number.isNaN(endDate.getTime())) endDate = new Date(defaultEndDate);
  if (startDate > endDate) {
    const nextStart = new Date(endDate);
    nextStart.setHours(0, 0, 0, 0);
    const nextEnd = new Date(startDate);
    nextEnd.setHours(23, 59, 59, 999);
    startDate = nextStart;
    endDate = nextEnd;
  }

  const toDateParam = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  return (
    <Suspense fallback={<CompareSkeleton />}>
      <CompareData
        startDate={startDate}
        endDate={endDate}
        startDateLabel={toDateParam(startDate)}
        endDateLabel={toDateParam(endDate)}
      />
    </Suspense>
  );
}

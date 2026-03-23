import { Suspense } from 'react';
import { getAccessContext, getScopedReportEmails } from '@/lib/access';
import { requireVisibleTab } from '@/lib/tab-config';
import { getTbsComparisonReport } from '@/lib/dashboard-data';
import { DEFAULT_LOOKBACK_WEEKS } from '@/lib/constants';
import { getTrailingWeeksDateRange, parseDateInput, toDateParam } from '@/lib/report-date-defaults';
import { parseLookbackWeeks } from '@/lib/search-params';
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
  const lookbackWeeks = parseLookbackWeeks(params.lookbackWeeks, DEFAULT_LOOKBACK_WEEKS);
  const { startDate: defaultStartDate, endDate: defaultEndDate } = getTrailingWeeksDateRange(lookbackWeeks);

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

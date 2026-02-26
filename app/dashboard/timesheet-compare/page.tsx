import { Suspense } from 'react';
import { sub } from 'date-fns';
import { getAccessContext } from '@/lib/access';
import { getTbsComparisonReport } from '@/lib/dashboard-data';
import { DEFAULT_LOOKBACK_WEEKS, LOOKBACK_OPTIONS } from '@/lib/constants';
import { CompareClient } from './compare-client';

async function CompareData({ lookbackWeeks }: { lookbackWeeks: number }) {
  const endDate = new Date();
  const startDate = sub(endDate, { weeks: lookbackWeeks });

  const access = await getAccessContext();
  const allowedEmails = access.isHRAdmin ? undefined : access.allowedEmails;

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
        lookbackWeeks={lookbackWeeks}
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
          lookbackWeeks={lookbackWeeks}
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
  searchParams: Promise<{ lookbackWeeks?: string }>;
}) {
  const params = await searchParams;
  const lookbackWeeks = LOOKBACK_OPTIONS.includes(Number(params.lookbackWeeks) as any)
    ? (Number(params.lookbackWeeks) as (typeof LOOKBACK_OPTIONS)[number])
    : DEFAULT_LOOKBACK_WEEKS;

  return (
    <Suspense fallback={<CompareSkeleton />}>
      <CompareData lookbackWeeks={lookbackWeeks} />
    </Suspense>
  );
}

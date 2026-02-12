import { Suspense } from 'react';
import { getAccessContext } from '@/lib/access';
import { getPayrollAuditReport } from '@/lib/dashboard-data';
import { PayrollClient } from './payroll-client';

async function PayrollData({ lookbackWeeks }: { lookbackWeeks: number }) {
  const access = await getAccessContext();
  const allowedEmails = access.isHRAdmin ? undefined : access.allowedEmails;

  const result = await getPayrollAuditReport(lookbackWeeks, allowedEmails);

  return (
    <PayrollClient
      weeks={result.weeks}
      grandTotal={result.grandTotal}
      lookbackWeeks={result.lookbackWeeks}
      departments={result.departments}
      managers={result.managers}
    />
  );
}

function PayrollSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex justify-between">
        <div><div className="h-5 w-48 rounded bg-gray-200" /><div className="mt-1 h-3 w-64 rounded bg-gray-100" /></div>
        <div className="flex gap-2"><div className="h-8 w-32 rounded bg-gray-100" /><div className="h-8 w-16 rounded bg-gray-100" /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-xl border border-gray-200 bg-white" />)}
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-6"><div className="h-96 rounded bg-gray-50" /></div>
    </div>
  );
}

export default async function PayrollAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ lookbackWeeks?: string }>;
}) {
  const params = await searchParams;
  const lookbackWeeks = Number(params.lookbackWeeks) || 6;

  return (
    <Suspense fallback={<PayrollSkeleton />}>
      <PayrollData lookbackWeeks={lookbackWeeks} />
    </Suspense>
  );
}

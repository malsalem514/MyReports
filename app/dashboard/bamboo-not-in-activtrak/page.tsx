import { getAccessContext } from '@/lib/access';
import { requireVisibleTab } from '@/lib/tab-config';
import { getBambooNotInActivTrakEmployees } from '@/lib/dashboard-data';
import { redirect } from 'next/navigation';
import { BambooNotInActivTrakClient } from './report-client';

export default async function BambooNotInActivTrakPage() {
  const access = await getAccessContext();
  if (!access.userEmail) {
    redirect('/login');
  }
  if (!access.isRootAdmin && !access.isHRAdmin) {
    redirect('/dashboard');
  }
  await requireVisibleTab(access.userEmail, access, 'bamboo-not-in-activtrak');

  try {
    const rows = await getBambooNotInActivTrakEmployees();
    return <BambooNotInActivTrakClient rows={rows} />;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Oracle mismatch report unavailable';
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          Bamboo/ActivTrak mismatch report is currently unavailable. {message}
        </div>
        <BambooNotInActivTrakClient rows={[]} />
      </div>
    );
  }
}

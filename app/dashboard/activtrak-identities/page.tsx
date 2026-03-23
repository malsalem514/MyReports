import { getAccessContext } from '@/lib/access';
import { getSuspiciousActivTrakIdentities } from '@/lib/dashboard-data';
import { redirect } from 'next/navigation';
import { SuspiciousActivTrakIdentitiesClient } from './report-client';

export default async function ActivTrakIdentitiesPage() {
  const access = await getAccessContext();
  if (!access.userEmail) {
    redirect('/login');
  }
  if (!access.isRootAdmin && !access.isHRAdmin) {
    redirect('/dashboard');
  }

  try {
    const rows = await getSuspiciousActivTrakIdentities();
    return <SuspiciousActivTrakIdentitiesClient rows={rows} />;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Oracle suspicious identity report unavailable';
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          ActivTrak identities report is currently unavailable. {message}
        </div>
        <SuspiciousActivTrakIdentitiesClient rows={[]} />
      </div>
    );
  }
}

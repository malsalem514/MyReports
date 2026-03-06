import { redirect } from 'next/navigation';
import { getAccessContext } from '@/lib/access';
import { getVisibleTabs, type TabKey } from '@/lib/tab-config';

const TAB_ROUTES: Record<TabKey, string> = {
  'office-attendance': '/dashboard/office-attendance',
  'timesheet-compare': '/dashboard/timesheet-compare',
  'working-hours': '/dashboard/working-hours',
};

export default async function DashboardPage() {
  const access = await getAccessContext();
  if (!access.userEmail) {
    redirect('/login');
  }

  const visibleTabs = await getVisibleTabs(access.userEmail, access);
  const firstTab = visibleTabs[0];
  if (firstTab) {
    redirect(TAB_ROUTES[firstTab]);
  }

  redirect('/dashboard/search');
}

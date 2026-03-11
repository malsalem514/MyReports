import { redirect } from 'next/navigation';
import { getAccessContext } from '@/lib/access';
import { getVisibleTabs } from '@/lib/tab-config';
import { DASHBOARD_TAB_ROUTES } from '@/lib/dashboard-nav-config';

export default async function DashboardPage() {
  const access = await getAccessContext();
  if (!access.userEmail) {
    redirect('/login');
  }

  const visibleTabs = await getVisibleTabs(access.userEmail, access);
  const firstTab = visibleTabs[0];
  if (firstTab) {
    redirect(DASHBOARD_TAB_ROUTES[firstTab]);
  }

  redirect('/dashboard/search');
}

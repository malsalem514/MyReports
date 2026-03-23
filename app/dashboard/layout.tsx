import { getAccessContext } from '@/lib/access';
import { getVisibleTabs } from '@/lib/tab-config';
import { buildDashboardNavItems, DASHBOARD_TAB_ROUTES } from '@/lib/dashboard-nav-config';
import { DashboardNav } from './dashboard-nav';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const access = await getAccessContext();
  if (!access.userEmail) {
    redirect('/login');
  }

  const visibleTabs = await getVisibleTabs(access.userEmail, access);
  const navItems = buildDashboardNavItems(visibleTabs, { isHRAdmin: access.isRootAdmin || access.isHRAdmin });

  // Protect hidden routes: redirect if current path is not in visible tabs
  const headersList = await headers();
  const fullUrl =
    headersList.get('next-url') ||
    headersList.get('x-url') ||
    headersList.get('x-invoke-path') ||
    '';
  const pathname = fullUrl ? new URL(fullUrl, 'http://localhost').pathname : '';

  if (pathname && pathname !== '/dashboard/admin') {
    const allowedPaths = new Set(visibleTabs.map((k) => DASHBOARD_TAB_ROUTES[k]));
    // Also allow sub-paths like /dashboard/employee/[email]
    const isAllowed =
      allowedPaths.has(pathname) ||
      pathname === '/dashboard/search' ||
      pathname === '/dashboard/activtrak-identities' ||
      pathname.startsWith('/dashboard/employee/') ||
      pathname === '/dashboard/admin';
    if (!isAllowed && pathname !== '/dashboard') {
      redirect('/dashboard');
    }
  }

  return <DashboardNav navItems={navItems}>{children}</DashboardNav>;
}

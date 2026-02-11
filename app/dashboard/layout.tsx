import { getAccessContext } from '@/lib/access';
import { getVisibleTabs, type TabKey } from '@/lib/tab-config';
import { DashboardNav } from './dashboard-nav';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

// Tab key → route path mapping
const TAB_ROUTES: Record<TabKey, string> = {
  overview: '/dashboard',
  calendar: '/dashboard/calendar',
  pulse: '/dashboard/pulse',
  compliance: '/dashboard/compliance',
  attendance: '/dashboard/attendance',
  'office-attendance': '/dashboard/office-attendance',
  report: '/dashboard/report',
  search: '/dashboard/search',
  executive: '/dashboard/executive',
};

const TAB_LABELS: Record<TabKey, string> = {
  overview: 'Overview',
  calendar: 'Calendar',
  pulse: 'Pulse',
  compliance: 'Compliance',
  attendance: 'Attendance',
  'office-attendance': 'Office',
  report: 'Report',
  search: 'Search',
  executive: 'Executive',
};

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const access = await getAccessContext();
  const visibleTabs = await getVisibleTabs(access.userEmail, access);

  const navItems = visibleTabs.map((key) => ({
    key,
    path: TAB_ROUTES[key],
    label: TAB_LABELS[key],
  }));

  // Add Admin link for HR admins (hardcoded, not configurable)
  if (access.isHRAdmin) {
    navItems.push({ key: 'admin' as TabKey, path: '/dashboard/admin', label: 'Admin' });
  }

  // Protect hidden routes: redirect if current path is not in visible tabs
  const headersList = await headers();
  const fullUrl = headersList.get('x-url') || headersList.get('x-invoke-path') || '';
  const pathname = fullUrl ? new URL(fullUrl, 'http://localhost').pathname : '';

  if (pathname && pathname !== '/dashboard/admin') {
    const allowedPaths = new Set(visibleTabs.map((k) => TAB_ROUTES[k]));
    // Also allow sub-paths like /dashboard/employee/[email]
    const isAllowed =
      allowedPaths.has(pathname) ||
      pathname.startsWith('/dashboard/employee/') ||
      pathname === '/dashboard/admin';
    if (!isAllowed && pathname !== '/dashboard') {
      redirect('/dashboard');
    }
  }

  return <DashboardNav navItems={navItems}>{children}</DashboardNav>;
}

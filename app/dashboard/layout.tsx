import { getAccessContext } from '@/lib/access';
import { getVisibleTabs, type TabKey } from '@/lib/tab-config';
import { DashboardNav } from './dashboard-nav';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

// Tab key → route path mapping
const TAB_ROUTES: Record<TabKey, string> = {
  'office-attendance': '/dashboard/office-attendance',
  'timesheet-compare': '/dashboard/timesheet-compare',
};

const TAB_LABELS: Record<TabKey, string> = {
  'office-attendance': 'Office Attendance',
  'timesheet-compare': 'TBS Compare',
};

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const access = await getAccessContext();
  if (!access.userEmail) {
    redirect('/login');
  }

  const visibleTabs = await getVisibleTabs(access.userEmail, access);

  const navItems: Array<{ key: string; path: string; label: string }> = visibleTabs.map((key) => ({
    key,
    path: TAB_ROUTES[key],
    label: TAB_LABELS[key],
  }));

  // Add Admin link for HR admins (hardcoded, not configurable)
  if (access.isHRAdmin) {
    navItems.push({ key: 'admin', path: '/dashboard/admin', label: 'Admin' });
  }

  // Employee search is available to all authenticated users.
  navItems.push({ key: 'search', path: '/dashboard/search', label: 'Employee Search' });

  // Protect hidden routes: redirect if current path is not in visible tabs
  const headersList = await headers();
  const fullUrl = headersList.get('x-url') || headersList.get('x-invoke-path') || '';
  const pathname = fullUrl ? new URL(fullUrl, 'http://localhost').pathname : '';

  if (pathname && pathname !== '/dashboard/admin') {
    const allowedPaths = new Set(visibleTabs.map((k) => TAB_ROUTES[k]));
    // Also allow sub-paths like /dashboard/employee/[email]
    const isAllowed =
      allowedPaths.has(pathname) ||
      pathname === '/dashboard/search' ||
      pathname.startsWith('/dashboard/employee/') ||
      pathname === '/dashboard/admin';
    if (!isAllowed && pathname !== '/dashboard') {
      redirect('/dashboard');
    }
  }

  return <DashboardNav navItems={navItems}>{children}</DashboardNav>;
}

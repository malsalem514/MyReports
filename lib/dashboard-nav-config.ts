import type { TabKey } from './tab-config';

export type DashboardNavChild = {
  key: string;
  path: string;
  label: string;
  params?: Record<string, string>;
};

export type OfficeAttendanceViewKey = 'employees' | 'departments' | 'managers' | 'approved-remote-work';

export type DashboardNavItem = {
  key: string;
  path: string;
  label: string;
  section: 'reports' | 'tools';
  children?: DashboardNavChild[];
};

export const DASHBOARD_TAB_ROUTES: Record<TabKey, string> = {
  'office-attendance': '/dashboard/office-attendance',
  'timesheet-compare': '/dashboard/timesheet-compare',
  'working-hours': '/dashboard/working-hours',
  'bamboo-not-in-activtrak': '/dashboard/bamboo-not-in-activtrak',
};

export const DASHBOARD_TAB_LABELS: Record<TabKey, string> = {
  'office-attendance': 'Office Attendance',
  'timesheet-compare': 'TBS Compare',
  'working-hours': 'Working Hours',
  'bamboo-not-in-activtrak': 'Bamboo vs ActivTrak',
};

export const OFFICE_ATTENDANCE_VIEW_OPTIONS: Array<{
  id: OfficeAttendanceViewKey;
  label: string;
  description: string;
  params?: Record<string, string>;
}> = [
  { id: 'employees', label: 'Employees', description: 'Individual attendance and weekly office presence.' },
  { id: 'departments', label: 'Departments', description: 'Department rollups across the selected range.', params: { view: 'departments' } },
  { id: 'managers', label: 'Managers', description: 'Manager rollups across the selected range.', params: { view: 'managers' } },
  { id: 'approved-remote-work', label: 'Approved Remote Work', description: 'Employees with approved remote-work requests from Oracle.', params: { view: 'approved-remote-work' } },
];

export const OFFICE_ATTENDANCE_NAV_CHILDREN: DashboardNavChild[] = OFFICE_ATTENDANCE_VIEW_OPTIONS.map((option) => ({
  key: `office-attendance-${option.id}`,
  path: DASHBOARD_TAB_ROUTES['office-attendance'],
  label: option.label,
  params: option.params,
}));

export function buildDashboardNavItems(
  visibleTabs: TabKey[],
  options: { isHRAdmin: boolean },
): DashboardNavItem[] {
  const navItems: DashboardNavItem[] = [];

  for (const key of visibleTabs) {
    if (key === 'office-attendance') {
      navItems.push({
        key,
        path: DASHBOARD_TAB_ROUTES[key],
        label: DASHBOARD_TAB_LABELS[key],
        section: 'reports',
        children: OFFICE_ATTENDANCE_NAV_CHILDREN,
      });
      continue;
    }

    navItems.push({
      key,
      path: DASHBOARD_TAB_ROUTES[key],
      label: DASHBOARD_TAB_LABELS[key],
      section: 'reports',
    });
  }

  if (options.isHRAdmin) {
    navItems.push({
      key: 'admin',
      path: '/dashboard/admin',
      label: 'Admin',
      section: 'tools',
    });
  }

  navItems.push({
    key: 'search',
    path: '/dashboard/search',
    label: 'Employee Search',
    section: 'tools',
  });

  return navItems;
}

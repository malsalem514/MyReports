import type { TabKey } from './tab-config';

export type DashboardNavChild = {
  key: string;
  path: string;
  label: string;
  params?: Record<string, string>;
};

export type OfficeAttendanceViewKey = 'employees' | 'office-day-hours' | 'departments' | 'managers' | 'approved-remote-work';

export type DashboardNavItem = {
  key: string;
  path: string;
  label: string;
  section: 'reports' | 'admin';
  children?: DashboardNavChild[];
};

export const DASHBOARD_TAB_ROUTES: Record<TabKey, string> = {
  'office-attendance': '/dashboard/office-attendance',
  'timesheet-compare': '/dashboard/timesheet-compare',
  'working-hours': '/dashboard/working-hours',
  'bamboo-not-in-activtrak': '/dashboard/bamboo-not-in-activtrak',
  'activtrak-identities': '/dashboard/activtrak-identities',
};

export const DASHBOARD_TAB_LABELS: Record<TabKey, string> = {
  'office-attendance': 'Office Attendance',
  'timesheet-compare': 'TBS Compare',
  'working-hours': 'Working Hours',
  'bamboo-not-in-activtrak': 'Users Mappings',
  'activtrak-identities': 'ActivTrak Identities',
};

export const OFFICE_ATTENDANCE_VIEW_OPTIONS: Array<{
  id: OfficeAttendanceViewKey;
  label: string;
  description: string;
  params?: Record<string, string>;
}> = [
  { id: 'employees', label: 'Employees', description: 'Individual attendance and weekly office presence.' },
  { id: 'office-day-hours', label: 'Office vs Home Hours', description: 'Office windows, office activity, and home/other tracked time on days counted as office days.', params: { view: 'office-day-hours' } },
  { id: 'departments', label: 'Departments', description: 'Department rollups across the selected range.', params: { view: 'departments' } },
  { id: 'managers', label: 'Managers', description: 'Manager rollups across the selected range.', params: { view: 'managers' } },
  { id: 'approved-remote-work', label: 'Remote & Abroad Requests', description: 'Temporary remote-work and work-abroad/province request records with visible approval status.', params: { view: 'approved-remote-work' } },
];

export const OFFICE_ATTENDANCE_NAV_CHILDREN: DashboardNavChild[] = OFFICE_ATTENDANCE_VIEW_OPTIONS.map((option) => ({
  key: `office-attendance-${option.id}`,
  path: DASHBOARD_TAB_ROUTES['office-attendance'],
  label: option.label,
  params: option.params,
}));

const WORKING_HOURS_GROUP_KEYS = ['working-hours', 'timesheet-compare'] as const;
type WorkingHoursGroupKey = (typeof WORKING_HOURS_GROUP_KEYS)[number];

export const WORKING_HOURS_NAV_CHILDREN: Record<WorkingHoursGroupKey, DashboardNavChild> = {
  'working-hours': {
    key: 'working-hours-employee-time',
    path: DASHBOARD_TAB_ROUTES['working-hours'],
    label: 'Employee Time',
  },
  'timesheet-compare': {
    key: 'working-hours-tbs-compare',
    path: DASHBOARD_TAB_ROUTES['timesheet-compare'],
    label: 'TBS Compare',
  },
};

export function buildDashboardNavItems(
  visibleTabs: TabKey[],
  options: { isHRAdmin: boolean },
): DashboardNavItem[] {
  const navItems: DashboardNavItem[] = [];
  let workingHoursGroupAdded = false;

  for (const key of visibleTabs) {
    if (key === 'bamboo-not-in-activtrak' || key === 'activtrak-identities') {
      navItems.push({
        key,
        path: DASHBOARD_TAB_ROUTES[key],
        label: DASHBOARD_TAB_LABELS[key],
        section: 'admin',
      });
      continue;
    }

    if ((WORKING_HOURS_GROUP_KEYS as readonly TabKey[]).includes(key)) {
      if (!workingHoursGroupAdded) {
        const workingHoursChildren = WORKING_HOURS_GROUP_KEYS
          .filter((groupKey) => visibleTabs.includes(groupKey))
          .map((groupKey) => WORKING_HOURS_NAV_CHILDREN[groupKey as WorkingHoursGroupKey]);

        if (workingHoursChildren.length > 0) {
          navItems.push({
            key: 'working-hours-group',
            path: workingHoursChildren[0]!.path,
            label: 'Working Hours',
            section: 'reports',
            children: workingHoursChildren,
          });
          workingHoursGroupAdded = true;
        }
      }
      continue;
    }

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
      label: 'Tab Visibility',
      section: 'admin',
    });
  }

  navItems.push({
    key: 'search',
    path: '/dashboard/search',
    label: 'Employee Search',
    section: 'admin',
  });

  return navItems;
}

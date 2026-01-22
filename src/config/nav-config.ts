import { NavItem } from '@/types';

/**
 * Navigation configuration - HR Reports only
 */
export const navItems: NavItem[] = [
  {
    title: 'HR Reports',
    url: '/dashboard/hr',
    icon: 'users',
    isActive: true,
    items: [
      {
        title: 'Daily Summary',
        url: '/dashboard/hr/daily-summary',
        icon: 'dashboard'
      },
      {
        title: 'Quebec Compliance',
        url: '/dashboard/hr/quebec-compliance',
        icon: 'mapPin'
      }
    ]
  }
];

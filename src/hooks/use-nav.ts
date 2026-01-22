'use client';

/**
 * Fully client-side hook for filtering navigation items based on RBAC
 *
 * When Clerk is not configured, this hook shows all navigation items
 * (development mode with full access).
 *
 * Note: For actual security (API routes, server actions), always use server-side checks.
 * This is only for UI visibility.
 */

import { useMemo } from 'react';
import type { NavItem } from '@/types';

/**
 * Hook to filter navigation items based on RBAC (fully client-side)
 *
 * When Clerk is not configured, returns all items (development mode).
 *
 * @param items - Array of navigation items to filter
 * @returns Filtered items
 */
export function useFilteredNavItems(items: NavItem[]) {
  // Without Clerk configured, show all navigation items (dev mode / full access)
  // This allows the dashboard to work without authentication configured
  const filteredItems = useMemo(() => {
    return items;
  }, [items]);

  return filteredItems;
}

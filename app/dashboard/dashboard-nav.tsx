'use client';

import { ChevronRight, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { getDashboardDefaultDateRange } from '@/lib/report-date-defaults';
import { cn } from '@/lib/utils';
import type { DashboardNavChild, DashboardNavItem } from '@/lib/dashboard-nav-config';
import type { ReactNode } from 'react';

function getWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);
  return {
    startDate: startDate.toISOString().split('T')[0] ?? '',
    endDate: endDate.toISOString().split('T')[0] ?? '',
  };
}

function buildHref(
  path: string,
  startDate: string,
  endDate: string,
  extraParams?: Record<string, string>,
): string {
  const params = new URLSearchParams({ startDate, endDate });
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      params.set(key, value);
    }
  }
  return `${path}?${params.toString()}`;
}

function matchesChild(
  pathname: string,
  currentView: string | null,
  child: DashboardNavChild,
): boolean {
  if (pathname !== child.path) return false;
  const childView = child.params?.view;
  if (!childView) {
    return currentView === null || currentView === '' || currentView === 'employees';
  }
  return currentView === childView;
}

export function DashboardNav({ navItems, children }: { navItems: DashboardNavItem[]; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const startDateParam = searchParams.get('startDate');
  const endDateParam = searchParams.get('endDate');
  const defaults = getDashboardDefaultDateRange(pathname);
  const startDate = startDateParam || defaults.startDate;
  const endDate = endDateParam || defaults.endDate;
  const currentView = searchParams.get('view');
  const currentRangeKey = getRangePresetKey(startDate, endDate);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setOpenGroups((previous) => {
      const next = { ...previous };
      let changed = false;

      for (const item of navItems) {
        if (!item.children || item.children.length === 0) continue;
        const hasActiveChild = item.children.some((child) => matchesChild(pathname, currentView, child));
        if (hasActiveChild && !next[item.key]) {
          next[item.key] = true;
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [currentView, navItems, pathname]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    if (mobileNavOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  const handleDateChange = (newStart: string, newEnd: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('startDate', newStart);
    params.set('endDate', newEnd);
    router.push(`${pathname}?${params.toString()}`);
  };

  const handlePreset = (preset: 'week' | '30days' | 'thisweek') => {
    const end = new Date();
    const start = new Date();
    switch (preset) {
      case 'thisweek': {
        const wr = getWeekRange();
        handleDateChange(wr.startDate, wr.endDate);
        return;
      }
      case 'week':
        start.setDate(end.getDate() - 7);
        break;
      case '30days':
        start.setDate(end.getDate() - 30);
        break;
    }
    handleDateChange(start.toISOString().split('T')[0] ?? '', end.toISOString().split('T')[0] ?? '');
  };

  const getDateRangeForPath = (targetPath: string) => {
    if (startDateParam && endDateParam) {
      return {
        startDate: startDateParam,
        endDate: endDateParam,
      };
    }
    return getDashboardDefaultDateRange(targetPath);
  };

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-[#fcfcfb]/95 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-4 lg:px-6">
          <div className="flex min-h-16 flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between lg:py-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-[15px] font-semibold tracking-tight text-gray-900">MyReports</h1>
                <p className="mt-0.5 text-[12px] text-gray-500">Reporting workspace</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => setMobileNavOpen(true)}
                className="mt-0.5 lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="size-4" />
              </Button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="grid grid-cols-3 rounded-md border border-gray-200 bg-white shadow-sm">
                {([
                  { label: 'This Week', preset: 'thisweek' as const },
                  { label: 'Last 7 Days', preset: 'week' as const },
                  { label: '30 Days', preset: '30days' as const },
                ]).map(({ label, preset }) => (
                  <Button
                    key={label}
                    onClick={() => handlePreset(preset)}
                    variant={currentRangeKey === preset ? 'default' : 'ghost'}
                    size="sm"
                    className={`rounded-none border-0 px-2 py-1.5 text-[11px] font-medium shadow-none first:rounded-l-md last:rounded-r-md sm:px-3 sm:text-[12px] ${
                      currentRangeKey === preset
                        ? 'bg-slate-800 text-white hover:bg-slate-800 hover:text-white'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 shadow-sm">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => handleDateChange(e.target.value || startDate, endDate)}
                  className="min-w-0 border-0 bg-transparent text-[12px] text-gray-600 focus:outline-none"
                />
                <span className="text-[12px] text-gray-400">–</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => handleDateChange(startDate, e.target.value || endDate)}
                  className="min-w-0 border-0 bg-transparent text-[12px] text-gray-600 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-gray-950/35"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          />
          <div className="absolute inset-y-0 left-0 w-[88vw] max-w-[340px] border-r border-gray-200 bg-[#fcfcfb] shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-500">Navigation</p>
                <p className="mt-0.5 text-[12px] text-gray-500">Reports and admin tools</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
              >
                <X className="size-4" />
              </Button>
            </div>
            <DashboardNavMenu
              navItems={navItems}
              pathname={pathname}
              currentView={currentView}
              getDateRangeForPath={getDateRangeForPath}
              openGroups={openGroups}
              onOpenGroupsChange={setOpenGroups}
              className="h-[calc(100vh-4rem)]"
            />
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
        <div className="grid gap-6 lg:grid-cols-[260px,minmax(0,1fr)]">
          <aside className="hidden lg:sticky lg:top-24 lg:block lg:h-[calc(100vh-7rem)] lg:self-start">
            <DashboardNavMenu
              navItems={navItems}
              pathname={pathname}
              currentView={currentView}
              getDateRangeForPath={getDateRangeForPath}
              openGroups={openGroups}
              onOpenGroupsChange={setOpenGroups}
            />
          </aside>

          <main>{children}</main>
        </div>
      </div>
    </div>
  );
}

function getRangePresetKey(
  startDate: string,
  endDate: string,
): 'thisweek' | 'week' | '30days' | null {
  const today = new Date();
  const expectedEnd = today.toISOString().split('T')[0] ?? '';
  if (endDate !== expectedEnd) return null;

  const last7 = new Date(today);
  last7.setDate(today.getDate() - 7);
  if (startDate === (last7.toISOString().split('T')[0] ?? '')) {
    return 'week';
  }

  const last30 = new Date(today);
  last30.setDate(today.getDate() - 30);
  if (startDate === (last30.toISOString().split('T')[0] ?? '')) {
    return '30days';
  }

  const weekRange = getWeekRange();
  if (startDate === weekRange.startDate && endDate === weekRange.endDate) {
    return 'thisweek';
  }

  return null;
}

function DashboardNavMenu({
  navItems,
  pathname,
  currentView,
  getDateRangeForPath,
  openGroups,
  onOpenGroupsChange,
  className,
}: {
  navItems: DashboardNavItem[];
  pathname: string;
  currentView: string | null;
  getDateRangeForPath: (targetPath: string) => { startDate: string; endDate: string };
  openGroups: Record<string, boolean>;
  onOpenGroupsChange: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  className?: string;
}) {
  const reportItems = navItems.filter((item) => item.section === 'reports');
  const utilityItems = navItems.filter((item) => item.section === 'tools');

  return (
    <nav className={cn('flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm', className)}>
      <div className="px-4 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Navigation</p>
        <p className="mt-1 text-[12px] text-gray-500">Reports and admin tools</p>
      </div>
      <Separator />

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div>
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Reports</p>
          <div className="space-y-1">
            {reportItems.map((item) => {
              const itemRange = getDateRangeForPath(item.path);
              if (item.children && item.children.length > 0) {
                const hasActiveChild = item.children.some((child) => matchesChild(pathname, currentView, child));
                const isOpen = openGroups[item.key] ?? hasActiveChild;

                return (
                  <Collapsible
                    key={item.key}
                    open={isOpen}
                    onOpenChange={(open) =>
                      onOpenGroupsChange((previous) => ({
                        ...previous,
                        [item.key]: open,
                      }))
                    }
                    className="space-y-1"
                  >
                    <div className="flex items-center gap-1">
                      <Link
                        href={buildHref(item.path, itemRange.startDate, itemRange.endDate)}
                        className={cn(
                          'inline-flex h-9 flex-1 items-center justify-start rounded-lg px-3 text-[13px] font-semibold transition-colors',
                          hasActiveChild ? 'bg-slate-100 text-slate-900 hover:bg-slate-100 hover:text-slate-900' : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900',
                        )}
                      >
                        {item.label}
                      </Link>
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-9 w-9 text-gray-500 hover:bg-gray-50 hover:text-gray-900 data-[state=open]:bg-gray-100 [&_svg]:transition-transform data-[state=open]:[&_svg]:rotate-90"
                          aria-label={`Toggle ${item.label}`}
                        >
                          <ChevronRight className="size-4" />
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent className="ml-4 border-l border-gray-200 pl-3">
                      <div className="space-y-1 py-1">
                        {item.children.map((child) => {
                          const childActive = matchesChild(pathname, currentView, child);
                          const childRange = getDateRangeForPath(child.path);
                          return (
                            <Link
                              key={child.key}
                              href={buildHref(child.path, childRange.startDate, childRange.endDate, child.params)}
                              className={cn(
                                'flex h-8 w-full items-center justify-start rounded-lg px-3 text-[12px] transition-colors',
                                childActive ? 'bg-slate-800 font-semibold text-white hover:bg-slate-800 hover:text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                              )}
                            >
                              {child.label}
                            </Link>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              }

              return (
                <Link
                  key={item.key}
                  href={buildHref(item.path, itemRange.startDate, itemRange.endDate)}
                  className={cn(
                    'flex h-9 w-full items-center justify-start rounded-lg px-3 text-[13px] font-semibold transition-colors',
                    pathname === item.path ? 'bg-slate-800 text-white hover:bg-slate-800 hover:text-white' : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        {utilityItems.length > 0 ? (
          <>
            <Separator className="my-4" />
            <div>
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Tools</p>
              <div className="space-y-1">
                {utilityItems.map((item) => {
                  const itemRange = getDateRangeForPath(item.path);
                  return (
                  <Link
                    key={item.key}
                    href={buildHref(item.path, itemRange.startDate, itemRange.endDate)}
                    className={cn(
                      'flex h-9 w-full items-center justify-start rounded-lg px-3 text-[13px] font-semibold transition-colors',
                      pathname === item.path ? 'bg-slate-800 text-white hover:bg-slate-800 hover:text-white' : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900',
                    )}
                  >
                    {item.label}
                  </Link>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </nav>
  );
}

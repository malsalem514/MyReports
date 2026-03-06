'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

interface NavItem {
  key: string;
  path: string;
  label: string;
}

function getDefaultDateRange() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  return {
    startDate: startDate.toISOString().split('T')[0] ?? '',
    endDate: endDate.toISOString().split('T')[0] ?? '',
  };
}

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

export function DashboardNav({ navItems, children }: { navItems: NavItem[]; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const defaults = getDefaultDateRange();
  const startDate = searchParams.get('startDate') || defaults.startDate;
  const endDate = searchParams.get('endDate') || defaults.endDate;
  const currentRangeKey = getRangePresetKey(startDate, endDate);

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

  return (
    <div className="min-h-screen bg-[#f8f8f8]">
      <header className="sticky top-0 z-50 border-b border-gray-200/80 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-8">
              <h1 className="text-[15px] font-semibold tracking-tight text-gray-900">
                MyReports
              </h1>
              <nav className="hidden items-center gap-1 md:flex">
                {navItems.map((item) => (
                  <Link
                    key={item.path}
                    href={`${item.path}?startDate=${startDate}&endDate=${endDate}`}
                    className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                      pathname === item.path
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden items-center gap-2 md:flex">
                <div className="flex items-center rounded-lg border border-gray-200 bg-white">
                  {([
                    { label: 'This Week', preset: 'thisweek' as const },
                    { label: 'Last 7 Days', preset: 'week' as const },
                    { label: '30 Days', preset: '30days' as const },
                  ]).map(({ label, preset }) => (
                    <button
                      key={label}
                      onClick={() => handlePreset(preset)}
                      className={`px-3 py-1.5 text-[12px] font-medium transition-colors first:rounded-l-lg last:rounded-r-lg ${
                        currentRangeKey === preset
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => handleDateChange(e.target.value || startDate, endDate)}
                    className="w-[110px] border-0 bg-transparent text-[12px] text-gray-600 focus:outline-none"
                  />
                  <span className="text-[12px] text-gray-400">–</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => handleDateChange(startDate, e.target.value || endDate)}
                    className="w-[110px] border-0 bg-transparent text-[12px] text-gray-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="border-t border-gray-100 px-6 py-2 md:hidden">
          <nav className="flex gap-1 overflow-x-auto">
            {navItems.map((item) => (
              <Link
                key={item.path}
                href={`${item.path}?startDate=${startDate}&endDate=${endDate}`}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  pathname === item.path
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
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

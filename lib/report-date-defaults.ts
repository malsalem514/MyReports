import { sub } from 'date-fns';
import { DEFAULT_LOOKBACK_WEEKS } from './constants';

export function toDateParam(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getLastCompletedFriday(referenceDate = new Date()): Date {
  const completedFriday = new Date(referenceDate);
  const day = completedFriday.getDay();
  const daysBack = day === 5 ? 7 : (day + 2) % 7;

  completedFriday.setDate(completedFriday.getDate() - daysBack);
  completedFriday.setHours(23, 59, 59, 999);
  return completedFriday;
}

export function getOfficeAttendanceDefaultRange(lookbackWeeks = DEFAULT_LOOKBACK_WEEKS): {
  startDate: Date;
  endDate: Date;
} {
  const endDate = getLastCompletedFriday();
  const startDate = sub(endDate, { weeks: lookbackWeeks });
  startDate.setHours(0, 0, 0, 0);

  return { startDate, endDate };
}

export function getDashboardDefaultDateRange(targetPath: string): {
  startDate: string;
  endDate: string;
} {
  if (targetPath === '/dashboard/office-attendance') {
    const { startDate, endDate } = getOfficeAttendanceDefaultRange();
    return {
      startDate: toDateParam(startDate),
      endDate: toDateParam(endDate),
    };
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  return {
    startDate: toDateParam(startDate),
    endDate: toDateParam(endDate),
  };
}

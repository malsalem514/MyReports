// Shared constants for attendance reports

export const OFFICE_DAYS_REQUIRED = 2;

export const LOOKBACK_OPTIONS = [2, 4, 6, 8, 12, 16] as const;
export type LookbackWeeks = (typeof LOOKBACK_OPTIONS)[number];

export const DEFAULT_LOOKBACK_WEEKS = 6;
export const DEFAULT_OFFICE_ATTENDANCE_LOOKBACK_WEEKS = 4;

export const CELL_COLORS = {
  compliant: 'bg-green-100 text-green-700',   // 2+ office days
  partial: 'bg-orange-100 text-orange-700',   // 1 day
  absent: 'bg-red-100 text-red-700',          // 0 days
  pto: 'bg-blue-100 text-blue-700',           // has PTO that week
} as const;

export const CELL_HEX = {
  compliant: 'C6EFCE',
  partial: 'FFEDD5',
  absent: 'FEE2E2',
  pto: 'DBEAFE',
} as const;

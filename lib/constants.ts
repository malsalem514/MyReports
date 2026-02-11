// Shared constants for attendance reports

export const OFFICE_DAYS_REQUIRED = 2;

export const LOOKBACK_OPTIONS = [2, 4, 6, 8, 12, 16] as const;
export type LookbackWeeks = (typeof LOOKBACK_OPTIONS)[number];

export const DEFAULT_LOOKBACK_WEEKS = 6;

export const CELL_COLORS = {
  excellent: 'bg-green-100 text-green-700',   // 4+ office days
  compliant: 'bg-yellow-100 text-yellow-700', // >= required
  partial: 'bg-orange-100 text-orange-700',   // >= 1 day
  absent: 'bg-red-100 text-red-700',          // 0 days, no PTO
  pto: 'bg-blue-100 text-blue-700',           // has PTO that week
} as const;

export const CELL_HEX = {
  excellent: 'C6EFCE',
  compliant: 'FEF3C7',
  partial: 'FFEDD5',
  absent: 'FEE2E2',
  pto: 'DBEAFE',
} as const;

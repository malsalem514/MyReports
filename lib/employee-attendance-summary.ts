export interface EmployeeAttendanceSummaryRecord {
  date: Date | string;
  location: 'Office' | 'Remote' | 'Unknown';
  totalHours: number;
  isPTO: boolean;
}

export interface EmployeeTimeOffSummaryRecord {
  startDate: Date | string;
  endDate: Date | string;
  status?: string | null;
}

export interface EmployeeAttendanceSummary {
  officeDays: number;
  remoteDays: number;
  totalHours: number;
  workingDayCount: number;
  avgHours: number;
}

function toLocalDate(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(value);
}

export function isWeekendDate(value: Date | string): boolean {
  const day = toLocalDate(value).getDay();
  return day === 0 || day === 6;
}

function isDeniedTimeOff(record: Pick<EmployeeTimeOffSummaryRecord, 'status'>): boolean {
  return record.status?.trim().toLowerCase() === 'denied';
}

export function isTimeOffDate(
  value: Date | string,
  timeOff: ReadonlyArray<EmployeeTimeOffSummaryRecord> = [],
): boolean {
  const date = toLocalDate(value).getTime();
  return timeOff.some((record) =>
    !isDeniedTimeOff(record) &&
    date >= toLocalDate(record.startDate).getTime() &&
    date <= toLocalDate(record.endDate).getTime(),
  );
}

export function isWorkingAttendanceDay(
  record: Pick<EmployeeAttendanceSummaryRecord, 'date' | 'isPTO'>,
  timeOff: ReadonlyArray<EmployeeTimeOffSummaryRecord> = [],
): boolean {
  return !record.isPTO && !isTimeOffDate(record.date, timeOff) && !isWeekendDate(record.date);
}

export function calculateEmployeeAttendanceSummary(
  attendance: ReadonlyArray<EmployeeAttendanceSummaryRecord>,
  timeOff: ReadonlyArray<EmployeeTimeOffSummaryRecord> = [],
): EmployeeAttendanceSummary {
  let officeDays = 0;
  let remoteDays = 0;
  let totalHours = 0;
  let workingDayCount = 0;

  for (const record of attendance) {
    if (record.location === 'Office') officeDays++;
    else if (record.location === 'Remote') remoteDays++;

    totalHours += record.totalHours;
    if (isWorkingAttendanceDay(record, timeOff)) workingDayCount++;
  }

  return {
    officeDays,
    remoteDays,
    totalHours,
    workingDayCount,
    avgHours: workingDayCount > 0 ? totalHours / workingDayCount : 0,
  };
}

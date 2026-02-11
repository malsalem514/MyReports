import { startOfISOWeek, endOfISOWeek, eachWeekOfInterval, format } from 'date-fns';

const FMT = 'yyyy-MM-dd';

export function getWeekStart(date: Date): string {
  return format(startOfISOWeek(date), FMT);
}

export function getWeekEnd(date: Date): string {
  return format(endOfISOWeek(date), FMT);
}

export function getWeeksInRange(start: Date, end: Date): string[] {
  return eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }).map(
    (d) => format(d, FMT),
  );
}

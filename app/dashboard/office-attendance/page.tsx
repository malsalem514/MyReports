import { sub } from 'date-fns';
import { getAccessContext } from '@/lib/access';
import { getAttendanceReport } from '@/lib/dashboard-data';
import { OFFICE_DAYS_REQUIRED, DEFAULT_LOOKBACK_WEEKS, LOOKBACK_OPTIONS } from '@/lib/constants';
import { AttendanceClient } from './attendance-client';

export default async function OfficeAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ lookbackWeeks?: string }>;
}) {
  const params = await searchParams;
  const lookbackWeeks = LOOKBACK_OPTIONS.includes(Number(params.lookbackWeeks) as any)
    ? (Number(params.lookbackWeeks) as (typeof LOOKBACK_OPTIONS)[number])
    : DEFAULT_LOOKBACK_WEEKS;

  const endDate = new Date();
  const startDate = sub(endDate, { weeks: lookbackWeeks });

  const access = await getAccessContext();
  const allowedEmails = access.isHRAdmin ? undefined : access.allowedEmails;

  const { rows, weeks, departments, locations, summary } = await getAttendanceReport(
    startDate,
    endDate,
    OFFICE_DAYS_REQUIRED,
    allowedEmails,
  );

  return (
    <AttendanceClient
      rows={rows}
      weeks={weeks}
      departments={departments}
      locations={locations}
      summary={summary}
      lookbackWeeks={lookbackWeeks}
    />
  );
}

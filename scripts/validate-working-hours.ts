/**
 * Validate the Working Hours report against raw source data.
 *
 * Usage:
 *   set -a; source .env; set +a; npx tsx scripts/validate-working-hours.ts 2026-02-27 2026-03-06
 */

import { getBigQueryClient } from '../lib/bigquery';
import { query } from '../lib/oracle';
import { getWorkingHoursReport } from '../lib/dashboard-data';
import type { WorkingHoursDayRow, WorkingHoursEmployeeWeekRow } from '../lib/dashboard-data';

type RawMetric = {
  tbsReportedHours: number;
  tbsAbsenceHours: number;
  activeSeconds: number;
  productiveActiveSeconds: number;
  productivePassiveSeconds: number;
  undefinedActiveSeconds: number;
  undefinedPassiveSeconds: number;
  unproductiveActiveSeconds: number;
};

type RawDayMetric = RawMetric & {
  date: string;
  weekStart: string;
};

const BQ_PROJECT = process.env.BIGQUERY_PROJECT_ID || 'us-activtrak-ac-prod';
const BQ_DATASET = process.env.BIGQUERY_DATASET || '672561';

function toDateOnly(input: string): Date {
  return new Date(`${input}T00:00:00`);
}

function fmtDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toWeekStart(input: Date | string): string {
  const date = typeof input === 'string' ? toDateOnly(input) : new Date(input);
  const dayOfWeek = date.getDay();
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setDate(date.getDate() + offset);
  date.setHours(0, 0, 0, 0);
  return fmtDate(date);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function calcWorkedVsReported(activeHours: number, tbsReportedHours: number): number | null {
  if (tbsReportedHours <= 0) return null;
  return round2(((activeHours - tbsReportedHours) / tbsReportedHours) * 100);
}

function equalish(a: number | null, b: number | null, tolerance = 0.01): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= tolerance;
}

function initMetric(): RawMetric {
  return {
    tbsReportedHours: 0,
    tbsAbsenceHours: 0,
    activeSeconds: 0,
    productiveActiveSeconds: 0,
    productivePassiveSeconds: 0,
    undefinedActiveSeconds: 0,
    undefinedPassiveSeconds: 0,
    unproductiveActiveSeconds: 0,
  };
}

function addMetric(target: RawMetric, source: RawMetric): void {
  target.tbsReportedHours += source.tbsReportedHours;
  target.tbsAbsenceHours += source.tbsAbsenceHours;
  target.activeSeconds += source.activeSeconds;
  target.productiveActiveSeconds += source.productiveActiveSeconds;
  target.productivePassiveSeconds += source.productivePassiveSeconds;
  target.undefinedActiveSeconds += source.undefinedActiveSeconds;
  target.undefinedPassiveSeconds += source.undefinedPassiveSeconds;
  target.unproductiveActiveSeconds += source.unproductiveActiveSeconds;
}

function metricToDisplay(metric: RawMetric): {
  tbsReportedHours: number;
  tbsAbsenceHours: number;
  activeHours: number;
  productiveActiveHours: number;
  productivePassiveHours: number;
  undefinedActiveHours: number;
  undefinedPassiveHours: number;
  unproductiveActiveHours: number;
} {
  return {
    tbsReportedHours: round1(metric.tbsReportedHours),
    tbsAbsenceHours: round1(metric.tbsAbsenceHours),
    activeHours: round1(metric.activeSeconds / 3600),
    productiveActiveHours: round1(metric.productiveActiveSeconds / 3600),
    productivePassiveHours: round1(metric.productivePassiveSeconds / 3600),
    undefinedActiveHours: round1(metric.undefinedActiveSeconds / 3600),
    undefinedPassiveHours: round1(metric.undefinedPassiveSeconds / 3600),
    unproductiveActiveHours: round1(metric.unproductiveActiveSeconds / 3600),
  };
}

async function main() {
  const startArg = process.argv[2] || '2026-02-27';
  const endArg = process.argv[3] || '2026-03-06';
  const startDate = toDateOnly(startArg);
  const endDate = toDateOnly(endArg);
  endDate.setHours(23, 59, 59, 999);

  console.log(`Validating Working Hours report for ${startArg} to ${endArg}\n`);

  const report = await getWorkingHoursReport(startDate, endDate);
  const bq = getBigQueryClient();

  const [employees, mapRows, tbsEntries, bqRows] = await Promise.all([
    query<{
      EMAIL: string;
      DISPLAY_NAME: string | null;
      FIRST_NAME: string | null;
      LAST_NAME: string | null;
      DEPARTMENT: string | null;
    }>(
      `SELECT LOWER(EMAIL) AS EMAIL, DISPLAY_NAME, FIRST_NAME, LAST_NAME, DEPARTMENT
       FROM TL_EMPLOYEES
       WHERE EMAIL IS NOT NULL AND (STATUS IS NULL OR UPPER(STATUS) != 'INACTIVE')`,
    ),
    query<{ EMAIL: string; TBS_EMPLOYEE_NO: number }>(
      `SELECT LOWER(EMAIL) AS EMAIL, TBS_EMPLOYEE_NO FROM TL_TBS_EMPLOYEE_MAP`,
    ),
    query<{
      EMPLOYEE_NO: number;
      ENTRY_DATE: Date;
      WORK_CODE: string | null;
      WORK_DESCRIPTION: string | null;
      TIME_HOURS: number | null;
      ENTRY_TYPE: string | null;
    }>(
      `SELECT EMPLOYEE_NO, ENTRY_DATE, WORK_CODE, WORK_DESCRIPTION, TIME_HOURS, ENTRY_TYPE
       FROM TBS_ALL_TIME_ENTRIES_V@TBS_LINK
       WHERE ENTRY_DATE BETWEEN :sd AND :ed`,
      { sd: startDate, ed: endDate },
    ),
    bq.query({
      query: `
        WITH user_emails AS (
          SELECT userid, LOWER(email) AS email,
            ROW_NUMBER() OVER (PARTITION BY userid ORDER BY email) AS rn
          FROM \`${BQ_PROJECT}.${BQ_DATASET}.user_identifiers\`
          WHERE email IS NOT NULL
        )
        SELECT
          CAST(d.local_date AS STRING) AS local_date,
          LOWER(COALESCE(ue.email, d.user_name)) AS email,
          COALESCE(d.total_duration_seconds, 0) AS active_seconds,
          COALESCE(d.productive_active_duration_seconds, 0) AS productive_active_seconds,
          COALESCE(d.productive_passive_duration_seconds, 0) AS productive_passive_seconds,
          COALESCE(d.undefined_active_duration_seconds, 0) AS undefined_active_seconds,
          COALESCE(d.undefined_passive_duration_seconds, 0) AS undefined_passive_seconds,
          COALESCE(d.unproductive_active_duration_seconds, 0) AS unproductive_active_seconds
        FROM \`${BQ_PROJECT}.${BQ_DATASET}.daily_user_summary\` d
        LEFT JOIN user_emails ue ON d.user_id = ue.userid AND ue.rn = 1
        WHERE d.local_date BETWEEN @sd AND @ed
      `,
      params: { sd: startArg, ed: endArg },
      location: 'US',
    }),
  ]);

  const employeeNameByEmail = new Map<string, string>();
  const employeeGroupByEmail = new Map<string, string>();
  const tbsByEmail = new Map<string, number>();
  const emailByTbsNo = new Map<number, string>();
  for (const employee of employees) {
    const email = employee.EMAIL?.toLowerCase();
    if (!email) continue;
    const name =
      employee.DISPLAY_NAME ||
      `${employee.FIRST_NAME || ''} ${employee.LAST_NAME || ''}`.trim() ||
      email;
    employeeNameByEmail.set(email, name);
    employeeGroupByEmail.set(email, employee.DEPARTMENT || 'Unknown');
  }
  for (const row of mapRows) {
    tbsByEmail.set(row.EMAIL.toLowerCase(), row.TBS_EMPLOYEE_NO);
    emailByTbsNo.set(row.TBS_EMPLOYEE_NO, row.EMAIL.toLowerCase());
  }

  const absenceCodes = new Set([
    'VACATION', 'ILLNESS', 'MISC. ABS./APPTS', 'ALTERNATE DAY',
    'SICK', 'PERSONAL', 'BEREAVEMENT', 'JURY DUTY',
  ]);

  const rawByWeekEmployee = new Map<string, {
    email: string;
    name: string;
    group: string;
    tbsEmployeeNo: number | null;
    weekStart: string;
    days: Map<string, RawDayMetric>;
  }>();

  for (const row of bqRows[0] as Array<Record<string, unknown>>) {
    const email = String(row.email || '').toLowerCase();
    if (!email) continue;
    const date = String(row.local_date);
    const weekStart = toWeekStart(date);
    const key = `${weekStart}|${email}`;
    const name = employeeNameByEmail.get(email) || email;
    const group = employeeGroupByEmail.get(email) || 'Unknown';
    const tbsEmployeeNo = tbsByEmail.get(email) ?? null;

    if (!rawByWeekEmployee.has(key)) {
      rawByWeekEmployee.set(key, {
        email,
        name,
        group,
        tbsEmployeeNo,
        weekStart,
        days: new Map(),
      });
    }
    const employee = rawByWeekEmployee.get(key)!;
    const day = employee.days.get(date) || {
      date,
      weekStart,
      ...initMetric(),
    };
    day.activeSeconds += Number(row.active_seconds || 0);
    day.productiveActiveSeconds += Number(row.productive_active_seconds || 0);
    day.productivePassiveSeconds += Number(row.productive_passive_seconds || 0);
    day.undefinedActiveSeconds += Number(row.undefined_active_seconds || 0);
    day.undefinedPassiveSeconds += Number(row.undefined_passive_seconds || 0);
    day.unproductiveActiveSeconds += Number(row.unproductive_active_seconds || 0);
    employee.days.set(date, day);
  }

  for (const row of tbsEntries) {
    const email = emailByTbsNo.get(row.EMPLOYEE_NO);
    if (!email) continue;
    const date = fmtDate(row.ENTRY_DATE);
    const weekStart = toWeekStart(row.ENTRY_DATE);
    const key = `${weekStart}|${email}`;
    const name = employeeNameByEmail.get(email) || email;
    const group = employeeGroupByEmail.get(email) || 'Unknown';

    if (!rawByWeekEmployee.has(key)) {
      rawByWeekEmployee.set(key, {
        email,
        name,
        group,
        tbsEmployeeNo: row.EMPLOYEE_NO,
        weekStart,
        days: new Map(),
      });
    }

    const employee = rawByWeekEmployee.get(key)!;
    const day = employee.days.get(date) || {
      date,
      weekStart,
      ...initMetric(),
    };
    const desc = String(row.WORK_DESCRIPTION || row.WORK_CODE || '').toUpperCase().trim();
    const isAbsence = absenceCodes.has(desc) || row.ENTRY_TYPE === 'C';
    const hours = Number(row.TIME_HOURS || 0);

    if (isAbsence) {
      day.tbsAbsenceHours += hours;
    } else {
      day.tbsReportedHours += hours;
    }
    employee.days.set(date, day);
  }

  let employeeMismatches = 0;
  let dayMismatches = 0;
  let weekMismatches = 0;

  const reportEmployees = new Map<string, WorkingHoursEmployeeWeekRow>();
  for (const week of report.weeks) {
    for (const employee of week.employees) {
      reportEmployees.set(`${employee.weekStart}|${employee.email.toLowerCase()}`, employee);
    }
  }

  for (const [key, source] of rawByWeekEmployee) {
    const reportEmployee = reportEmployees.get(key);
    if (!reportEmployee) {
      employeeMismatches++;
      console.log(`Missing employee row in report: ${key}`);
      continue;
    }

    const rolled = initMetric();
    for (const day of source.days.values()) addMetric(rolled, day);
    const displaySource = metricToDisplay(rolled);
    const expectedWorkedVs = calcWorkedVsReported(
      displaySource.activeHours,
      displaySource.tbsReportedHours,
    );

    const employeeChecks = [
      equalish(reportEmployee.tbsReportedHours, displaySource.tbsReportedHours),
      equalish(reportEmployee.tbsAbsenceHours, displaySource.tbsAbsenceHours),
      equalish(reportEmployee.activeHours, displaySource.activeHours),
      equalish(reportEmployee.productiveActiveHours, displaySource.productiveActiveHours),
      equalish(reportEmployee.productivePassiveHours, displaySource.productivePassiveHours),
      equalish(reportEmployee.undefinedActiveHours, displaySource.undefinedActiveHours),
      equalish(reportEmployee.undefinedPassiveHours, displaySource.undefinedPassiveHours),
      equalish(reportEmployee.unproductiveActiveHours, displaySource.unproductiveActiveHours),
      equalish(reportEmployee.workedVsReportedPct, expectedWorkedVs),
    ];
    if (employeeChecks.some((ok) => !ok)) {
      employeeMismatches++;
      console.log(`Employee mismatch: ${reportEmployee.weekStart} | ${reportEmployee.name}`);
      console.log({
        report: {
          tbsReportedHours: reportEmployee.tbsReportedHours,
          tbsAbsenceHours: reportEmployee.tbsAbsenceHours,
          activeHours: reportEmployee.activeHours,
          workedVsReportedPct: reportEmployee.workedVsReportedPct,
          productiveActiveHours: reportEmployee.productiveActiveHours,
          productivePassiveHours: reportEmployee.productivePassiveHours,
          undefinedActiveHours: reportEmployee.undefinedActiveHours,
          undefinedPassiveHours: reportEmployee.undefinedPassiveHours,
          unproductiveActiveHours: reportEmployee.unproductiveActiveHours,
        },
        source: {
          ...displaySource,
          workedVsReportedPct: expectedWorkedVs,
        },
      });
    }

    const reportDays = new Map<string, WorkingHoursDayRow>(
      reportEmployee.days.map((day) => [day.date, day]),
    );
    for (const [date, sourceDay] of source.days) {
      const reportDay = reportDays.get(date);
      if (!reportDay) {
        dayMismatches++;
        console.log(`Missing day row in report: ${key} | ${date}`);
        continue;
      }
      const displayDay = metricToDisplay(sourceDay);
      const dayWorkedVs = calcWorkedVsReported(displayDay.activeHours, displayDay.tbsReportedHours);
      const dayChecks = [
        equalish(reportDay.tbsReportedHours, displayDay.tbsReportedHours),
        equalish(reportDay.tbsAbsenceHours, displayDay.tbsAbsenceHours),
        equalish(reportDay.activeHours, displayDay.activeHours),
        equalish(reportDay.productiveActiveHours, displayDay.productiveActiveHours),
        equalish(reportDay.productivePassiveHours, displayDay.productivePassiveHours),
        equalish(reportDay.undefinedActiveHours, displayDay.undefinedActiveHours),
        equalish(reportDay.undefinedPassiveHours, displayDay.undefinedPassiveHours),
        equalish(reportDay.unproductiveActiveHours, displayDay.unproductiveActiveHours),
        equalish(reportDay.workedVsReportedPct, dayWorkedVs),
      ];
      if (dayChecks.some((ok) => !ok)) {
        dayMismatches++;
        console.log(`Day mismatch: ${reportEmployee.name} | ${date}`);
        console.log({
          report: reportDay,
          source: {
            ...displayDay,
            date: sourceDay.date,
            weekStart: sourceDay.weekStart,
            workedVsReportedPct: dayWorkedVs,
          },
        });
      }
    }
  }

  for (const week of report.weeks) {
    const rolled = initMetric();
    for (const employee of week.employees) {
      const source = rawByWeekEmployee.get(`${employee.weekStart}|${employee.email.toLowerCase()}`);
      if (!source) continue;
      for (const day of source.days.values()) addMetric(rolled, day);
    }
    const displayWeek = metricToDisplay(rolled);
    const weekWorkedVs = calcWorkedVsReported(displayWeek.activeHours, displayWeek.tbsReportedHours);
    const checks = [
      equalish(week.tbsReportedHours, displayWeek.tbsReportedHours),
      equalish(week.tbsAbsenceHours, displayWeek.tbsAbsenceHours),
      equalish(week.activeHours, displayWeek.activeHours),
      equalish(week.productiveActiveHours, displayWeek.productiveActiveHours),
      equalish(week.productivePassiveHours, displayWeek.productivePassiveHours),
      equalish(week.undefinedActiveHours, displayWeek.undefinedActiveHours),
      equalish(week.undefinedPassiveHours, displayWeek.undefinedPassiveHours),
      equalish(week.unproductiveActiveHours, displayWeek.unproductiveActiveHours),
      equalish(week.workedVsReportedPct, weekWorkedVs),
    ];
    if (checks.some((ok) => !ok)) {
      weekMismatches++;
      console.log(`Week rollup mismatch: ${week.weekStart}`);
    }
  }

  const sampleRows = report.weeks.flatMap((week) => week.employees).slice(0, 8);
  console.log('\nSample rows cross-referenced against source totals:');
  for (const row of sampleRows) {
    const source = rawByWeekEmployee.get(`${row.weekStart}|${row.email.toLowerCase()}`);
    const rolled = initMetric();
    if (source) {
      for (const day of source.days.values()) addMetric(rolled, day);
    }
    const display = metricToDisplay(rolled);
    console.log(
      `- ${row.weekStart} | ${row.name} | TBS ${row.tbsReportedHours.toFixed(2)} vs source ${display.tbsReportedHours.toFixed(2)} | Active ${row.activeHours.toFixed(2)} vs source ${display.activeHours.toFixed(2)} | Delta ${formatNullable(row.workedVsReportedPct)}`,
    );
  }

  console.log('\nValidation summary:');
  console.log(`- Report weeks: ${report.weeks.length}`);
  console.log(`- Report employee-week rows: ${report.weeks.reduce((sum, week) => sum + week.employees.length, 0)}`);
  console.log(`- Raw employee-week groups: ${rawByWeekEmployee.size}`);
  console.log(`- Week mismatches: ${weekMismatches}`);
  console.log(`- Employee mismatches: ${employeeMismatches}`);
  console.log(`- Day mismatches: ${dayMismatches}`);

  if (weekMismatches === 0 && employeeMismatches === 0 && dayMismatches === 0) {
    console.log('\nPASS: Working Hours calculations match the underlying BigQuery and TBS source data for the validated range.');
    process.exit(0);
  }

  console.log('\nFAIL: Validation found mismatches. Review the logs above before sharing with HR.');
  process.exit(1);
}

function formatNullable(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(2)}%`;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { query } from './oracle';
import type { AttendanceRow, WeekCell, AttendanceSummary } from '@/app/dashboard/office-attendance/attendance-client';

// ============================================================================
// Types
// ============================================================================

export interface Employee {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  department: string | null;
  division: string | null;
  location: string | null;
  supervisorId: string | null;
  supervisorEmail: string | null;
  hireDate: Date | null;
  status: string | null;
}

export interface AttendanceRecord {
  date: Date;
  email: string;
  displayName: string;
  location: 'Office' | 'Remote' | 'Unknown';
  totalHours: number;
  isPTO: boolean;
  ptoType: string | null;
  ptoHours: number;
}

export interface TimeOffRecord {
  employeeId: string;
  employeeEmail: string;
  employeeName: string;
  department: string;
  startDate: string;
  endDate: string;
  type: string;
  status: string;
  amount: number;
  unit: string;
}

// ============================================================================
// Employee Queries
// ============================================================================

export async function getEmployees(options?: {
  activeOnly?: boolean;
  department?: string;
  emails?: string[];
}): Promise<Employee[]> {
  let sql = `SELECT * FROM TL_EMPLOYEES WHERE 1=1`;
  const params: Record<string, unknown> = {};

  if (options?.activeOnly) {
    sql += ` AND (STATUS IS NULL OR UPPER(STATUS) != 'INACTIVE')`;
  }
  if (options?.department) {
    sql += ` AND DEPARTMENT = :department`;
    params.department = options.department;
  }
  if (options?.emails && options.emails.length > 0) {
    const placeholders = options.emails.map((_, i) => `:email${i}`).join(',');
    sql += ` AND LOWER(EMAIL) IN (${placeholders})`;
    options.emails.forEach((email, i) => {
      params[`email${i}`] = email.toLowerCase();
    });
  }

  sql += ` ORDER BY DISPLAY_NAME`;

  const rows = await query<{
    ID: string; EMAIL: string; DISPLAY_NAME: string; FIRST_NAME: string;
    LAST_NAME: string; JOB_TITLE: string; DEPARTMENT: string; DIVISION: string;
    LOCATION: string; SUPERVISOR_ID: string; SUPERVISOR_EMAIL: string;
    HIRE_DATE: Date; STATUS: string;
  }>(sql, params);

  return rows.map((r) => ({
    id: r.ID, email: r.EMAIL, displayName: r.DISPLAY_NAME,
    firstName: r.FIRST_NAME, lastName: r.LAST_NAME, jobTitle: r.JOB_TITLE,
    department: r.DEPARTMENT, division: r.DIVISION, location: r.LOCATION,
    supervisorId: r.SUPERVISOR_ID, supervisorEmail: r.SUPERVISOR_EMAIL,
    hireDate: r.HIRE_DATE, status: r.STATUS,
  }));
}

export async function getEmployeeByEmail(email: string): Promise<Employee | null> {
  const rows = await query<{
    ID: string; EMAIL: string; DISPLAY_NAME: string; FIRST_NAME: string;
    LAST_NAME: string; JOB_TITLE: string; DEPARTMENT: string; DIVISION: string;
    LOCATION: string; SUPERVISOR_ID: string; SUPERVISOR_EMAIL: string;
    HIRE_DATE: Date; STATUS: string;
  }>(`SELECT * FROM TL_EMPLOYEES WHERE LOWER(EMAIL) = :email`, {
    email: email.toLowerCase(),
  });

  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    id: r.ID, email: r.EMAIL, displayName: r.DISPLAY_NAME,
    firstName: r.FIRST_NAME, lastName: r.LAST_NAME, jobTitle: r.JOB_TITLE,
    department: r.DEPARTMENT, division: r.DIVISION, location: r.LOCATION,
    supervisorId: r.SUPERVISOR_ID, supervisorEmail: r.SUPERVISOR_EMAIL,
    hireDate: r.HIRE_DATE, status: r.STATUS,
  };
}

export async function getDepartments(): Promise<string[]> {
  const rows = await query<{ DEPARTMENT: string }>(
    `SELECT DISTINCT DEPARTMENT FROM TL_EMPLOYEES WHERE DEPARTMENT IS NOT NULL ORDER BY DEPARTMENT`,
  );
  return rows.map((r) => r.DEPARTMENT);
}

// ============================================================================
// Attendance Queries
// ============================================================================

export async function getAttendance(
  startDate: Date,
  endDate: Date,
  emails?: string[],
): Promise<AttendanceRecord[]> {
  // Dedup: one row per employee per day; Office wins over Remote
  let innerWhere = `RECORD_DATE BETWEEN :startDate AND :endDate`;
  const params: Record<string, unknown> = { startDate, endDate };

  if (emails && emails.length > 0) {
    const placeholders = emails.map((_, i) => `:email${i}`).join(',');
    innerWhere += ` AND LOWER(EMAIL) IN (${placeholders})`;
    emails.forEach((email, i) => { params[`email${i}`] = email.toLowerCase(); });
  }

  const sql = `
    SELECT RECORD_DATE, EMAIL, DISPLAY_NAME, LOCATION, TOTAL_HOURS, IS_PTO, PTO_TYPE, PTO_HOURS
    FROM (
      SELECT t.*,
        ROW_NUMBER() OVER (
          PARTITION BY EMAIL, TRUNC(RECORD_DATE)
          ORDER BY DECODE(LOCATION, 'Office', 1, 'Remote', 2, 3)
        ) AS rn
      FROM TL_ATTENDANCE t
      WHERE ${innerWhere}
    ) WHERE rn = 1
    ORDER BY RECORD_DATE DESC, EMAIL
  `;

  const rows = await query<{
    RECORD_DATE: Date; EMAIL: string; DISPLAY_NAME: string; LOCATION: string;
    TOTAL_HOURS: number; IS_PTO: number; PTO_TYPE: string; PTO_HOURS: number;
  }>(sql, params);

  return rows.map((r) => ({
    date: r.RECORD_DATE, email: r.EMAIL,
    displayName: r.DISPLAY_NAME || '',
    location: (r.LOCATION as 'Office' | 'Remote' | 'Unknown') || 'Unknown',
    totalHours: r.TOTAL_HOURS || 0,
    isPTO: r.IS_PTO === 1,
    ptoType: r.PTO_TYPE, ptoHours: r.PTO_HOURS || 0,
  }));
}

// ============================================================================
// Time Off Queries
// ============================================================================

export async function getTimeOff(
  startDate: Date,
  endDate: Date,
  emails?: string[],
): Promise<TimeOffRecord[]> {
  let sql = `
    SELECT EMPLOYEE_ID, EMAIL, EMPLOYEE_NAME, DEPARTMENT, START_DATE, END_DATE, TYPE, STATUS, AMOUNT, UNIT
    FROM TL_TIME_OFF WHERE (START_DATE <= :endDate AND END_DATE >= :startDate)
  `;
  const params: Record<string, unknown> = { startDate, endDate };

  if (emails && emails.length > 0) {
    const placeholders = emails.map((_, i) => `:email${i}`).join(',');
    sql += ` AND LOWER(EMAIL) IN (${placeholders})`;
    emails.forEach((email, i) => { params[`email${i}`] = email.toLowerCase(); });
  }

  sql += ` ORDER BY START_DATE`;

  const rows = await query<{
    EMPLOYEE_ID: string; EMAIL: string; EMPLOYEE_NAME: string; DEPARTMENT: string;
    START_DATE: Date; END_DATE: Date; TYPE: string; STATUS: string;
    AMOUNT: number; UNIT: string;
  }>(sql, params);

  return rows.map((r) => ({
    employeeId: r.EMPLOYEE_ID, employeeEmail: r.EMAIL || '',
    employeeName: r.EMPLOYEE_NAME || '', department: r.DEPARTMENT || '',
    startDate: toDateStr(r.START_DATE),
    endDate: toDateStr(r.END_DATE),
    type: r.TYPE || '', status: r.STATUS || '',
    amount: r.AMOUNT || 0, unit: r.UNIT || '',
  }));
}

// ============================================================================
// Office Attendance Report — queries V_ATTENDANCE_WEEKLY + V_PTO_WEEKLY views
// ============================================================================

export interface AttendanceReportResult {
  rows: AttendanceRow[];
  weeks: string[];
  currentWeek: string | null;
  departments: string[];
  locations: string[];
  summary: AttendanceSummary;
}

export async function getAttendanceReport(
  startDate: Date,
  endDate: Date,
  officeDaysRequired: number,
  emails?: string[],
): Promise<AttendanceReportResult> {
  // --- Query the views ---
  const params: Record<string, unknown> = { sd: startDate, ed: endDate };
  let emailFilter = '';
  if (emails && emails.length > 0) {
    const placeholders = emails.map((_, i) => `:em${i}`).join(',');
    emailFilter = ` AND EMAIL IN (${placeholders})`;
    emails.forEach((email, i) => { params[`em${i}`] = email.toLowerCase(); });
  }

  // Build separate params for employee query (no :sd/:ed)
  const empParams: Record<string, unknown> = {};
  let empEmailFilter = '';
  if (emails && emails.length > 0) {
    const placeholders = emails.map((_, i) => `:em${i}`).join(',');
    empEmailFilter = ` AND LOWER(EMAIL) IN (${placeholders})`;
    emails.forEach((email, i) => { empParams[`em${i}`] = email.toLowerCase(); });
  }

  const [attRows, ptoRows, empRows, dailyRows] = await Promise.all([
    query<{
      EMAIL: string; DISPLAY_NAME: string; DEPARTMENT: string;
      OFFICE_LOCATION: string; WEEK_START: Date;
      OFFICE_DAYS: number; REMOTE_DAYS: number;
    }>(
      `SELECT * FROM V_ATTENDANCE_WEEKLY WHERE WEEK_START BETWEEN TRUNC(:sd, 'IW') AND TRUNC(:ed, 'IW')${emailFilter}`,
      params,
    ),
    query<{ EMAIL: string; WEEK_START: Date; PTO_DAYS: number }>(
      `SELECT * FROM V_PTO_WEEKLY WHERE WEEK_START BETWEEN TRUNC(:sd, 'IW') AND TRUNC(:ed, 'IW')${emailFilter}`,
      params,
    ),
    query<{
      EMAIL: string; DISPLAY_NAME: string; DEPARTMENT: string; LOCATION: string;
    }>(
      `SELECT LOWER(EMAIL) AS EMAIL, NVL(DISPLAY_NAME, EMAIL) AS DISPLAY_NAME, NVL(DEPARTMENT, 'Unknown') AS DEPARTMENT, NVL(LOCATION, 'Unknown') AS LOCATION FROM TL_EMPLOYEES WHERE EMAIL IS NOT NULL AND (STATUS IS NULL OR UPPER(STATUS) != 'INACTIVE') AND NVL(DEPARTMENT, 'Unknown') NOT IN ('Executive', 'Administration')${empEmailFilter}`,
      empParams,
    ),
    // Daily detail (deduped, Office wins, weekdays only) — includes PTO flag from ActivTrak
    query<{ EMAIL: string; RECORD_DATE: Date; LOCATION: string; IS_PTO: number; PTO_TYPE: string | null }>(
      `SELECT EMAIL, RECORD_DATE, LOCATION, IS_PTO, PTO_TYPE FROM (
        SELECT LOWER(t.EMAIL) AS EMAIL, t.RECORD_DATE, t.LOCATION, NVL(t.IS_PTO, 0) AS IS_PTO, t.PTO_TYPE,
          ROW_NUMBER() OVER (PARTITION BY LOWER(t.EMAIL), TRUNC(t.RECORD_DATE)
            ORDER BY DECODE(t.LOCATION, 'Office', 1, 'Remote', 2, 3)) AS rn
        FROM TL_ATTENDANCE t
        WHERE t.RECORD_DATE BETWEEN :sd AND :ed
          AND TO_CHAR(t.RECORD_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')${emailFilter}
      ) WHERE rn = 1`,
      params,
    ),
  ]);

  // --- Index PTO by email|week ---
  const ptoMap = new Map<string, number>();
  for (const r of ptoRows) {
    const wk = toDateStr(r.WEEK_START);
    ptoMap.set(`${r.EMAIL?.toLowerCase()}|${wk}`, r.PTO_DAYS || 0);
  }

  // --- Index daily detail by email|week → DayDetail[] ---
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dailyMap = new Map<string, Array<{ date: string; dayLabel: string; location: string }>>();
  for (const r of dailyRows) {
    const email = r.EMAIL?.toLowerCase();
    if (!email) continue;
    const d = r.RECORD_DATE instanceof Date ? r.RECORD_DATE : new Date(r.RECORD_DATE);
    const dateStr = toDateStr(d);
    // Compute ISO week start (Monday) using local time (Oracle dates are local)
    const dayOfWeek = d.getDay(); // 0=Sun, local timezone
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(d);
    monday.setDate(monday.getDate() + mondayOffset);
    const wk = toDateStr(monday);
    const key = `${email}|${wk}`;
    if (!dailyMap.has(key)) dailyMap.set(key, []);
    // If IS_PTO=1, show as PTO regardless of location
    const location = r.IS_PTO === 1 ? 'PTO' : (r.LOCATION || 'Unknown');
    dailyMap.get(key)!.push({
      date: dateStr,
      dayLabel: DAY_LABELS[d.getDay()] || '',
      location,
    });
  }

  // Sort each week's days by date
  for (const days of dailyMap.values()) {
    days.sort((a, b) => a.date.localeCompare(b.date));
  }

  // --- Index attendance by employee ---
  const empWeeks = new Map<string, {
    name: string; department: string; officeLocation: string;
    weeks: Record<string, WeekCell>;
  }>();
  const weeksSet = new Set<string>();

  for (const r of attRows) {
    const email = r.EMAIL?.toLowerCase();
    if (!email) continue;
    const wk = toDateStr(r.WEEK_START);
    weeksSet.add(wk);

    if (!empWeeks.has(email)) {
      empWeeks.set(email, {
        name: r.DISPLAY_NAME || email,
        department: r.DEPARTMENT || 'Unknown',
        officeLocation: r.OFFICE_LOCATION || 'Unknown',
        weeks: {},
      });
    }
    const dailyDetails = dailyMap.get(`${email}|${wk}`) || [];
    empWeeks.get(email)!.weeks[wk] = {
      officeDays: r.OFFICE_DAYS || 0,
      remoteDays: r.REMOTE_DAYS || 0,
      ptoDays: ptoMap.get(`${email}|${wk}`) || 0,
      days: dailyDetails.map((dd) => ({
        date: dd.date,
        dayLabel: dd.dayLabel,
        location: dd.location as 'Office' | 'Remote' | 'Unknown',
      })),
    };
  }

  // --- Seed employees with zero attendance (the "invisible absentees") ---
  for (const emp of empRows) {
    const email = emp.EMAIL?.toLowerCase();
    if (!email || empWeeks.has(email)) continue;
    empWeeks.set(email, {
      name: emp.DISPLAY_NAME || email,
      department: emp.DEPARTMENT || 'Unknown',
      officeLocation: emp.LOCATION || 'Unknown',
      weeks: {},
    });
  }

  const weeks = [...weeksSet].sort();

  // --- Current-week detection (partial week — exclude from compliance/avg) ---
  const now = new Date();
  const currentDow = now.getDay(); // 0=Sun
  const currentMondayOffset = currentDow === 0 ? -6 : 1 - currentDow;
  const currentMonday = new Date(now);
  currentMonday.setDate(currentMonday.getDate() + currentMondayOffset);
  const currentWeekStr = toDateStr(currentMonday);
  const isCurrentWeekInRange = weeks.includes(currentWeekStr);
  const completedWeeks = isCurrentWeekInRange ? weeks.filter(w => w !== currentWeekStr) : weeks;
  const numCompletedWeeks = completedWeeks.length;

  // --- Build flat rows ---
  const rows: AttendanceRow[] = [];
  const deptSet = new Set<string>();
  const locSet = new Set<string>();

  for (const [email, data] of empWeeks) {
    let total = 0;          // all weeks including current (for Total column)
    let completedTotal = 0; // completed weeks only (for Avg)
    let compliantWeekCount = 0;
    let excusedWeekCount = 0;

    for (const wk of weeks) {
      const cell = data.weeks[wk];
      const officeDays = cell?.officeDays ?? 0;
      total += officeDays;

      // Skip current partial week for compliance evaluation
      if (wk === currentWeekStr && isCurrentWeekInRange) continue;

      completedTotal += officeDays;
      const ptoDays = cell?.ptoDays ?? 0;
      const availableDays = 5 - ptoDays;

      if (availableDays < officeDaysRequired) {
        // Week excused: PTO left fewer working days than required
        excusedWeekCount++;
      } else if (officeDays >= officeDaysRequired) {
        compliantWeekCount++;
      }
    }

    const compliant = numCompletedWeeks > 0 && (compliantWeekCount + excusedWeekCount) === numCompletedWeeks;

    // Trend: compare last two completed weeks
    let trend: 'up' | 'down' | 'flat' = 'flat';
    if (completedWeeks.length >= 2) {
      const a = data.weeks[completedWeeks[completedWeeks.length - 2]!]?.officeDays || 0;
      const b = data.weeks[completedWeeks[completedWeeks.length - 1]!]?.officeDays || 0;
      if (b > a) trend = 'up';
      else if (b < a) trend = 'down';
    }

    if (data.department !== 'Unknown') deptSet.add(data.department);
    if (data.officeLocation !== 'Unknown') locSet.add(data.officeLocation);

    rows.push({
      email,
      name: data.name,
      department: data.department,
      officeLocation: data.officeLocation,
      weeks: data.weeks,
      total,
      avgPerWeek: numCompletedWeeks > 0 ? Math.round((completedTotal / numCompletedWeeks) * 10) / 10 : 0,
      compliant,
      trend,
    });
  }

  // --- Summary ---
  const totalEmployees = rows.length;
  let compliantCount = 0, zeroOfficeDaysCount = 0, sumCompletedOfficeDays = 0;
  for (const r of rows) {
    if (r.compliant) compliantCount++;
    if (r.total === 0) zeroOfficeDaysCount++;
    for (const wk of completedWeeks) {
      sumCompletedOfficeDays += r.weeks[wk]?.officeDays ?? 0;
    }
  }
  const avgOfficeDays = totalEmployees > 0 && numCompletedWeeks > 0
    ? Math.round((sumCompletedOfficeDays / totalEmployees / numCompletedWeeks) * 10) / 10
    : 0;
  const complianceRate = totalEmployees > 0 ? Math.round((compliantCount / totalEmployees) * 100) : 0;

  return {
    rows,
    weeks,
    currentWeek: isCurrentWeekInRange ? currentWeekStr : null,
    departments: [...deptSet].sort(),
    locations: [...locSet].sort(),
    summary: { totalEmployees, avgOfficeDays, complianceRate, zeroOfficeDaysCount },
  };
}

// ============================================================================
// TBS vs BambooHR Comparison Report
// ============================================================================

export interface TbsComparisonRow {
  email: string;
  name: string;
  department: string;
  tbsEmployeeNo: number;
  weeks: Record<string, TbsWeekCell>;
  totalBambooPto: number;
  totalTbsPto: number;
  totalTbsWork: number;
  discrepancyCount: number;
}

export interface TbsWeekCell {
  bambooPtoDays: number;
  tbsPtoDays: number;
  tbsWorkDays: number;
  tbsWorkHours: number;
  hasDiscrepancy: boolean;
  details: TbsDayDetail[];
}

export interface TbsDayDetail {
  date: string;
  dayLabel: string;
  bambooHasPto: boolean;
  bambooType: string | null;
  tbsHasPto: boolean;
  tbsWorkCode: string | null;
  tbsHours: number;
}

export interface TbsComparisonSummary {
  totalEmployees: number;
  mappedEmployees: number;
  unmappedEmployees: number;
  totalDiscrepancies: number;
  bambooPtoNotInTbs: number;
  tbsPtoNotInBamboo: number;
}

export interface TbsComparisonResult {
  rows: TbsComparisonRow[];
  weeks: string[];
  departments: string[];
  summary: TbsComparisonSummary;
  unmappedEmails: string[];
}

export async function getTbsComparisonReport(
  startDate: Date,
  endDate: Date,
  emails?: string[],
): Promise<TbsComparisonResult> {
  let emailFilter = '';
  const mapParams: Record<string, unknown> = {};
  if (emails && emails.length > 0) {
    const placeholders = emails.map((_, i) => `:em${i}`).join(',');
    emailFilter = ` AND LOWER(m.EMAIL) IN (${placeholders})`;
    emails.forEach((email, i) => { mapParams[`em${i}`] = email.toLowerCase(); });
  }

  // 1. Get mapped employees
  const mapRows = await query<{
    EMAIL: string; TBS_EMPLOYEE_NO: number;
    DISPLAY_NAME: string; DEPARTMENT: string;
  }>(
    `SELECT LOWER(m.EMAIL) AS EMAIL, m.TBS_EMPLOYEE_NO,
       NVL(e.DISPLAY_NAME, m.EMAIL) AS DISPLAY_NAME,
       NVL(e.DEPARTMENT, 'Unknown') AS DEPARTMENT
     FROM TL_TBS_EMPLOYEE_MAP m
     LEFT JOIN TL_EMPLOYEES e ON LOWER(e.EMAIL) = LOWER(m.EMAIL)
     WHERE 1=1${emailFilter}
     ORDER BY DISPLAY_NAME`,
    mapParams,
  );

  if (mapRows.length === 0) {
    return { rows: [], weeks: [], departments: [], summary: {
      totalEmployees: 0, mappedEmployees: 0, unmappedEmployees: 0,
      totalDiscrepancies: 0, bambooPtoNotInTbs: 0, tbsPtoNotInBamboo: 0,
    }, unmappedEmails: [] };
  }

  const empNos = mapRows.map((r) => r.TBS_EMPLOYEE_NO);
  const empEmails = mapRows.map((r) => r.EMAIL);

  // Build email filter for BambooHR query
  const emailPlaceholders = empEmails.map((_, i) => `:be${i}`).join(',');
  const bambooParams: Record<string, unknown> = { sd: startDate, ed: endDate };
  empEmails.forEach((email, i) => { bambooParams[`be${i}`] = email; });

  // Build employee_no filter for TBS query
  const tbsNos = empNos.map((_, i) => `:tn${i}`).join(',');
  const tbsParams: Record<string, unknown> = { sd: startDate, ed: endDate };
  empNos.forEach((no, i) => { tbsParams[`tn${i}`] = no; });

  // 2. Parallel fetch: BambooHR PTO + TBS entries + unmapped employees
  // Unmapped employee list is HR-only. If this report is scope-filtered by emails,
  // do not query or return unmapped global employees.
  const unmappedRowsPromise =
    emails && emails.length > 0
      ? Promise.resolve([] as Array<{ EMAIL: string }>)
      : query<{ EMAIL: string }>(
          `SELECT LOWER(EMAIL) AS EMAIL FROM TL_EMPLOYEES
           WHERE EMAIL IS NOT NULL AND (STATUS IS NULL OR UPPER(STATUS) != 'INACTIVE')
             AND LOWER(EMAIL) NOT IN (SELECT LOWER(EMAIL) FROM TL_TBS_EMPLOYEE_MAP)`,
        );

  const [bambooDays, tbsEntries, unmappedRows] = await Promise.all([
    // Expand BambooHR PTO ranges into individual weekdays
    query<{ EMAIL: string; PTO_DATE: Date; TYPE: string }>(
      `SELECT LOWER(t.EMAIL) AS EMAIL, PTO_DATE, t.TYPE FROM (
        SELECT EMAIL, START_DATE + LEVEL - 1 AS PTO_DATE, TYPE
        FROM TL_TIME_OFF
        WHERE LOWER(EMAIL) IN (${emailPlaceholders})
          AND START_DATE <= :ed AND END_DATE >= :sd
          AND STATUS != 'denied'
        CONNECT BY LEVEL <= (TRUNC(END_DATE) - TRUNC(START_DATE) + 1)
          AND PRIOR ROWID = ROWID
          AND PRIOR SYS_GUID() IS NOT NULL
      ) t
      WHERE PTO_DATE BETWEEN :sd AND :ed
        AND TO_CHAR(PTO_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')`,
      bambooParams,
    ),
    // TBS time entries (PTO-like: VACATION, ILLNESS, MISC. ABS./APPTS, Alternate Day, compressed)
    query<{
      EMPLOYEE_NO: number; ENTRY_DATE: Date; WORK_CODE: string;
      WORK_DESCRIPTION: string; TIME_HOURS: number; ENTRY_TYPE: string;
    }>(
      `SELECT EMPLOYEE_NO, ENTRY_DATE, WORK_CODE, WORK_DESCRIPTION, TIME_HOURS, ENTRY_TYPE
       FROM TBS_ALL_TIME_ENTRIES_V@TBS_LINK
       WHERE EMPLOYEE_NO IN (${tbsNos})
         AND ENTRY_DATE BETWEEN :sd AND :ed
         AND TO_CHAR(ENTRY_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')
       ORDER BY EMPLOYEE_NO, ENTRY_DATE`,
      tbsParams,
    ),
    // Unmapped employees (HR-only)
    unmappedRowsPromise,
  ]);

  // 3. Index BambooHR PTO by email|date
  const bambooByDay = new Map<string, string>(); // email|date → type
  for (const r of bambooDays) {
    const d = toDateStr(r.PTO_DATE);
    bambooByDay.set(`${r.EMAIL}|${d}`, r.TYPE || 'PTO');
  }

  // 4. Build email→tbsNo and tbsNo→email maps
  const emailToTbs = new Map<string, number>();
  const tbsToEmail = new Map<number, string>();
  for (const r of mapRows) {
    emailToTbs.set(r.EMAIL, r.TBS_EMPLOYEE_NO);
    tbsToEmail.set(r.TBS_EMPLOYEE_NO, r.EMAIL);
  }

  // 5. Index TBS entries by email|date
  const TBS_PTO_CODES = new Set([
    'VACATION', 'ILLNESS', 'MISC. ABS./APPTS', 'ALTERNATE DAY',
    'SICK', 'PERSONAL', 'BEREAVEMENT', 'JURY DUTY',
  ]);
  const tbsByDay = new Map<string, { isPto: boolean; workCode: string; hours: number }>();
  for (const r of tbsEntries) {
    const email = tbsToEmail.get(r.EMPLOYEE_NO);
    if (!email) continue;
    const d = toDateStr(r.ENTRY_DATE);
    const key = `${email}|${d}`;
    const desc = (r.WORK_DESCRIPTION || '').toUpperCase().trim();
    const isPto = TBS_PTO_CODES.has(desc) || r.ENTRY_TYPE === 'C';
    const existing = tbsByDay.get(key);
    if (existing) {
      existing.hours += r.TIME_HOURS || 0;
      if (isPto) existing.isPto = true;
    } else {
      tbsByDay.set(key, { isPto, workCode: r.WORK_DESCRIPTION || r.WORK_CODE || '', hours: r.TIME_HOURS || 0 });
    }
  }

  // 6. Build week-by-week comparison per employee
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weeksSet = new Set<string>();
  const deptSet = new Set<string>();

  // Generate all weekdays in range
  const allDays: Date[] = [];
  const cur = new Date(startDate);
  while (cur <= endDate) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) allDays.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }

  const rows: TbsComparisonRow[] = [];
  let totalBambooPtoNotInTbs = 0;
  let totalTbsPtoNotInBamboo = 0;

  for (const emp of mapRows) {
    const email = emp.EMAIL;
    const weekCells: Record<string, TbsWeekCell> = {};
    let totalBPto = 0, totalTPto = 0, totalTWork = 0, discrepancies = 0;

    for (const day of allDays) {
      const dateStr = toDateStr(day);
      const dow = day.getDay();
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const monday = new Date(day);
      monday.setDate(monday.getDate() + mondayOffset);
      const wk = toDateStr(monday);
      weeksSet.add(wk);

      if (!weekCells[wk]) {
        weekCells[wk] = { bambooPtoDays: 0, tbsPtoDays: 0, tbsWorkDays: 0, tbsWorkHours: 0, hasDiscrepancy: false, details: [] };
      }
      const cell = weekCells[wk]!;

      const key = `${email}|${dateStr}`;
      const bambooType = bambooByDay.get(key) || null;
      const tbs = tbsByDay.get(key);
      const hasBambooPto = !!bambooType;
      const hasTbsPto = tbs?.isPto ?? false;
      const tbsHours = tbs?.hours ?? 0;

      if (hasBambooPto) { totalBPto++; cell.bambooPtoDays++; }
      if (hasTbsPto) { totalTPto++; cell.tbsPtoDays++; }
      if (tbsHours > 0 && !hasTbsPto) { totalTWork++; cell.tbsWorkDays++; }
      cell.tbsWorkHours += tbsHours;

      // Discrepancy: PTO in one but not the other
      const isDisc = (hasBambooPto && !hasTbsPto && tbsHours === 0) || (!hasBambooPto && hasTbsPto);
      if (isDisc) {
        cell.hasDiscrepancy = true;
        discrepancies++;
        if (hasBambooPto && !hasTbsPto) totalBambooPtoNotInTbs++;
        if (!hasBambooPto && hasTbsPto) totalTbsPtoNotInBamboo++;
      }

      // Only add detail for days with PTO in either system or a discrepancy
      if (hasBambooPto || hasTbsPto || isDisc) {
        cell.details.push({
          date: dateStr,
          dayLabel: DAY_LABELS[dow] || '',
          bambooHasPto: hasBambooPto,
          bambooType,
          tbsHasPto: hasTbsPto,
          tbsWorkCode: tbs?.workCode || null,
          tbsHours,
        });
      }
    }

    if (emp.DEPARTMENT !== 'Unknown') deptSet.add(emp.DEPARTMENT);

    rows.push({
      email,
      name: emp.DISPLAY_NAME,
      department: emp.DEPARTMENT,
      tbsEmployeeNo: emp.TBS_EMPLOYEE_NO,
      weeks: weekCells,
      totalBambooPto: totalBPto,
      totalTbsPto: totalTPto,
      totalTbsWork: totalTWork,
      discrepancyCount: discrepancies,
    });
  }

  return {
    rows,
    weeks: [...weeksSet].sort(),
    departments: [...deptSet].sort(),
    summary: {
      totalEmployees: rows.length + unmappedRows.length,
      mappedEmployees: rows.length,
      unmappedEmployees: unmappedRows.length,
      totalDiscrepancies: rows.reduce((s, r) => s + r.discrepancyCount, 0),
      bambooPtoNotInTbs: totalBambooPtoNotInTbs,
      tbsPtoNotInBamboo: totalTbsPtoNotInBamboo,
    },
    unmappedEmails: unmappedRows.map((r) => r.EMAIL),
  };
}

function toDateStr(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

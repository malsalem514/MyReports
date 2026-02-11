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

export interface ProductivityRecord {
  date: Date;
  email: string;
  productiveTime: number;
  unproductiveTime: number;
  neutralTime: number;
  totalTime: number;
  productivityScore: number | null;
  activeTime: number;
  idleTime: number;
  focusTime: number;
  collaborationTime: number;
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

export async function getAttendanceStats(
  startDate: Date,
  endDate: Date,
  emails?: string[],
): Promise<{
  totalDays: number; officeDays: number; remoteDays: number;
  ptoDays: number; avgHoursPerDay: number;
}> {
  let sql = `
    SELECT COUNT(DISTINCT RECORD_DATE) as TOTAL_DAYS,
      SUM(CASE WHEN LOCATION = 'Office' THEN 1 ELSE 0 END) as OFFICE_DAYS,
      SUM(CASE WHEN LOCATION = 'Remote' THEN 1 ELSE 0 END) as REMOTE_DAYS,
      SUM(CASE WHEN IS_PTO = 1 THEN 1 ELSE 0 END) as PTO_DAYS,
      ROUND(AVG(TOTAL_HOURS), 2) as AVG_HOURS
    FROM TL_ATTENDANCE WHERE RECORD_DATE BETWEEN :startDate AND :endDate
  `;
  const params: Record<string, unknown> = { startDate, endDate };

  if (emails && emails.length > 0) {
    const placeholders = emails.map((_, i) => `:email${i}`).join(',');
    sql += ` AND LOWER(EMAIL) IN (${placeholders})`;
    emails.forEach((email, i) => { params[`email${i}`] = email.toLowerCase(); });
  }

  const rows = await query<{
    TOTAL_DAYS: number; OFFICE_DAYS: number; REMOTE_DAYS: number;
    PTO_DAYS: number; AVG_HOURS: number;
  }>(sql, params);

  const r = rows[0];
  return {
    totalDays: r?.TOTAL_DAYS || 0, officeDays: r?.OFFICE_DAYS || 0,
    remoteDays: r?.REMOTE_DAYS || 0, ptoDays: r?.PTO_DAYS || 0,
    avgHoursPerDay: r?.AVG_HOURS || 0,
  };
}

// ============================================================================
// Productivity Queries
// ============================================================================

export async function getProductivity(
  startDate: Date,
  endDate: Date,
  emails?: string[],
): Promise<ProductivityRecord[]> {
  let sql = `
    SELECT RECORD_DATE, EMAIL, PRODUCTIVE_TIME, UNPRODUCTIVE_TIME, NEUTRAL_TIME,
      TOTAL_TIME, PRODUCTIVITY_SCORE, ACTIVE_TIME, IDLE_TIME, FOCUS_TIME, COLLABORATION_TIME
    FROM TL_PRODUCTIVITY WHERE RECORD_DATE BETWEEN :startDate AND :endDate
  `;
  const params: Record<string, unknown> = { startDate, endDate };

  if (emails && emails.length > 0) {
    const placeholders = emails.map((_, i) => `:email${i}`).join(',');
    sql += ` AND LOWER(EMAIL) IN (${placeholders})`;
    emails.forEach((email, i) => { params[`email${i}`] = email.toLowerCase(); });
  }

  sql += ` ORDER BY RECORD_DATE DESC, EMAIL`;

  const rows = await query<{
    RECORD_DATE: Date; EMAIL: string; PRODUCTIVE_TIME: number;
    UNPRODUCTIVE_TIME: number; NEUTRAL_TIME: number; TOTAL_TIME: number;
    PRODUCTIVITY_SCORE: number; ACTIVE_TIME: number; IDLE_TIME: number;
    FOCUS_TIME: number; COLLABORATION_TIME: number;
  }>(sql, params);

  return rows.map((r) => ({
    date: r.RECORD_DATE, email: r.EMAIL,
    productiveTime: r.PRODUCTIVE_TIME || 0, unproductiveTime: r.UNPRODUCTIVE_TIME || 0,
    neutralTime: r.NEUTRAL_TIME || 0, totalTime: r.TOTAL_TIME || 0,
    productivityScore: r.PRODUCTIVITY_SCORE, activeTime: r.ACTIVE_TIME || 0,
    idleTime: r.IDLE_TIME || 0, focusTime: r.FOCUS_TIME || 0,
    collaborationTime: r.COLLABORATION_TIME || 0,
  }));
}

export async function getProductivityStats(
  startDate: Date,
  endDate: Date,
  emails?: string[],
): Promise<{
  avgProductivityScore: number; totalProductiveHours: number;
  totalFocusHours: number; totalCollaborationHours: number; totalTrackedHours: number;
}> {
  let sql = `
    SELECT ROUND(AVG(PRODUCTIVITY_SCORE), 2) as AVG_SCORE,
      ROUND(SUM(PRODUCTIVE_TIME) / 3600, 2) as PRODUCTIVE_HOURS,
      ROUND(SUM(FOCUS_TIME) / 3600, 2) as FOCUS_HOURS,
      ROUND(SUM(COLLABORATION_TIME) / 3600, 2) as COLLAB_HOURS,
      ROUND(SUM(TOTAL_TIME) / 3600, 2) as TOTAL_HOURS
    FROM TL_PRODUCTIVITY WHERE RECORD_DATE BETWEEN :startDate AND :endDate
  `;
  const params: Record<string, unknown> = { startDate, endDate };

  if (emails && emails.length > 0) {
    const placeholders = emails.map((_, i) => `:email${i}`).join(',');
    sql += ` AND LOWER(EMAIL) IN (${placeholders})`;
    emails.forEach((email, i) => { params[`email${i}`] = email.toLowerCase(); });
  }

  const rows = await query<{
    AVG_SCORE: number; PRODUCTIVE_HOURS: number; FOCUS_HOURS: number;
    COLLAB_HOURS: number; TOTAL_HOURS: number;
  }>(sql, params);

  const r = rows[0];
  return {
    avgProductivityScore: r?.AVG_SCORE || 0,
    totalProductiveHours: r?.PRODUCTIVE_HOURS || 0,
    totalFocusHours: r?.FOCUS_HOURS || 0,
    totalCollaborationHours: r?.COLLAB_HOURS || 0,
    totalTrackedHours: r?.TOTAL_HOURS || 0,
  };
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
    startDate: r.START_DATE.toISOString().split('T')[0] ?? '',
    endDate: r.END_DATE.toISOString().split('T')[0] ?? '',
    type: r.TYPE || '', status: r.STATUS || '',
    amount: r.AMOUNT || 0, unit: r.UNIT || '',
  }));
}

export async function getUpcomingTimeOff(
  days: number = 14,
  emails?: string[],
): Promise<TimeOffRecord[]> {
  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + days);
  return getTimeOff(today, futureDate, emails);
}

// ============================================================================
// Combined Dashboard Queries
// ============================================================================

export async function getDailyAttendanceSummary(
  startDate: Date,
  endDate: Date,
  emails?: string[],
): Promise<Array<{
  date: string; officeCount: number; remoteCount: number;
  ptoCount: number; totalEmployees: number;
}>> {
  let sql = `
    SELECT TO_CHAR(RECORD_DATE, 'YYYY-MM-DD') as DATE_STR,
      SUM(CASE WHEN LOCATION = 'Office' THEN 1 ELSE 0 END) as OFFICE_COUNT,
      SUM(CASE WHEN LOCATION = 'Remote' THEN 1 ELSE 0 END) as REMOTE_COUNT,
      SUM(CASE WHEN IS_PTO = 1 THEN 1 ELSE 0 END) as PTO_COUNT,
      COUNT(DISTINCT EMAIL) as TOTAL_EMPLOYEES
    FROM TL_ATTENDANCE WHERE RECORD_DATE BETWEEN :startDate AND :endDate
  `;
  const params: Record<string, unknown> = { startDate, endDate };

  if (emails && emails.length > 0) {
    const placeholders = emails.map((_, i) => `:email${i}`).join(',');
    sql += ` AND LOWER(EMAIL) IN (${placeholders})`;
    emails.forEach((email, i) => { params[`email${i}`] = email.toLowerCase(); });
  }

  sql += ` GROUP BY RECORD_DATE ORDER BY RECORD_DATE`;

  const rows = await query<{
    DATE_STR: string; OFFICE_COUNT: number; REMOTE_COUNT: number;
    PTO_COUNT: number; TOTAL_EMPLOYEES: number;
  }>(sql, params);

  return rows.map((r) => ({
    date: r.DATE_STR, officeCount: r.OFFICE_COUNT || 0,
    remoteCount: r.REMOTE_COUNT || 0, ptoCount: r.PTO_COUNT || 0,
    totalEmployees: r.TOTAL_EMPLOYEES || 0,
  }));
}

export async function getComplianceSummary(
  startDate: Date,
  endDate: Date,
  requiredOfficeDays: number = 3,
  emails?: string[],
): Promise<Array<{
  email: string; displayName: string; department: string;
  totalDays: number; officeDays: number; remoteDays: number;
  ptoDays: number; complianceRate: number; isCompliant: boolean;
}>> {
  let sql = `
    SELECT a.EMAIL, e.DISPLAY_NAME, e.DEPARTMENT,
      COUNT(DISTINCT a.RECORD_DATE) as TOTAL_DAYS,
      SUM(CASE WHEN a.LOCATION = 'Office' THEN 1 ELSE 0 END) as OFFICE_DAYS,
      SUM(CASE WHEN a.LOCATION = 'Remote' THEN 1 ELSE 0 END) as REMOTE_DAYS,
      SUM(CASE WHEN a.IS_PTO = 1 THEN 1 ELSE 0 END) as PTO_DAYS
    FROM TL_ATTENDANCE a
    LEFT JOIN TL_EMPLOYEES e ON LOWER(a.EMAIL) = LOWER(e.EMAIL)
    WHERE a.RECORD_DATE BETWEEN :startDate AND :endDate
  `;
  const params: Record<string, unknown> = { startDate, endDate };

  if (emails && emails.length > 0) {
    const placeholders = emails.map((_, i) => `:email${i}`).join(',');
    sql += ` AND LOWER(a.EMAIL) IN (${placeholders})`;
    emails.forEach((email, i) => { params[`email${i}`] = email.toLowerCase(); });
  }

  sql += ` GROUP BY a.EMAIL, e.DISPLAY_NAME, e.DEPARTMENT ORDER BY e.DISPLAY_NAME`;

  const rows = await query<{
    EMAIL: string; DISPLAY_NAME: string; DEPARTMENT: string;
    TOTAL_DAYS: number; OFFICE_DAYS: number; REMOTE_DAYS: number; PTO_DAYS: number;
  }>(sql, params);

  return rows.map((r) => {
    const workDays = (r.TOTAL_DAYS || 0) - (r.PTO_DAYS || 0);
    const requiredDays = Math.ceil((workDays / 5) * requiredOfficeDays);
    const officeDays = r.OFFICE_DAYS || 0;
    const complianceRate = requiredDays > 0 ? Math.min(100, Math.round((officeDays / requiredDays) * 100)) : 100;

    return {
      email: r.EMAIL, displayName: r.DISPLAY_NAME || r.EMAIL,
      department: r.DEPARTMENT || 'Unknown',
      totalDays: r.TOTAL_DAYS || 0, officeDays,
      remoteDays: r.REMOTE_DAYS || 0, ptoDays: r.PTO_DAYS || 0,
      complianceRate, isCompliant: complianceRate >= 100,
    };
  });
}

// ============================================================================
// Office Attendance Report — queries V_ATTENDANCE_WEEKLY + V_PTO_WEEKLY views
// ============================================================================

export interface AttendanceReportResult {
  rows: AttendanceRow[];
  weeks: string[];
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

  const [attRows, ptoRows, empRows] = await Promise.all([
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
      `SELECT LOWER(EMAIL) AS EMAIL, NVL(DISPLAY_NAME, EMAIL) AS DISPLAY_NAME, NVL(DEPARTMENT, 'Unknown') AS DEPARTMENT, NVL(LOCATION, 'Unknown') AS LOCATION FROM TL_EMPLOYEES WHERE EMAIL IS NOT NULL AND (STATUS IS NULL OR UPPER(STATUS) != 'INACTIVE')${empEmailFilter}`,
      empParams,
    ),
  ]);

  // --- Index PTO by email|week ---
  const ptoMap = new Map<string, number>();
  for (const r of ptoRows) {
    const wk = toDateStr(r.WEEK_START);
    ptoMap.set(`${r.EMAIL?.toLowerCase()}|${wk}`, r.PTO_DAYS || 0);
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
    empWeeks.get(email)!.weeks[wk] = {
      officeDays: r.OFFICE_DAYS || 0,
      remoteDays: r.REMOTE_DAYS || 0,
      ptoDays: ptoMap.get(`${email}|${wk}`) || 0,
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

  // --- Build flat rows (no business logic — just shape for the client) ---
  const rows: AttendanceRow[] = [];
  const deptSet = new Set<string>();
  const locSet = new Set<string>();

  for (const [email, data] of empWeeks) {
    let total = 0;
    let compliantWeeks = 0;

    for (const wk of weeks) {
      const cell = data.weeks[wk];
      if (cell) {
        total += cell.officeDays;
        if (cell.officeDays >= officeDaysRequired) compliantWeeks++;
      }
    }

    const numWeeks = weeks.length;
    const compliant = numWeeks > 0 && compliantWeeks === numWeeks;

    // Trend: last 2 weeks
    let trend: 'up' | 'down' | 'flat' = 'flat';
    if (weeks.length >= 2) {
      const a = data.weeks[weeks[weeks.length - 2]!]?.officeDays || 0;
      const b = data.weeks[weeks[weeks.length - 1]!]?.officeDays || 0;
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
      avgPerWeek: numWeeks > 0 ? Math.round((total / numWeeks) * 10) / 10 : 0,
      compliant,
      trend,
    });
  }

  // --- Summary ---
  const totalEmployees = rows.length;
  const totalOfficeDays = rows.reduce((s, r) => s + r.total, 0);
  const numWeeks = weeks.length;
  const avgOfficeDays = totalEmployees > 0 && numWeeks > 0
    ? Math.round((totalOfficeDays / totalEmployees / numWeeks) * 10) / 10
    : 0;
  const compliantCount = rows.filter((r) => r.compliant).length;
  const complianceRate = totalEmployees > 0 ? Math.round((compliantCount / totalEmployees) * 100) : 0;
  const zeroAttendanceCount = rows.filter((r) => r.total === 0).length;

  return {
    rows,
    weeks,
    departments: [...deptSet].sort(),
    locations: [...locSet].sort(),
    summary: { totalEmployees, avgOfficeDays, complianceRate, zeroAttendanceCount },
  };
}

function toDateStr(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().split('T')[0]!;
}

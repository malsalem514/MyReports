import { query } from './oracle';
import type { AttendanceRemoteWorkRequest, AttendanceRow, AttendanceSummary, WeekCell } from './types/attendance';

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
  remoteWorkdayPolicyAssigned: boolean;
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

export interface BambooNotInActivTrakEmployee {
  employeeId: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  department: string | null;
  division: string | null;
  location: string | null;
  supervisorEmail: string | null;
  hireDate: Date | null;
  status: string | null;
  tbsEmployeeNo: number | null;
  tbsEmployeeName: string | null;
  activTrakUser: string | null;
  actrkId: number | null;
  hasActivTrakMapping: boolean;
  hasActivTrakUser: boolean;
}

export interface SuspiciousActivTrakIdentity {
  email: string;
  displayName: string | null;
  department: string | null;
  location: string | null;
  tbsEmployeeNo: number | null;
  actrkId: number | null;
  actrkEmployeeName: string | null;
  activTrakUserName: string | null;
  identifiers: string | null;
  identifierCount: number;
  activityRowCount: number;
  firstSeen: Date | null;
  lastSeen: Date | null;
  hasNoIdentifier: boolean;
  hasIdentifierMismatch: boolean;
  hasDeviceStyleIdentifier: boolean;
  hasNonEmailIdentifier: boolean;
  hasNonCorporateDomain: boolean;
  hasNoActivity: boolean;
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
    HIRE_DATE: Date; STATUS: string; REMOTE_WORKDAY_POLICY_ASSIGNED: number | null;
  }>(sql, params);

  return rows.map((r) => ({
    id: r.ID, email: r.EMAIL, displayName: r.DISPLAY_NAME,
    firstName: r.FIRST_NAME, lastName: r.LAST_NAME, jobTitle: r.JOB_TITLE,
    department: r.DEPARTMENT, division: r.DIVISION, location: r.LOCATION,
    supervisorId: r.SUPERVISOR_ID, supervisorEmail: r.SUPERVISOR_EMAIL,
    hireDate: r.HIRE_DATE, status: r.STATUS,
    remoteWorkdayPolicyAssigned: r.REMOTE_WORKDAY_POLICY_ASSIGNED === 1,
  }));
}

export async function getBambooNotInActivTrakEmployees(): Promise<BambooNotInActivTrakEmployee[]> {
  const rows = await query<{
    EMPLOYEE_ID: string;
    EMAIL: string;
    DISPLAY_NAME: string;
    FIRST_NAME: string;
    LAST_NAME: string;
    JOB_TITLE: string;
    DEPARTMENT: string;
    DIVISION: string;
    LOCATION: string;
    SUPERVISOR_EMAIL: string;
    HIRE_DATE: Date;
    STATUS: string;
    TBS_EMPLOYEE_NO: number | null;
    TBS_EMPLOYEE_NAME: string | null;
    ACTIVTRAK_USER: string | null;
    ACTRK_ID: number | null;
    HAS_ACTIVTRAK_MAPPING: number;
    HAS_ACTIVTRAK_USER: number;
  }>(`
    SELECT *
    FROM V_USER_MAPPINGS
    ORDER BY DISPLAY_NAME, EMAIL
  `);

  return rows.map((r) => ({
    employeeId: r.EMPLOYEE_ID,
    email: r.EMAIL,
    displayName: r.DISPLAY_NAME,
    firstName: r.FIRST_NAME,
    lastName: r.LAST_NAME,
    jobTitle: r.JOB_TITLE,
    department: r.DEPARTMENT,
    division: r.DIVISION,
    location: r.LOCATION,
    supervisorEmail: r.SUPERVISOR_EMAIL,
    hireDate: r.HIRE_DATE,
    status: r.STATUS,
    tbsEmployeeNo: r.TBS_EMPLOYEE_NO,
    tbsEmployeeName: r.TBS_EMPLOYEE_NAME,
    activTrakUser: r.ACTIVTRAK_USER,
    actrkId: r.ACTRK_ID,
    hasActivTrakMapping: r.HAS_ACTIVTRAK_MAPPING === 1,
    hasActivTrakUser: r.HAS_ACTIVTRAK_USER === 1,
  }));
}

export async function getSuspiciousActivTrakIdentities(): Promise<SuspiciousActivTrakIdentity[]> {
  const rows = await query<{
    EMAIL: string;
    DISPLAY_NAME: string | null;
    DEPARTMENT: string | null;
    LOCATION: string | null;
    TBS_EMPLOYEE_NO: number | null;
    ACTRK_ID: number | null;
    ACTRK_EMPLOYEE_NAME: string | null;
    ACTIVTRAK_USER_NAME: string | null;
    IDENTIFIERS: string | null;
    IDENTIFIER_COUNT: number | null;
    ACTIVITY_ROW_COUNT: number | null;
    FIRST_SEEN: Date | null;
    LAST_SEEN: Date | null;
    HAS_NO_IDENTIFIER: number | null;
    HAS_IDENTIFIER_MISMATCH: number | null;
    HAS_DEVICE_STYLE_IDENTIFIER: number | null;
    HAS_NON_EMAIL_IDENTIFIER: number | null;
    HAS_NON_CORPORATE_DOMAIN: number | null;
    HAS_NO_ACTIVITY: number | null;
  }>(`
    SELECT *
    FROM V_SUSPICIOUS_ACTIVTRAK_IDENTITIES
    ORDER BY
      HAS_NO_IDENTIFIER DESC,
      HAS_IDENTIFIER_MISMATCH DESC,
      HAS_NO_ACTIVITY DESC,
      HAS_DEVICE_STYLE_IDENTIFIER DESC,
      DISPLAY_NAME,
      EMAIL
  `);

  return rows.map((row) => ({
    email: row.EMAIL,
    displayName: row.DISPLAY_NAME,
    department: row.DEPARTMENT,
    location: row.LOCATION,
    tbsEmployeeNo: row.TBS_EMPLOYEE_NO,
    actrkId: row.ACTRK_ID,
    actrkEmployeeName: row.ACTRK_EMPLOYEE_NAME,
    activTrakUserName: row.ACTIVTRAK_USER_NAME,
    identifiers: row.IDENTIFIERS,
    identifierCount: row.IDENTIFIER_COUNT || 0,
    activityRowCount: row.ACTIVITY_ROW_COUNT || 0,
    firstSeen: row.FIRST_SEEN,
    lastSeen: row.LAST_SEEN,
    hasNoIdentifier: row.HAS_NO_IDENTIFIER === 1,
    hasIdentifierMismatch: row.HAS_IDENTIFIER_MISMATCH === 1,
    hasDeviceStyleIdentifier: row.HAS_DEVICE_STYLE_IDENTIFIER === 1,
    hasNonEmailIdentifier: row.HAS_NON_EMAIL_IDENTIFIER === 1,
    hasNonCorporateDomain: row.HAS_NON_CORPORATE_DOMAIN === 1,
    hasNoActivity: row.HAS_NO_ACTIVITY === 1,
  }));
}

export async function getEmployeeByEmail(email: string): Promise<Employee | null> {
  const rows = await query<{
    ID: string; EMAIL: string; DISPLAY_NAME: string; FIRST_NAME: string;
    LAST_NAME: string; JOB_TITLE: string; DEPARTMENT: string; DIVISION: string;
    LOCATION: string; SUPERVISOR_ID: string; SUPERVISOR_EMAIL: string;
    HIRE_DATE: Date; STATUS: string; REMOTE_WORKDAY_POLICY_ASSIGNED: number | null;
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
    remoteWorkdayPolicyAssigned: r.REMOTE_WORKDAY_POLICY_ASSIGNED === 1,
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
  remoteWorkRequests: AttendanceRemoteWorkRequest[];
  weeks: string[];
  /** Completed weeks that have actual attendance data — used for avg/compliance in client */
  dataWeeks: string[];
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

  const [attRows, empRows, dailyRows, ptoDailyRows, remoteWorkRows] = await Promise.all([
    query<{
      EMAIL: string; DISPLAY_NAME: string; DEPARTMENT: string;
      OFFICE_LOCATION: string; WEEK_START: Date;
      OFFICE_DAYS: number; REMOTE_DAYS: number;
    }>(
      `SELECT * FROM V_ATTENDANCE_WEEKLY WHERE WEEK_START BETWEEN TRUNC(:sd, 'IW') AND TRUNC(:ed, 'IW')${emailFilter}`,
      params,
    ),
    query<{
      EMAIL: string;
      DISPLAY_NAME: string;
      DEPARTMENT: string;
      LOCATION: string;
      MANAGER_NAME: string;
      MANAGER_EMAIL: string | null;
      HAS_ACTIVTRAK_USER: number;
    }>(
      `SELECT
         m.EMAIL,
         NVL(m.DISPLAY_NAME, m.EMAIL) AS DISPLAY_NAME,
         NVL(m.DEPARTMENT, 'Unknown') AS DEPARTMENT,
         NVL(m.LOCATION, 'Unknown') AS LOCATION,
         NVL(e.SUPERVISOR_NAME, 'Unassigned') AS MANAGER_NAME,
         LOWER(e.SUPERVISOR_EMAIL) AS MANAGER_EMAIL,
         NVL(m.HAS_ACTIVTRAK_USER, 0) AS HAS_ACTIVTRAK_USER
       FROM V_USER_MAPPINGS m
       LEFT JOIN TL_EMPLOYEES e
         ON LOWER(e.EMAIL) = m.EMAIL
       WHERE 1 = 1${empEmailFilter}`,
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
    query<{ EMAIL: string; PTO_DATE: string; TYPE: string | null }>(
      `SELECT DISTINCT
         LOWER(t.EMAIL) AS EMAIL,
         TO_CHAR(TRUNC(PTO_DATE), 'YYYY-MM-DD') AS PTO_DATE,
         t.TYPE
       FROM (
        SELECT EMAIL, TRUNC(START_DATE) + LEVEL - 1 AS PTO_DATE, TYPE
        FROM TL_TIME_OFF t
        WHERE START_DATE <= :ed AND END_DATE >= :sd
          AND STATUS != 'denied'${emails && emails.length > 0
            ? ` AND LOWER(EMAIL) IN (${emails.map((_, i) => `:pe${i}`).join(',')})`
            : ''}
        CONNECT BY LEVEL <= (TRUNC(END_DATE) - TRUNC(START_DATE) + 1)
          AND PRIOR ROWID = ROWID
          AND PRIOR SYS_GUID() IS NOT NULL
      ) t
      WHERE TRUNC(PTO_DATE) BETWEEN :sd AND :ed
        AND TO_CHAR(PTO_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')`,
      {
        sd: startDate,
        ed: endDate,
        ...(emails && emails.length > 0
          ? Object.fromEntries(emails.map((email, i) => [`pe${i}`, email.toLowerCase()]))
          : {}),
      },
    ),
    query<{
      BAMBOO_ROW_ID: number;
      EMPLOYEE_ID: string;
      EMAIL: string | null;
      EMPLOYEE_NAME: string | null;
      DEPARTMENT: string | null;
      OFFICE_LOCATION: string | null;
      REQUEST_DATE: Date | null;
      REMOTE_WORK_START_DATE: Date;
      REMOTE_WORK_END_DATE: Date | null;
      REMOTE_WORK_TYPE: string | null;
      REASON: string | null;
      SUPPORTING_DOCUMENTATION_SUBMITTED: string | null;
      ALTERNATE_IN_OFFICE_WORK_DATE: string | null;
      MANAGER_APPROVAL_RECEIVED: string | null;
      MANAGER_NAME: string | null;
    }>(
      `SELECT
         r.BAMBOO_ROW_ID,
         r.EMPLOYEE_ID,
         LOWER(r.EMAIL) AS EMAIL,
         r.EMPLOYEE_NAME,
         r.DEPARTMENT,
         NVL(e.LOCATION, 'Unknown') AS OFFICE_LOCATION,
         r.REQUEST_DATE,
         r.REMOTE_WORK_START_DATE,
         r.REMOTE_WORK_END_DATE,
         r.REMOTE_WORK_TYPE,
         r.REASON,
         r.SUPPORTING_DOCUMENTATION_SUBMITTED,
         r.ALTERNATE_IN_OFFICE_WORK_DATE,
         r.MANAGER_APPROVAL_RECEIVED,
         r.MANAGER_NAME
       FROM TL_REMOTE_WORK_REQUESTS r
       LEFT JOIN TL_EMPLOYEES e
         ON LOWER(e.EMAIL) = LOWER(r.EMAIL)
       WHERE r.REMOTE_WORK_START_DATE <= :ed
         AND NVL(r.REMOTE_WORK_END_DATE, DATE '2999-12-31') >= :sd${emails && emails.length > 0
           ? ` AND LOWER(r.EMAIL) IN (${emails.map((_, i) => `:re${i}`).join(',')})`
           : ''}
       ORDER BY r.REMOTE_WORK_START_DATE DESC, LOWER(r.EMAIL), r.BAMBOO_ROW_ID DESC`,
      {
        sd: startDate,
        ed: endDate,
        ...(emails && emails.length > 0
          ? Object.fromEntries(emails.map((email, i) => [`re${i}`, email.toLowerCase()]))
          : {}),
      },
    ),
  ]);

  const officeEmployeeEmails = [...new Set(
    empRows
      .map((employee) => employee.EMAIL?.toLowerCase())
      .filter((email): email is string => !!email),
  )];

  const [productivityDailyRows, tbsMapRows] = officeEmployeeEmails.length > 0
    ? await Promise.all([
        query<{ EMAIL: string; RECORD_DATE: Date; TOTAL_TIME: number | null }>(
          `SELECT LOWER(p.EMAIL) AS EMAIL, p.RECORD_DATE, p.TOTAL_TIME
           FROM TL_PRODUCTIVITY p
           WHERE p.RECORD_DATE BETWEEN :sd AND :ed
             AND LOWER(p.EMAIL) IN (${officeEmployeeEmails.map((_, i) => `:pa${i}`).join(',')})`,
          {
            sd: startDate,
            ed: endDate,
            ...Object.fromEntries(officeEmployeeEmails.map((email, i) => [`pa${i}`, email])),
          },
        ),
        query<{ EMAIL: string; TBS_EMPLOYEE_NO: number }>(
          `SELECT LOWER(EMAIL) AS EMAIL, TBS_EMPLOYEE_NO
           FROM TL_TBS_EMPLOYEE_MAP
           WHERE LOWER(EMAIL) IN (${officeEmployeeEmails.map((_, i) => `:tm${i}`).join(',')})`,
          Object.fromEntries(officeEmployeeEmails.map((email, i) => [`tm${i}`, email])),
        ),
      ])
    : [[], []];

  const tbsEmployeeNos = [...new Set(
    tbsMapRows
      .map((row) => row.TBS_EMPLOYEE_NO)
      .filter((employeeNo): employeeNo is number => typeof employeeNo === 'number'),
  )];

  const tbsDailyRows = tbsEmployeeNos.length > 0
    ? await query<{
        EMPLOYEE_NO: number;
        ENTRY_DATE: Date;
        WORK_CODE: string | null;
        WORK_DESCRIPTION: string | null;
        TIME_HOURS: number | null;
        ENTRY_TYPE: string | null;
      }>(
        `SELECT EMPLOYEE_NO, ENTRY_DATE, WORK_CODE, WORK_DESCRIPTION, TIME_HOURS, ENTRY_TYPE
         FROM TBS_ALL_TIME_ENTRIES_V@TBS_LINK
         WHERE EMPLOYEE_NO IN (${tbsEmployeeNos.map((_, i) => `:tn${i}`).join(',')})
           AND ENTRY_DATE BETWEEN :sd AND :ed`,
        {
          sd: startDate,
          ed: endDate,
          ...Object.fromEntries(tbsEmployeeNos.map((employeeNo, i) => [`tn${i}`, employeeNo])),
        },
      )
    : [];

  // --- Index PTO by email|week ---
  const ptoMap = new Map<string, number>();
  const ptoWeekDates = new Map<string, Set<string>>();
  const approvedRemoteWorkEmails = new Set<string>();
  const approvedRemoteWorkTypesByEmail = new Map<string, Set<string>>();
  const remoteWorkRequests: AttendanceRemoteWorkRequest[] = [];

  // --- Index daily detail by email|week → DayDetail[] ---
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  type AttendanceDayAccumulator = {
    date: string;
    dayLabel: string;
    location: string;
    ptoType: string | null;
    tbsReportedHours: number;
    activeHours: number;
  };
  const dailyMap = new Map<string, AttendanceDayAccumulator[]>();
  const tbsToEmail = new Map(tbsMapRows.map((row) => [row.TBS_EMPLOYEE_NO, row.EMAIL.toLowerCase()]));
  const tbsAbsenceCodes = new Set([
    'VACATION', 'ILLNESS', 'MISC. ABS./APPTS', 'ALTERNATE DAY',
    'SICK', 'PERSONAL', 'BEREAVEMENT', 'JURY DUTY',
  ]);

  const ensureDailyEntry = (email: string, dateInput: Date | string) => {
    const date = dateInput instanceof Date ? new Date(dateInput) : parseLocalDate(dateInput);
    const dateStr = toDateStr(date);
    const dayOfWeek = date.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(date);
    monday.setDate(monday.getDate() + mondayOffset);
    const wk = toDateStr(monday);
    const key = `${email}|${wk}`;

    if (!dailyMap.has(key)) dailyMap.set(key, []);

    let entry = dailyMap.get(key)!.find((day) => day.date === dateStr);
    if (!entry) {
      entry = {
        date: dateStr,
        dayLabel: DAY_LABELS[date.getDay()] || '',
        location: 'Unknown',
        ptoType: null,
        tbsReportedHours: 0,
        activeHours: 0,
      };
      dailyMap.get(key)!.push(entry);
    }

    return entry;
  };

  for (const r of dailyRows) {
    const email = r.EMAIL?.toLowerCase();
    if (!email) continue;
    const d = r.RECORD_DATE instanceof Date ? r.RECORD_DATE : new Date(r.RECORD_DATE);
    const entry = ensureDailyEntry(email, d);
    entry.location = r.IS_PTO === 1 ? 'PTO' : (r.LOCATION || 'Unknown');
    entry.ptoType = r.IS_PTO === 1 ? r.PTO_TYPE : null;
  }

  for (const r of ptoDailyRows) {
    const email = r.EMAIL?.toLowerCase();
    if (!email) continue;
    const d = parseLocalDate(r.PTO_DATE);
    const dateStr = r.PTO_DATE.slice(0, 10);
    const dayOfWeek = d.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(d);
    monday.setDate(monday.getDate() + mondayOffset);
    const wk = toDateStr(monday);
    const key = `${email}|${wk}`;
    if (!ptoWeekDates.has(key)) ptoWeekDates.set(key, new Set());
    ptoWeekDates.get(key)!.add(dateStr);

    const entry = ensureDailyEntry(email, d);
    entry.location = 'PTO';
    entry.ptoType = r.TYPE || null;
  }

  for (const record of productivityDailyRows) {
    const email = record.EMAIL?.toLowerCase();
    if (!email) continue;
    const entry = ensureDailyEntry(email, record.RECORD_DATE);
    entry.activeHours = roundHours(Math.max(0, record.TOTAL_TIME || 0));
  }

  for (const entry of tbsDailyRows) {
    const email = tbsToEmail.get(entry.EMPLOYEE_NO);
    if (!email) continue;
    const desc = (entry.WORK_DESCRIPTION || entry.WORK_CODE || '').toUpperCase().trim();
    const isAbsence = tbsAbsenceCodes.has(desc) || entry.ENTRY_TYPE === 'C';
    if (isAbsence) continue;

    const dayEntry = ensureDailyEntry(email, entry.ENTRY_DATE);
    dayEntry.tbsReportedHours = roundToTenth(dayEntry.tbsReportedHours + Math.max(0, entry.TIME_HOURS || 0));
  }

  for (const row of remoteWorkRows) {
    const email = row.EMAIL?.toLowerCase();
    const approvalValue = (row.MANAGER_APPROVAL_RECEIVED || '').trim().toUpperCase();
    const isApprovedRemoteWork = approvalValue === 'YES' || approvalValue === 'APPROVED';

    if (email && isApprovedRemoteWork) {
      approvedRemoteWorkEmails.add(email);
    }
    const type = row.REMOTE_WORK_TYPE?.trim();
    if (email && type && isApprovedRemoteWork) {
      if (!approvedRemoteWorkTypesByEmail.has(email)) {
        approvedRemoteWorkTypesByEmail.set(email, new Set());
      }
      approvedRemoteWorkTypesByEmail.get(email)!.add(type);
    }
    remoteWorkRequests.push({
      bambooRowId: row.BAMBOO_ROW_ID,
      employeeId: row.EMPLOYEE_ID,
      email: email || '',
      employeeName: row.EMPLOYEE_NAME || email || 'Unknown',
      department: row.DEPARTMENT || 'Unknown',
      officeLocation: row.OFFICE_LOCATION || 'Unknown',
      requestDate: row.REQUEST_DATE ? toDateStr(row.REQUEST_DATE) : null,
      remoteWorkStartDate: toDateStr(row.REMOTE_WORK_START_DATE),
      remoteWorkEndDate: row.REMOTE_WORK_END_DATE ? toDateStr(row.REMOTE_WORK_END_DATE) : null,
      remoteWorkType: row.REMOTE_WORK_TYPE || null,
      reason: row.REASON || null,
      supportingDocumentationSubmitted: row.SUPPORTING_DOCUMENTATION_SUBMITTED || null,
      alternateInOfficeWorkDate: row.ALTERNATE_IN_OFFICE_WORK_DATE || null,
      managerApprovalReceived: row.MANAGER_APPROVAL_RECEIVED || null,
      managerName: row.MANAGER_NAME || null,
    });
  }

  for (const [key, days] of ptoWeekDates) {
    ptoMap.set(key, days.size);
  }

  // Sort each week's days by date
  for (const days of dailyMap.values()) {
    days.sort((a, b) => a.date.localeCompare(b.date));
  }

  function getRemoteWorkStatusLabel(email: string): string {
    const types = approvedRemoteWorkTypesByEmail.get(email);
    if (!types || types.size === 0) {
      return approvedRemoteWorkEmails.has(email) ? 'Approved Remote Work' : 'Standard Policy';
    }
    return `Approved (${[...types].sort((a, b) => a.localeCompare(b)).join(', ')})`;
  }

  // --- Index attendance by employee ---
  const empWeeks = new Map<string, {
    name: string; department: string; managerName: string; managerEmail: string | null; officeLocation: string;
    hasActivTrakCoverage: boolean;
    approvedRemoteWorkRequest: boolean;
    remoteWorkStatusLabel: string;
    weeks: Record<string, WeekCell>;
  }>();
  const employeeMetaByEmail = new Map(
    empRows.map((employee) => [employee.EMAIL.toLowerCase(), employee]),
  );

  for (const r of attRows) {
    const email = r.EMAIL?.toLowerCase();
    if (!email) continue;
    const wk = toDateStr(r.WEEK_START);
    const employeeMeta = employeeMetaByEmail.get(email);

    if (!empWeeks.has(email)) {
      empWeeks.set(email, {
        name: r.DISPLAY_NAME || email,
        department: employeeMeta?.DEPARTMENT || r.DEPARTMENT || 'Unknown',
        managerName: employeeMeta?.MANAGER_NAME || 'Unassigned',
        managerEmail: employeeMeta?.MANAGER_EMAIL || null,
        officeLocation: employeeMeta?.LOCATION || r.OFFICE_LOCATION || 'Unknown',
        hasActivTrakCoverage: employeeMeta ? employeeMeta.HAS_ACTIVTRAK_USER === 1 : true,
        approvedRemoteWorkRequest: approvedRemoteWorkEmails.has(email),
        remoteWorkStatusLabel: getRemoteWorkStatusLabel(email),
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
        location: dd.location as 'Office' | 'Remote' | 'PTO' | 'Unknown',
        ptoType: dd.ptoType,
        tbsReportedHours: dd.tbsReportedHours,
        activeHours: dd.activeHours,
      })),
    };
  }

  for (const [key, ptoDays] of ptoMap) {
    const [email, wk] = key.split('|');
    if (!email || !wk) continue;
    const employee = employeeMetaByEmail.get(email);

    if (!empWeeks.has(email)) {
      empWeeks.set(email, {
        name: employee?.DISPLAY_NAME || email,
        department: employee?.DEPARTMENT || 'Unknown',
        managerName: employee?.MANAGER_NAME || 'Unassigned',
        managerEmail: employee?.MANAGER_EMAIL || null,
        officeLocation: employee?.LOCATION || 'Unknown',
        hasActivTrakCoverage: employee?.HAS_ACTIVTRAK_USER === 1,
        approvedRemoteWorkRequest: approvedRemoteWorkEmails.has(email),
        remoteWorkStatusLabel: getRemoteWorkStatusLabel(email),
        weeks: {},
      });
    }

    const current = empWeeks.get(email)!.weeks[wk];
    const dailyDetails = dailyMap.get(`${email}|${wk}`) || [];
    empWeeks.get(email)!.weeks[wk] = {
      officeDays: current?.officeDays || 0,
      remoteDays: current?.remoteDays || 0,
      ptoDays,
      days: dailyDetails.map((dd) => ({
        date: dd.date,
        dayLabel: dd.dayLabel,
        location: dd.location as 'Office' | 'Remote' | 'PTO' | 'Unknown',
        ptoType: dd.ptoType,
        tbsReportedHours: dd.tbsReportedHours,
        activeHours: dd.activeHours,
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
      managerName: emp.MANAGER_NAME || 'Unassigned',
      managerEmail: emp.MANAGER_EMAIL || null,
      officeLocation: emp.LOCATION || 'Unknown',
      hasActivTrakCoverage: emp.HAS_ACTIVTRAK_USER === 1,
      approvedRemoteWorkRequest: approvedRemoteWorkEmails.has(email),
      remoteWorkStatusLabel: getRemoteWorkStatusLabel(email),
      weeks: {},
    });
  }

  // --- Current-week detection (partial week — exclude from compliance/avg) ---
  const now = new Date();
  const currentDow = now.getDay(); // 0=Sun
  const currentMondayOffset = currentDow === 0 ? -6 : 1 - currentDow;
  const currentMonday = new Date(now);
  currentMonday.setDate(currentMonday.getDate() + currentMondayOffset);
  currentMonday.setHours(0, 0, 0, 0);
  const currentWeekStr = toDateStr(currentMonday);
  const endWeek = new Date(endDate);
  const endDow = endWeek.getDay();
  endWeek.setDate(endWeek.getDate() + (endDow === 0 ? -6 : 1 - endDow));
  endWeek.setHours(0, 0, 0, 0);
  const endWeekStr = toDateStr(endWeek);

  // --- Generate ALL ISO weeks in the requested range for column display ---
  // This ensures 16-week view always shows 16 columns regardless of data availability.
  const allIsoWeeks: string[] = [];
  {
    const cur = new Date(startDate);
    const dow = cur.getDay();
    cur.setDate(cur.getDate() + (dow === 0 ? -6 : 1 - dow)); // rewind to ISO Monday
    cur.setHours(0, 0, 0, 0);
    while (toDateStr(cur) <= endWeekStr) {
      allIsoWeeks.push(toDateStr(cur));
      cur.setDate(cur.getDate() + 7);
    }
  }
  const weeks = allIsoWeeks;
  const isCurrentWeekInRange = weeks.includes(currentWeekStr);

  // --- Completed weeks in the selected range (current week excluded when present) ---
  const completedDataWeeks = weeks.filter((w) => w !== currentWeekStr);
  const numCompletedWeeks = completedDataWeeks.length;

  // --- Build flat rows ---
  const rows: AttendanceRow[] = [];
  const deptSet = new Set<string>();
  const locSet = new Set<string>();

  for (const [email, data] of empWeeks) {
    let total = 0;          // all weeks including current (for Total column)
    let completedTotal = 0; // completed data weeks only (for Avg)
    let compliantWeekCount = 0;
    let excusedWeekCount = 0;

    // Total: sum over all display weeks (empty weeks contribute 0)
    for (const wk of weeks) {
      total += (data.weeks[wk]?.officeDays ?? 0);
    }

    // Compliance + avg: only over completed data weeks (weeks with any actual records)
    for (const wk of completedDataWeeks) {
      const cell = data.weeks[wk];
      const officeDays = cell?.officeDays ?? 0;
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

    // Trend: compare last two completed data weeks
    let trend: 'up' | 'down' | 'flat' = 'flat';
    if (completedDataWeeks.length >= 2) {
      const a = data.weeks[completedDataWeeks[completedDataWeeks.length - 2]!]?.officeDays || 0;
      const b = data.weeks[completedDataWeeks[completedDataWeeks.length - 1]!]?.officeDays || 0;
      if (b > a) trend = 'up';
      else if (b < a) trend = 'down';
    }

    if (data.department !== 'Unknown') deptSet.add(data.department);
    if (data.officeLocation !== 'Unknown') locSet.add(data.officeLocation);

    rows.push({
      email,
      name: data.name,
      department: data.department,
      managerName: data.managerName,
      managerEmail: data.managerEmail,
      officeLocation: data.officeLocation,
      hasActivTrakCoverage: data.hasActivTrakCoverage,
      approvedRemoteWorkRequest: data.approvedRemoteWorkRequest,
      remoteWorkStatusLabel: data.remoteWorkStatusLabel,
      weeks: data.weeks,
      total,
      avgPerWeek: numCompletedWeeks > 0 ? Math.round((completedTotal / numCompletedWeeks) * 10) / 10 : 0,
      compliant,
      trend,
    });
  }

  // --- Summary ---
  const totalEmployees = rows.length;
  let compliantCount = 0;
  let zeroOfficeDaysCount = 0;
  let sumCompletedOfficeDays = 0;
  let coveredEmployeesCount = 0;
  let unknownCoverageCount = 0;
  for (const r of rows) {
    if (!r.hasActivTrakCoverage) {
      unknownCoverageCount++;
      continue;
    }
    coveredEmployeesCount++;
    if (r.compliant) compliantCount++;
    if (r.total === 0) zeroOfficeDaysCount++;
    for (const wk of completedDataWeeks) {
      sumCompletedOfficeDays += r.weeks[wk]?.officeDays ?? 0;
    }
  }
  const avgOfficeDays = coveredEmployeesCount > 0 && numCompletedWeeks > 0
    ? Math.round((sumCompletedOfficeDays / coveredEmployeesCount / numCompletedWeeks) * 10) / 10
    : 0;
  const complianceRate = coveredEmployeesCount > 0 ? Math.round((compliantCount / coveredEmployeesCount) * 100) : 0;

  return {
    rows,
    remoteWorkRequests,
    weeks,
    dataWeeks: completedDataWeeks,
    currentWeek: isCurrentWeekInRange ? currentWeekStr : null,
    departments: [...deptSet].sort(),
    locations: [...locSet].sort(),
    summary: { totalEmployees, avgOfficeDays, complianceRate, zeroOfficeDaysCount, unknownCoverageCount },
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

export interface WorkingHoursDayRow {
  date: string;
  dayLabel: string;
  hasActivTrakData: boolean;
  tbsReportedHours: number;
  tbsAbsenceHours: number;
  activeHours: number;
  activeInputHours: number;
  workedVsReportedPct: number | null;
  productiveActiveHours: number;
  productivePassiveHours: number;
  undefinedActiveHours: number;
  undefinedPassiveHours: number;
  unproductiveActiveHours: number;
  focusHours: number;
  collaborationHours: number;
  breakHours: number;
  productivityScore: number | null;
  utilizationLevel: string | null;
  location: string | null;
  timeOffHours: number;
  timeOffType: string | null;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  approvedLeave: WorkingHoursApprovedLeave[];
  tbsLineEntries: WorkingHoursTbsLineEntry[];
}

export interface WorkingHoursApprovedLeave {
  type: string | null;
  amount: number;
  unit: string | null;
  status: string | null;
}

export interface WorkingHoursTbsLineEntry {
  workCode: string | null;
  workDescription: string | null;
  entryType: string | null;
  hours: number;
  isAbsence: boolean;
  remark: string | null;
  defectCase: string | null;
}

export interface WorkingHoursEmployeeWeekRow {
  email: string;
  name: string;
  group: string;
  tbsEmployeeNo: number | null;
  weekStart: string;
  hasActivTrakData: boolean;
  tbsReportedHours: number;
  tbsAbsenceHours: number;
  activeHours: number;
  workedVsReportedPct: number | null;
  productiveActiveHours: number;
  productivePassiveHours: number;
  undefinedActiveHours: number;
  undefinedPassiveHours: number;
  unproductiveActiveHours: number;
  days: WorkingHoursDayRow[];
}

export interface WorkingHoursWeekGroup {
  weekStart: string;
  tbsReportedHours: number;
  tbsAbsenceHours: number;
  activeHours: number;
  workedVsReportedPct: number | null;
  productiveActiveHours: number;
  productivePassiveHours: number;
  undefinedActiveHours: number;
  undefinedPassiveHours: number;
  unproductiveActiveHours: number;
  employees: WorkingHoursEmployeeWeekRow[];
}

export interface WorkingHoursReportResult {
  weeks: WorkingHoursWeekGroup[];
  groups: string[];
  employeeNumbers: number[];
  users: string[];
  weekOptions: string[];
  lastSyncedAt: string | null;
}

interface WorkingHoursMetricAccumulator {
  tbsReportedSeconds: number;
  tbsAbsenceSeconds: number;
  activeSeconds: number;
  productiveActiveSeconds: number;
  productivePassiveSeconds: number;
  undefinedActiveSeconds: number;
  undefinedPassiveSeconds: number;
  unproductiveActiveSeconds: number;
}

interface WorkingHoursEmployeeAccumulator extends WorkingHoursMetricAccumulator {
  email: string;
  name: string;
  group: string;
  tbsEmployeeNo: number | null;
  weekStart: string;
  hasActivTrakData: boolean;
  days: Map<string, WorkingHoursDayRow>;
}

interface WorkingHoursWeekAccumulator extends WorkingHoursMetricAccumulator {
  weekStart: string;
  employees: WorkingHoursEmployeeWeekRow[];
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
    query<{ EMAIL: string; PTO_DATE: string; TYPE: string }>(
      `SELECT DISTINCT
         LOWER(t.EMAIL) AS EMAIL,
         TO_CHAR(TRUNC(PTO_DATE), 'YYYY-MM-DD') AS PTO_DATE,
         t.TYPE
       FROM (
        SELECT EMAIL, TRUNC(START_DATE) + LEVEL - 1 AS PTO_DATE, TYPE
        FROM TL_TIME_OFF
        WHERE LOWER(EMAIL) IN (${emailPlaceholders})
          AND START_DATE <= :ed AND END_DATE >= :sd
          AND STATUS != 'denied'
        CONNECT BY LEVEL <= (TRUNC(END_DATE) - TRUNC(START_DATE) + 1)
          AND PRIOR ROWID = ROWID
          AND PRIOR SYS_GUID() IS NOT NULL
      ) t
      WHERE TRUNC(PTO_DATE) BETWEEN :sd AND :ed
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
    const d = r.PTO_DATE.slice(0, 10);
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

export async function getWorkingHoursReport(
  startDate: Date,
  endDate: Date,
  emails?: string[],
): Promise<WorkingHoursReportResult> {
  const productivityParams: Record<string, unknown> = { sd: startDate, ed: endDate };
  const productivityEmailFilter =
    emails && emails.length > 0
      ? ` AND LOWER(p.EMAIL) IN (${emails.map((_, i) => `:pe${i}`).join(',')})`
      : '';
  if (emails && emails.length > 0) {
    emails.forEach((email, i) => {
      productivityParams[`pe${i}`] = email.toLowerCase();
    });
  }

  const [employees, mapRows, productivityRows, timeOffRows, latestSyncRow] = await Promise.all([
    getEmployees({ activeOnly: true, emails }),
    query<{
      EMAIL: string;
      TBS_EMPLOYEE_NO: number;
    }>(
      `SELECT LOWER(EMAIL) AS EMAIL, TBS_EMPLOYEE_NO
       FROM TL_TBS_EMPLOYEE_MAP
       WHERE 1=1${emails && emails.length > 0
         ? ` AND LOWER(EMAIL) IN (${emails.map((_, i) => `:em${i}`).join(',')})`
         : ''}`,
      emails && emails.length > 0
        ? Object.fromEntries(emails.map((email, i) => [`em${i}`, email.toLowerCase()]))
        : {},
    ),
    query<{
      RECORD_DATE: Date;
      EMAIL: string;
      PRODUCTIVE_TIME: number;
      UNPRODUCTIVE_TIME: number;
      NEUTRAL_TIME: number;
      TOTAL_TIME: number;
      PRODUCTIVITY_SCORE: number | null;
      ACTIVE_TIME: number;
      IDLE_TIME: number;
      FOCUS_TIME: number;
      COLLABORATION_TIME: number;
      PRODUCTIVE_ACTIVE_TIME: number;
      PRODUCTIVE_PASSIVE_TIME: number;
      UNPRODUCTIVE_ACTIVE_TIME: number;
      UNPRODUCTIVE_PASSIVE_TIME: number;
      UNDEFINED_ACTIVE_TIME: number;
      UNDEFINED_PASSIVE_TIME: number;
      UTILIZATION_LEVEL: string | null;
      LOCATION: string | null;
      TIME_OFF_TIME: number;
      TIME_OFF_TYPE: string | null;
      FIRST_ACTIVITY_AT: Date | null;
      LAST_ACTIVITY_AT: Date | null;
    }>(
      `SELECT
         p.RECORD_DATE,
         LOWER(p.EMAIL) AS EMAIL,
         p.PRODUCTIVE_TIME,
         p.UNPRODUCTIVE_TIME,
         p.NEUTRAL_TIME,
         p.TOTAL_TIME,
         p.PRODUCTIVITY_SCORE,
         p.ACTIVE_TIME,
         p.IDLE_TIME,
         p.FOCUS_TIME,
         p.COLLABORATION_TIME,
         p.PRODUCTIVE_ACTIVE_TIME,
         p.PRODUCTIVE_PASSIVE_TIME,
         p.UNPRODUCTIVE_ACTIVE_TIME,
         p.UNPRODUCTIVE_PASSIVE_TIME,
         p.UNDEFINED_ACTIVE_TIME,
         p.UNDEFINED_PASSIVE_TIME,
         p.UTILIZATION_LEVEL,
         p.LOCATION,
         p.TIME_OFF_TIME,
         p.TIME_OFF_TYPE,
         p.FIRST_ACTIVITY_AT,
         p.LAST_ACTIVITY_AT
       FROM TL_PRODUCTIVITY p
       WHERE p.RECORD_DATE BETWEEN :sd AND :ed${productivityEmailFilter}
      ORDER BY p.RECORD_DATE DESC, LOWER(p.EMAIL)`,
      productivityParams,
    ),
    query<{
      EMAIL: string;
      START_DATE: Date;
      END_DATE: Date;
      TYPE: string | null;
      STATUS: string | null;
      AMOUNT: number | null;
      UNIT: string | null;
    }>(
      `SELECT
         LOWER(t.EMAIL) AS EMAIL,
         t.START_DATE,
         t.END_DATE,
         t.TYPE,
         t.STATUS,
         t.AMOUNT,
         t.UNIT
       FROM TL_TIME_OFF t
       WHERE t.START_DATE <= :ed AND t.END_DATE >= :sd${emails && emails.length > 0
         ? ` AND LOWER(t.EMAIL) IN (${emails.map((_, i) => `:te${i}`).join(',')})`
         : ''}
       ORDER BY t.START_DATE, LOWER(t.EMAIL)`,
      {
        sd: startDate,
        ed: endDate,
        ...(emails && emails.length > 0
          ? Object.fromEntries(emails.map((email, i) => [`te${i}`, email.toLowerCase()]))
          : {}),
      },
    ),
    query<{ COMPLETED_AT: Date | null }>(
      `SELECT COMPLETED_AT
       FROM (
         SELECT COMPLETED_AT
         FROM TL_SYNC_LOG
         WHERE STATUS IN ('completed', 'completed_error')
           AND COMPLETED_AT IS NOT NULL
         ORDER BY COMPLETED_AT DESC
       )
       WHERE ROWNUM = 1`,
    ),
  ]);

  const employeeByEmail = new Map(
    employees
      .filter((employee) => employee.email)
      .map((employee) => [
        employee.email.toLowerCase(),
        employee,
      ]),
  );
  const tbsNoByEmail = new Map(mapRows.map((row) => [row.EMAIL.toLowerCase(), row.TBS_EMPLOYEE_NO]));
  const tbsToEmail = new Map(mapRows.map((row) => [row.TBS_EMPLOYEE_NO, row.EMAIL.toLowerCase()]));
  const groupSet = new Set<string>();
  const userSet = new Set<string>();
  const weekSet = new Set<string>();
  const employeeNoSet = new Set<number>();

  const weekEmployees = new Map<string, WorkingHoursEmployeeAccumulator>();

  const tbsNos = [...tbsToEmail.keys()];
  const tbsAbsenceCodes = new Set([
    'VACATION', 'ILLNESS', 'MISC. ABS./APPTS', 'ALTERNATE DAY',
    'SICK', 'PERSONAL', 'BEREAVEMENT', 'JURY DUTY',
  ]);

  const tbsEntries = tbsNos.length > 0
    ? await query<{
        EMPLOYEE_NO: number;
        ENTRY_DATE: Date;
        WORK_CODE: string;
        WORK_DESCRIPTION: string;
        TIME_HOURS: number;
        ENTRY_TYPE: string;
        REMARK: string | null;
        DEFECT_CASE: string | null;
      }>(
        `SELECT EMPLOYEE_NO, ENTRY_DATE, WORK_CODE, WORK_DESCRIPTION, TIME_HOURS, ENTRY_TYPE, REMARK, DEFECT_CASE
         FROM TBS_ALL_TIME_ENTRIES_V@TBS_LINK
         WHERE EMPLOYEE_NO IN (${tbsNos.map((_, i) => `:tn${i}`).join(',')})
           AND ENTRY_DATE BETWEEN :sd AND :ed
         ORDER BY EMPLOYEE_NO, ENTRY_DATE`,
        {
          sd: startDate,
          ed: endDate,
          ...Object.fromEntries(tbsNos.map((employeeNo, i) => [`tn${i}`, employeeNo])),
        },
      )
    : [];

  for (const entry of tbsEntries) {
    const email = tbsToEmail.get(entry.EMPLOYEE_NO);
    if (!email) continue;
    const dateStr = toDateStr(entry.ENTRY_DATE);
    const weekStart = toIsoWeekStart(entry.ENTRY_DATE);
    const employee = employeeByEmail.get(email);
    const name = employee?.displayName || `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim() || email;
    const group = employee?.department || 'Unknown';
    const employeeKey = `${weekStart}|${email}`;
    const dayKey = dateStr;
    const row = getOrCreateWorkingHoursEmployee(
      weekEmployees,
      employeeKey,
      {
        email,
        name,
        group,
        tbsEmployeeNo: entry.EMPLOYEE_NO,
        weekStart,
      },
    );

    groupSet.add(group);
    userSet.add(name);
    weekSet.add(weekStart);
    employeeNoSet.add(entry.EMPLOYEE_NO);

    const day = getOrCreateWorkingHoursDay(row.days, dayKey, dateStr);
    const hours = Math.max(0, entry.TIME_HOURS || 0) * 3600;
    const desc = (entry.WORK_DESCRIPTION || entry.WORK_CODE || '').toUpperCase().trim();
    const isAbsence = tbsAbsenceCodes.has(desc) || entry.ENTRY_TYPE === 'C';

    if (isAbsence) {
      row.tbsAbsenceSeconds += hours;
      day.tbsAbsenceHours = roundToTenth(day.tbsAbsenceHours + roundHours(hours));
    } else {
      row.tbsReportedSeconds += hours;
      day.tbsReportedHours = roundToTenth(day.tbsReportedHours + roundHours(hours));
    }

    day.tbsLineEntries.push({
      workCode: entry.WORK_CODE || null,
      workDescription: entry.WORK_DESCRIPTION || null,
      entryType: entry.ENTRY_TYPE || null,
      hours: Math.max(0, entry.TIME_HOURS || 0),
      isAbsence,
      remark: entry.REMARK || null,
      defectCase: entry.DEFECT_CASE || null,
    });
  }

  for (const record of productivityRows) {
    const email = record.EMAIL?.toLowerCase();
    if (!email) continue;
    const employee = employeeByEmail.get(email);
    const name = employee?.displayName || `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim() || email;
    const group = employee?.department || 'Unknown';
    const tbsEmployeeNo = tbsNoByEmail.get(email) ?? null;
    const weekStart = toIsoWeekStart(record.RECORD_DATE);
    const employeeKey = `${weekStart}|${email}`;
    const dateStr = toDateStr(record.RECORD_DATE);
    const row = getOrCreateWorkingHoursEmployee(
      weekEmployees,
      employeeKey,
      {
        email,
        name,
        group,
        tbsEmployeeNo,
        weekStart,
      },
    );
    const day = getOrCreateWorkingHoursDay(row.days, dateStr, dateStr);

    groupSet.add(group);
    userSet.add(name);
    weekSet.add(weekStart);
    if (tbsEmployeeNo !== null) employeeNoSet.add(tbsEmployeeNo);

    row.hasActivTrakData = true;
    row.activeSeconds += Math.max(0, record.TOTAL_TIME || 0);
    row.productiveActiveSeconds += Math.max(0, record.PRODUCTIVE_ACTIVE_TIME || 0);
    row.productivePassiveSeconds += Math.max(0, record.PRODUCTIVE_PASSIVE_TIME || 0);
    row.undefinedActiveSeconds += Math.max(0, record.UNDEFINED_ACTIVE_TIME || 0);
    row.undefinedPassiveSeconds += Math.max(0, record.UNDEFINED_PASSIVE_TIME || 0);
    row.unproductiveActiveSeconds += Math.max(0, record.UNPRODUCTIVE_ACTIVE_TIME || 0);

    day.hasActivTrakData = true;
    day.activeHours = roundHours(Math.max(0, record.TOTAL_TIME || 0));
    day.activeInputHours = roundHours(Math.max(0, record.ACTIVE_TIME || 0));
    day.productiveActiveHours = roundHours(Math.max(0, record.PRODUCTIVE_ACTIVE_TIME || 0));
    day.productivePassiveHours = roundHours(Math.max(0, record.PRODUCTIVE_PASSIVE_TIME || 0));
    day.undefinedActiveHours = roundHours(Math.max(0, record.UNDEFINED_ACTIVE_TIME || 0));
    day.undefinedPassiveHours = roundHours(Math.max(0, record.UNDEFINED_PASSIVE_TIME || 0));
    day.unproductiveActiveHours = roundHours(Math.max(0, record.UNPRODUCTIVE_ACTIVE_TIME || 0));
    day.focusHours = roundHours(Math.max(0, record.FOCUS_TIME || 0));
    day.collaborationHours = roundHours(Math.max(0, record.COLLABORATION_TIME || 0));
    day.breakHours = roundHours(Math.max(0, record.IDLE_TIME || 0));
    day.productivityScore = record.PRODUCTIVITY_SCORE ?? null;
    day.utilizationLevel = record.UTILIZATION_LEVEL ?? null;
    day.location = record.LOCATION ?? null;
    day.timeOffHours = roundHours(Math.max(0, record.TIME_OFF_TIME || 0));
    day.timeOffType = record.TIME_OFF_TYPE ?? null;
    day.firstActivityAt = formatOracleTimestamp(record.FIRST_ACTIVITY_AT);
    day.lastActivityAt = formatOracleTimestamp(record.LAST_ACTIVITY_AT);
  }

  for (const record of timeOffRows) {
    const email = record.EMAIL?.toLowerCase();
    if (!email) continue;

    const employee = employeeByEmail.get(email);
    const name = employee?.displayName || `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim() || email;
    const group = employee?.department || 'Unknown';
    const tbsEmployeeNo = tbsNoByEmail.get(email) ?? null;
    const rangeStart = clampDate(record.START_DATE, startDate, endDate);
    const rangeEnd = clampDate(record.END_DATE, startDate, endDate);

    for (const cursor = new Date(rangeStart); cursor <= rangeEnd; cursor.setDate(cursor.getDate() + 1)) {
      const dayOfWeek = cursor.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      const weekStart = toIsoWeekStart(cursor);
      const dateStr = toDateStr(cursor);
      const employeeKey = `${weekStart}|${email}`;
      const row = getOrCreateWorkingHoursEmployee(
        weekEmployees,
        employeeKey,
        {
          email,
          name,
          group,
          tbsEmployeeNo,
          weekStart,
        },
      );
      const day = getOrCreateWorkingHoursDay(row.days, dateStr, dateStr);
      const leaveRecord: WorkingHoursApprovedLeave = {
        type: record.TYPE ?? null,
        amount: record.AMOUNT || 0,
        unit: record.UNIT ?? null,
        status: record.STATUS ?? null,
      };

      if (!hasMatchingApprovedLeave(day.approvedLeave, leaveRecord)) {
        day.approvedLeave.push(leaveRecord);
      }

      groupSet.add(group);
      userSet.add(name);
      weekSet.add(weekStart);
      if (tbsEmployeeNo !== null) employeeNoSet.add(tbsEmployeeNo);
    }
  }

  const weeksByStart = new Map<string, WorkingHoursWeekAccumulator>();

  for (const employee of weekEmployees.values()) {
    const days = [...employee.days.values()]
      .map((day) => ({
        ...day,
        workedVsReportedPct: calculateWorkedVsReportedPct(day.activeHours, day.tbsReportedHours),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const employeeRow: WorkingHoursEmployeeWeekRow = {
      email: employee.email,
      name: employee.name,
      group: employee.group,
      tbsEmployeeNo: employee.tbsEmployeeNo,
      weekStart: employee.weekStart,
      hasActivTrakData: employee.hasActivTrakData,
      tbsReportedHours: roundHours(employee.tbsReportedSeconds),
      tbsAbsenceHours: roundHours(employee.tbsAbsenceSeconds),
      activeHours: roundHours(employee.activeSeconds),
      workedVsReportedPct: calculateWorkedVsReportedPct(
        roundHours(employee.activeSeconds),
        roundHours(employee.tbsReportedSeconds),
      ),
      productiveActiveHours: roundHours(employee.productiveActiveSeconds),
      productivePassiveHours: roundHours(employee.productivePassiveSeconds),
      undefinedActiveHours: roundHours(employee.undefinedActiveSeconds),
      undefinedPassiveHours: roundHours(employee.undefinedPassiveSeconds),
      unproductiveActiveHours: roundHours(employee.unproductiveActiveSeconds),
      days,
    };

    const week = weeksByStart.get(employee.weekStart) || {
      weekStart: employee.weekStart,
      tbsReportedSeconds: 0,
      tbsAbsenceSeconds: 0,
      activeSeconds: 0,
      productiveActiveSeconds: 0,
      productivePassiveSeconds: 0,
      undefinedActiveSeconds: 0,
      undefinedPassiveSeconds: 0,
      unproductiveActiveSeconds: 0,
      employees: [],
    };

    week.tbsReportedSeconds += employee.tbsReportedSeconds;
    week.tbsAbsenceSeconds += employee.tbsAbsenceSeconds;
    week.activeSeconds += employee.activeSeconds;
    week.productiveActiveSeconds += employee.productiveActiveSeconds;
    week.productivePassiveSeconds += employee.productivePassiveSeconds;
    week.undefinedActiveSeconds += employee.undefinedActiveSeconds;
    week.undefinedPassiveSeconds += employee.undefinedPassiveSeconds;
    week.unproductiveActiveSeconds += employee.unproductiveActiveSeconds;
    week.employees.push(employeeRow);
    weeksByStart.set(employee.weekStart, week);
  }

  const weeks = [...weeksByStart.values()]
    .map((week) => {
      const tbsReportedHours = roundHours(week.tbsReportedSeconds);
      const activeHours = roundHours(week.activeSeconds);
      return {
        weekStart: week.weekStart,
        tbsReportedHours,
        tbsAbsenceHours: roundHours(week.tbsAbsenceSeconds),
        activeHours,
        workedVsReportedPct: calculateWorkedVsReportedPct(activeHours, tbsReportedHours),
        productiveActiveHours: roundHours(week.productiveActiveSeconds),
        productivePassiveHours: roundHours(week.productivePassiveSeconds),
        undefinedActiveHours: roundHours(week.undefinedActiveSeconds),
        undefinedPassiveHours: roundHours(week.undefinedPassiveSeconds),
        unproductiveActiveHours: roundHours(week.unproductiveActiveSeconds),
        employees: week.employees.sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  return {
    weeks,
    groups: [...groupSet].sort(),
    employeeNumbers: [...employeeNoSet].sort((a, b) => a - b),
    users: [...userSet].sort(),
    weekOptions: [...weekSet].sort((a, b) => b.localeCompare(a)),
    lastSyncedAt: formatOracleTimestamp(latestSyncRow[0]?.COMPLETED_AT ?? null),
  };
}

function roundHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function calculateWorkedVsReportedPct(
  activeHours: number,
  tbsReportedHours: number,
): number | null {
  if (tbsReportedHours <= 0) return null;
  return Math.round((((activeHours - tbsReportedHours) / tbsReportedHours) * 100) * 100) / 100;
}

function toIsoWeekStart(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : new Date(date);
  const dayOfWeek = d.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setDate(d.getDate() + mondayOffset);
  d.setHours(0, 0, 0, 0);
  return toDateStr(d);
}

function getDayLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  });
}

function getOrCreateWorkingHoursEmployee(
  employees: Map<string, WorkingHoursEmployeeAccumulator>,
  key: string,
  seed: {
    email: string;
    name: string;
    group: string;
    tbsEmployeeNo: number | null;
    weekStart: string;
  },
): WorkingHoursEmployeeAccumulator {
  let row = employees.get(key);
  if (!row) {
    row = {
      email: seed.email,
      name: seed.name,
      group: seed.group,
      tbsEmployeeNo: seed.tbsEmployeeNo,
      weekStart: seed.weekStart,
      hasActivTrakData: false,
      tbsReportedSeconds: 0,
      tbsAbsenceSeconds: 0,
      activeSeconds: 0,
      productiveActiveSeconds: 0,
      productivePassiveSeconds: 0,
      undefinedActiveSeconds: 0,
      undefinedPassiveSeconds: 0,
      unproductiveActiveSeconds: 0,
      days: new Map(),
    };
    employees.set(key, row);
  }
  return row;
}

function getOrCreateWorkingHoursDay(
  days: Map<string, WorkingHoursDayRow>,
  key: string,
  dateStr: string,
): WorkingHoursDayRow {
  let day = days.get(key);
  if (!day) {
    day = {
      date: dateStr,
      dayLabel: getDayLabel(dateStr),
      hasActivTrakData: false,
      tbsReportedHours: 0,
      tbsAbsenceHours: 0,
      activeHours: 0,
      activeInputHours: 0,
      workedVsReportedPct: null,
      productiveActiveHours: 0,
      productivePassiveHours: 0,
      undefinedActiveHours: 0,
      undefinedPassiveHours: 0,
      unproductiveActiveHours: 0,
      focusHours: 0,
      collaborationHours: 0,
      breakHours: 0,
      productivityScore: null,
      utilizationLevel: null,
      location: null,
      timeOffHours: 0,
      timeOffType: null,
      firstActivityAt: null,
      lastActivityAt: null,
      approvedLeave: [],
      tbsLineEntries: [],
    };
    days.set(key, day);
  }
  return day;
}

function clampDate(value: Date, min: Date, max: Date): Date {
  const clamped = new Date(value);
  if (clamped < min) return new Date(min);
  if (clamped > max) return new Date(max);
  return clamped;
}

function hasMatchingApprovedLeave(
  leaves: WorkingHoursApprovedLeave[],
  candidate: WorkingHoursApprovedLeave,
): boolean {
  return leaves.some((leave) =>
    leave.type === candidate.type &&
    leave.amount === candidate.amount &&
    leave.unit === candidate.unit &&
    leave.status === candidate.status,
  );
}

function toDateStr(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function formatOracleTimestamp(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;

  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  const hh = String(value.getHours()).padStart(2, '0');
  const mm = String(value.getMinutes()).padStart(2, '0');
  const ss = String(value.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

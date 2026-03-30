import { fetchEmployeeDirectory, fetchRemoteWorkRequests, fetchTimeOffRequests, fetchWorkAbroadRequests } from './bamboohr';
import { fetchActivTrakIdentifiers, fetchActivTrakUserStats, fetchOfficeAttendanceData, fetchOfficeIpActivity, fetchProductivityData } from './bigquery';
import { execute, executeMany, initializeSchema, query } from './oracle';
import { normalizeEmailNullable } from './email';

export interface SyncSummary {
  startedAt: string;
  completedAt: string;
  daysBack: number;
  employeesSynced: number;
  attendanceSynced: number;
  productivitySynced: number;
  timeOffSynced: number;
  remoteWorkRequestsSynced: number;
  workAbroadRequestsSynced: number;
  tbsMapped: number;
  errors: string[];
}

function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map((part) => Number(part));
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeOracleText(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .trim() || null;
}

/**
 * Auto-maps unmapped BambooHR employees to TBS employee numbers.
 * Priority:
 * 1. BambooHR Employee #, but only when it exists in TBS_EMPLOYEES
 * 2. First+last name match, preferring the employee with the most recent TBS entry
 */
export async function syncTbsEmployeeMap(): Promise<number> {
  const result = await execute(`
    MERGE INTO TL_TBS_EMPLOYEE_MAP m
    USING (
      WITH name_candidates AS (
        SELECT EMPLOYEE_NO, EMPLOYEE_FIRST_NAME, EMPLOYEE_LAST_NAME,
               ROW_NUMBER() OVER (
                 PARTITION BY UPPER(TRIM(EMPLOYEE_FIRST_NAME)), UPPER(TRIM(EMPLOYEE_LAST_NAME))
                 ORDER BY NVL(LAST_ENTRY, DATE '1900-01-01') DESC
               ) AS RN
        FROM (
          SELECT e.EMPLOYEE_NO, e.EMPLOYEE_FIRST_NAME, e.EMPLOYEE_LAST_NAME,
                 (SELECT MAX(v.ENTRY_DATE) FROM TBS_ALL_TIME_ENTRIES_V@TBS_LINK v
                  WHERE v.EMPLOYEE_NO = e.EMPLOYEE_NO) AS LAST_ENTRY
          FROM TBS_EMPLOYEES@TBS_LINK e
        )
      ),
      source_rows AS (
        SELECT
          LOWER(b.EMAIL) AS email,
          t.EMPLOYEE_NO AS employee_no,
          'auto-bamboo' AS match_method,
          1 AS priority
        FROM TL_EMPLOYEES b
        JOIN TBS_EMPLOYEES@TBS_LINK t
          ON t.EMPLOYEE_NO = b.EMPLOYEE_NUMBER
        WHERE b.EMAIL IS NOT NULL
          AND b.EMPLOYEE_NUMBER IS NOT NULL
          AND (b.STATUS IS NULL OR UPPER(b.STATUS) != 'INACTIVE')
          AND LOWER(b.EMAIL) NOT IN (SELECT LOWER(EMAIL) FROM TL_TBS_EMPLOYEE_MAP)

        UNION ALL

        SELECT
          LOWER(b.EMAIL) AS email,
          t.EMPLOYEE_NO AS employee_no,
          'auto-name' AS match_method,
          2 AS priority
        FROM TL_EMPLOYEES b
        JOIN name_candidates t
          ON UPPER(b.FIRST_NAME) = UPPER(TRIM(t.EMPLOYEE_FIRST_NAME))
         AND UPPER(b.LAST_NAME) = UPPER(TRIM(t.EMPLOYEE_LAST_NAME))
         AND t.RN = 1
        WHERE b.EMAIL IS NOT NULL
          AND (b.STATUS IS NULL OR UPPER(b.STATUS) != 'INACTIVE')
          AND LOWER(b.EMAIL) NOT IN (SELECT LOWER(EMAIL) FROM TL_TBS_EMPLOYEE_MAP)
      ),
      ranked_rows AS (
        SELECT email, employee_no, match_method,
               ROW_NUMBER() OVER (PARTITION BY email ORDER BY priority, employee_no) AS selection_rank
        FROM source_rows
      )
      SELECT email, employee_no, match_method
      FROM ranked_rows
      WHERE selection_rank = 1
    ) src
    ON (LOWER(m.EMAIL) = LOWER(src.EMAIL))
    WHEN NOT MATCHED THEN INSERT (EMAIL, TBS_EMPLOYEE_NO, MATCH_METHOD, CREATED_AT)
    VALUES (LOWER(src.email), src.employee_no, src.match_method, CURRENT_TIMESTAMP)
  `);

  const mapped = result.rowsAffected || 0;
  console.log(`[Sync] TBS mapping: ${mapped} new employee(s) mapped`);
  return mapped;
}

export async function runFullSync(daysBack: number = 7): Promise<SyncSummary> {
  const now = new Date();
  const syncType = 'full';
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - Math.max(1, daysBack));

  await initializeSchema();

  try {
    await execute(
      `INSERT INTO TL_SYNC_LOG (
         SYNC_TYPE, STARTED_AT, STATUS, DATE_RANGE_START, DATE_RANGE_END
       ) VALUES (
         :syncType, :startedAt, 'running', :rangeStart, :rangeEnd
       )`,
      {
        syncType,
        startedAt: now,
        rangeStart: startDate,
        rangeEnd: now,
      },
    );
  } catch (error) {
    console.error('[Sync] Failed to write sync start log:', error);
  }

  const errors: string[] = [];
  let employeesSynced = 0;
  let attendanceSynced = 0;
  let productivitySynced = 0;
  let timeOffSynced = 0;
  let remoteWorkRequestsSynced = 0;
  let workAbroadRequestsSynced = 0;
  let tbsMapped = 0;

  try {
    const employees = await fetchEmployeeDirectory();
    const employeeBinds = employees
      .map((emp) => ({
        ID: emp.id,
        EMPLOYEE_NUMBER:
          emp.employeeNumber && !Number.isNaN(Number(emp.employeeNumber))
            ? Number(emp.employeeNumber)
            : null,
        EMAIL: normalizeEmailNullable(emp.workEmail),
        DISPLAY_NAME: emp.displayName || null,
        FIRST_NAME: emp.firstName || null,
        LAST_NAME: emp.lastName || null,
        JOB_TITLE: emp.jobTitle || null,
        DEPARTMENT: emp.department || null,
        DIVISION: emp.division || null,
        LOCATION: emp.location || null,
        SUPERVISOR_ID: emp.supervisorId || emp.supervisorEId || null,
        SUPERVISOR_NAME: emp.supervisor || null,
        SUPERVISOR_EMAIL: normalizeEmailNullable(emp.supervisorEmail),
        HIRE_DATE: emp.hireDate ? parseDateOnly(emp.hireDate) : null,
        STATUS: emp.status || emp.employmentStatus || null,
        PHOTO_URL: emp.photoUrl || null,
        REMOTE_WORKDAY_POLICY_ASSIGNED: emp['4631.0'] === 'Yes' ? 1 : 0,
      }));

    if (employeeBinds.length > 0) {
      await executeMany(
        `MERGE INTO TL_EMPLOYEES t
         USING (SELECT
           :ID AS ID,
           :EMPLOYEE_NUMBER AS EMPLOYEE_NUMBER,
           :EMAIL AS EMAIL,
           :DISPLAY_NAME AS DISPLAY_NAME,
           :FIRST_NAME AS FIRST_NAME,
           :LAST_NAME AS LAST_NAME,
           :JOB_TITLE AS JOB_TITLE,
           :DEPARTMENT AS DEPARTMENT,
           :DIVISION AS DIVISION,
           :LOCATION AS LOCATION,
           :SUPERVISOR_ID AS SUPERVISOR_ID,
           :SUPERVISOR_NAME AS SUPERVISOR_NAME,
           :SUPERVISOR_EMAIL AS SUPERVISOR_EMAIL,
           :HIRE_DATE AS HIRE_DATE,
           :STATUS AS STATUS,
           :PHOTO_URL AS PHOTO_URL,
           :REMOTE_WORKDAY_POLICY_ASSIGNED AS REMOTE_WORKDAY_POLICY_ASSIGNED
         FROM DUAL) s
         ON (t.ID = s.ID)
         WHEN MATCHED THEN UPDATE SET
           t.EMPLOYEE_NUMBER = s.EMPLOYEE_NUMBER,
           t.EMAIL = s.EMAIL,
           t.DISPLAY_NAME = s.DISPLAY_NAME,
           t.FIRST_NAME = s.FIRST_NAME,
           t.LAST_NAME = s.LAST_NAME,
           t.JOB_TITLE = s.JOB_TITLE,
           t.DEPARTMENT = s.DEPARTMENT,
           t.DIVISION = s.DIVISION,
           t.LOCATION = s.LOCATION,
           t.SUPERVISOR_ID = s.SUPERVISOR_ID,
           t.SUPERVISOR_NAME = s.SUPERVISOR_NAME,
           t.SUPERVISOR_EMAIL = s.SUPERVISOR_EMAIL,
           t.HIRE_DATE = s.HIRE_DATE,
           t.STATUS = s.STATUS,
           t.PHOTO_URL = s.PHOTO_URL,
           t.REMOTE_WORKDAY_POLICY_ASSIGNED = s.REMOTE_WORKDAY_POLICY_ASSIGNED,
           t.UPDATED_AT = CURRENT_TIMESTAMP
         WHEN NOT MATCHED THEN INSERT (
           ID, EMPLOYEE_NUMBER, EMAIL, DISPLAY_NAME, FIRST_NAME, LAST_NAME, JOB_TITLE,
           DEPARTMENT, DIVISION, LOCATION, SUPERVISOR_ID, SUPERVISOR_NAME, SUPERVISOR_EMAIL,
           HIRE_DATE, STATUS, PHOTO_URL, REMOTE_WORKDAY_POLICY_ASSIGNED
         ) VALUES (
           s.ID, s.EMPLOYEE_NUMBER, s.EMAIL, s.DISPLAY_NAME, s.FIRST_NAME, s.LAST_NAME, s.JOB_TITLE,
           s.DEPARTMENT, s.DIVISION, s.LOCATION, s.SUPERVISOR_ID, s.SUPERVISOR_NAME, s.SUPERVISOR_EMAIL,
           s.HIRE_DATE, s.STATUS, s.PHOTO_URL, s.REMOTE_WORKDAY_POLICY_ASSIGNED
         )`,
        employeeBinds,
      );
    }

    employeesSynced = employeeBinds.length;
  } catch (error) {
    errors.push(`Employee sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const officeIpRows = await query<{ PUBLIC_IP: string }>(
      `SELECT PUBLIC_IP FROM TL_OFFICE_IPS WHERE IS_ACTIVE = 1 ORDER BY PUBLIC_IP`,
    );
    const officeIps = officeIpRows
      .map((row) => row.PUBLIC_IP?.trim())
      .filter((ip): ip is string => Boolean(ip));

    const [attendance, officeIpActivity] = await Promise.all([
      fetchOfficeAttendanceData(startDate, now),
      officeIps.length > 0
        ? fetchOfficeIpActivity(startDate, now, officeIps)
        : Promise.resolve([]),
    ]);

    await execute(
      `DELETE FROM TL_OFFICE_IP_ACTIVITY
       WHERE RECORD_DATE BETWEEN :sd AND :ed`,
      { sd: startDate, ed: now },
    );

    const officeIpActivityByKey = new Map<string, {
      RECORD_DATE: Date;
      EMAIL: string | null;
      DISPLAY_NAME: string | null;
      PUBLIC_IP: string;
      DURATION_SECONDS: number;
      EVENT_COUNT: number;
    }>();
    for (const row of officeIpActivity) {
      const email = normalizeEmailNullable(row.email);
      const publicIp = row.publicIp?.trim();
      if (!email || !publicIp) continue;
      const key = `${toDateKey(row.date)}|${email}|${publicIp}`;
      const existing = officeIpActivityByKey.get(key);
      if (existing) {
        existing.DURATION_SECONDS += row.durationSeconds || 0;
        existing.EVENT_COUNT += row.eventCount || 0;
        if (!existing.DISPLAY_NAME && row.displayName) {
          existing.DISPLAY_NAME = row.displayName;
        }
        continue;
      }
      officeIpActivityByKey.set(key, {
        RECORD_DATE: row.date,
        EMAIL: email,
        DISPLAY_NAME: row.displayName || null,
        PUBLIC_IP: publicIp,
        DURATION_SECONDS: row.durationSeconds || 0,
        EVENT_COUNT: row.eventCount || 0,
      });
    }
    const officeIpActivityBinds = [...officeIpActivityByKey.values()];

    if (officeIpActivityBinds.length > 0) {
      await executeMany(
        `INSERT INTO TL_OFFICE_IP_ACTIVITY (
           RECORD_DATE, EMAIL, DISPLAY_NAME, PUBLIC_IP, DURATION_SECONDS, EVENT_COUNT
         ) VALUES (
           :RECORD_DATE, :EMAIL, :DISPLAY_NAME, :PUBLIC_IP, :DURATION_SECONDS, :EVENT_COUNT
         )`,
        officeIpActivityBinds,
      );
    }

    const officeIpMatchesByDay = new Map<string, Set<string>>();
    const syntheticOfficeRows = new Map<string, {
      date: Date;
      email: string;
      displayName: string | null;
      totalHours: number;
    }>();

    for (const row of officeIpActivity) {
      const key = `${row.email.toLowerCase()}|${toDateKey(row.date)}`;
      if (!officeIpMatchesByDay.has(key)) {
        officeIpMatchesByDay.set(key, new Set());
      }
      officeIpMatchesByDay.get(key)!.add(row.publicIp);

      if (!syntheticOfficeRows.has(key)) {
        syntheticOfficeRows.set(key, {
          date: row.date,
          email: row.email.toLowerCase(),
          displayName: row.displayName || row.email.toLowerCase(),
          totalHours: 0,
        });
      }
      syntheticOfficeRows.get(key)!.totalHours += row.durationSeconds / 3600;
    }

    const attendanceByKey = new Map<string, (typeof attendance)[number]>(
      attendance
        .filter((row) => row.email)
        .map((row) => [`${row.email.toLowerCase()}|${toDateKey(row.date)}`, row]),
    );

    type AttendanceSyncRecord = {
      date: Date;
      email: string;
      displayName: string | null;
      rawLocation: 'Office' | 'Remote' | 'Unknown';
      totalHours: number;
      isPTO: boolean;
      ptoType: string | null;
      ptoHours: number;
    };

    const syncRows: AttendanceSyncRecord[] = attendance
      .filter((row) => row.email)
      .map((row) => ({
        date: row.date,
        email: row.email.toLowerCase(),
        displayName: row.displayName || null,
        rawLocation: row.location || 'Unknown',
        totalHours: row.totalHours || 0,
        isPTO: row.isPTO,
        ptoType: row.ptoType || null,
        ptoHours: row.ptoHours || 0,
      }));

    for (const [key, row] of syntheticOfficeRows) {
      if (attendanceByKey.has(key)) continue;
      syncRows.push({
        date: row.date,
        email: row.email,
        displayName: row.displayName,
        rawLocation: 'Unknown',
        totalHours: Math.round(row.totalHours * 100) / 100,
        isPTO: false,
        ptoType: null,
        ptoHours: 0,
      });
    }

    const attendanceBinds = syncRows.map((row) => {
      const key = `${row.email}|${toDateKey(row.date)}`;
      const officeIpMatches = [...(officeIpMatchesByDay.get(key) || new Set())].sort();
      const rawLocation = row.rawLocation || 'Unknown';
      const effectiveLocation = officeIpMatches.length > 0 ? 'Office' : rawLocation;
      const officeIpOverride = officeIpMatches.length > 0 && rawLocation !== 'Office' ? 1 : 0;

      return {
        RECORD_DATE: row.date,
        EMAIL: normalizeEmailNullable(row.email),
        DISPLAY_NAME: row.displayName || null,
        LOCATION: effectiveLocation,
        RAW_LOCATION: rawLocation,
        OFFICE_IP_OVERRIDE: officeIpOverride,
        OFFICE_IP_MATCHES: officeIpMatches.length > 0 ? officeIpMatches.join(', ') : null,
        TOTAL_HOURS: row.totalHours || 0,
        IS_PTO: row.isPTO ? 1 : 0,
        PTO_TYPE: row.ptoType || null,
        PTO_HOURS: row.ptoHours || 0,
      };
    });

    if (attendanceBinds.length > 0) {
      await executeMany(
        `MERGE INTO TL_ATTENDANCE t
         USING (SELECT
           :RECORD_DATE AS RECORD_DATE,
           :EMAIL AS EMAIL,
           :DISPLAY_NAME AS DISPLAY_NAME,
           :LOCATION AS LOCATION,
           :RAW_LOCATION AS RAW_LOCATION,
           :OFFICE_IP_OVERRIDE AS OFFICE_IP_OVERRIDE,
           :OFFICE_IP_MATCHES AS OFFICE_IP_MATCHES,
           :TOTAL_HOURS AS TOTAL_HOURS,
           :IS_PTO AS IS_PTO,
           :PTO_TYPE AS PTO_TYPE,
           :PTO_HOURS AS PTO_HOURS
         FROM DUAL) s
         ON (t.RECORD_DATE = s.RECORD_DATE AND LOWER(t.EMAIL) = LOWER(s.EMAIL))
         WHEN MATCHED THEN UPDATE SET
           t.DISPLAY_NAME = s.DISPLAY_NAME,
           t.LOCATION = s.LOCATION,
           t.RAW_LOCATION = s.RAW_LOCATION,
           t.OFFICE_IP_OVERRIDE = s.OFFICE_IP_OVERRIDE,
           t.OFFICE_IP_MATCHES = s.OFFICE_IP_MATCHES,
           t.TOTAL_HOURS = s.TOTAL_HOURS,
           t.IS_PTO = s.IS_PTO,
           t.PTO_TYPE = s.PTO_TYPE,
           t.PTO_HOURS = s.PTO_HOURS
         WHEN NOT MATCHED THEN INSERT (
           RECORD_DATE, EMAIL, DISPLAY_NAME, LOCATION, RAW_LOCATION, OFFICE_IP_OVERRIDE, OFFICE_IP_MATCHES,
           TOTAL_HOURS, IS_PTO, PTO_TYPE, PTO_HOURS
         ) VALUES (
           s.RECORD_DATE, s.EMAIL, s.DISPLAY_NAME, s.LOCATION, s.RAW_LOCATION, s.OFFICE_IP_OVERRIDE, s.OFFICE_IP_MATCHES,
           s.TOTAL_HOURS, s.IS_PTO, s.PTO_TYPE, s.PTO_HOURS
         )`,
        attendanceBinds,
      );
    }

    attendanceSynced = attendanceBinds.length;
  } catch (error) {
    errors.push(`Attendance sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const productivity = await fetchProductivityData(startDate, now);
    const productivityBinds = productivity
      .filter((row) => row.email)
      .map((row) => ({
        RECORD_DATE: row.date,
        EMAIL: normalizeEmailNullable(row.email),
        PRODUCTIVE_TIME: row.productive_time || 0,
        UNPRODUCTIVE_TIME: row.unproductive_time || 0,
        NEUTRAL_TIME: row.neutral_time || 0,
        TOTAL_TIME: row.total_time || 0,
        PRODUCTIVITY_SCORE: row.productivity_score,
        ACTIVE_TIME: row.active_time || 0,
        IDLE_TIME: row.idle_time || 0,
        FOCUS_TIME: row.focus_time || 0,
        COLLABORATION_TIME: row.collaboration_time || 0,
        PRODUCTIVE_ACTIVE_TIME: row.productive_active_time || 0,
        PRODUCTIVE_PASSIVE_TIME: row.productive_passive_time || 0,
        UNPRODUCTIVE_ACTIVE_TIME: row.unproductive_active_time || 0,
        UNPRODUCTIVE_PASSIVE_TIME: row.unproductive_passive_time || 0,
        UNDEFINED_ACTIVE_TIME: row.undefined_active_time || 0,
        UNDEFINED_PASSIVE_TIME: row.undefined_passive_time || 0,
        UTILIZATION_LEVEL: row.utilization_level || null,
        LOCATION: row.location || null,
        TIME_OFF_TIME: row.time_off_time || 0,
        TIME_OFF_TYPE: row.time_off_type || null,
        FIRST_ACTIVITY_AT: row.first_activity_datetime ? new Date(row.first_activity_datetime.replace(' ', 'T')) : null,
        LAST_ACTIVITY_AT: row.last_activity_datetime ? new Date(row.last_activity_datetime.replace(' ', 'T')) : null,
      }));

    if (productivityBinds.length > 0) {
      await executeMany(
        `MERGE INTO TL_PRODUCTIVITY t
         USING (SELECT
           :RECORD_DATE AS RECORD_DATE,
           :EMAIL AS EMAIL,
           :PRODUCTIVE_TIME AS PRODUCTIVE_TIME,
           :UNPRODUCTIVE_TIME AS UNPRODUCTIVE_TIME,
           :NEUTRAL_TIME AS NEUTRAL_TIME,
           :TOTAL_TIME AS TOTAL_TIME,
           :PRODUCTIVITY_SCORE AS PRODUCTIVITY_SCORE,
           :ACTIVE_TIME AS ACTIVE_TIME,
           :IDLE_TIME AS IDLE_TIME,
           :FOCUS_TIME AS FOCUS_TIME,
           :COLLABORATION_TIME AS COLLABORATION_TIME,
           :PRODUCTIVE_ACTIVE_TIME AS PRODUCTIVE_ACTIVE_TIME,
           :PRODUCTIVE_PASSIVE_TIME AS PRODUCTIVE_PASSIVE_TIME,
           :UNPRODUCTIVE_ACTIVE_TIME AS UNPRODUCTIVE_ACTIVE_TIME,
           :UNPRODUCTIVE_PASSIVE_TIME AS UNPRODUCTIVE_PASSIVE_TIME,
           :UNDEFINED_ACTIVE_TIME AS UNDEFINED_ACTIVE_TIME,
           :UNDEFINED_PASSIVE_TIME AS UNDEFINED_PASSIVE_TIME,
           :UTILIZATION_LEVEL AS UTILIZATION_LEVEL,
           :LOCATION AS LOCATION,
           :TIME_OFF_TIME AS TIME_OFF_TIME,
           :TIME_OFF_TYPE AS TIME_OFF_TYPE,
           :FIRST_ACTIVITY_AT AS FIRST_ACTIVITY_AT,
           :LAST_ACTIVITY_AT AS LAST_ACTIVITY_AT
         FROM DUAL) s
         ON (t.RECORD_DATE = s.RECORD_DATE AND LOWER(t.EMAIL) = LOWER(s.EMAIL))
         WHEN MATCHED THEN UPDATE SET
           t.PRODUCTIVE_TIME = s.PRODUCTIVE_TIME,
           t.UNPRODUCTIVE_TIME = s.UNPRODUCTIVE_TIME,
           t.NEUTRAL_TIME = s.NEUTRAL_TIME,
           t.TOTAL_TIME = s.TOTAL_TIME,
           t.PRODUCTIVITY_SCORE = s.PRODUCTIVITY_SCORE,
           t.ACTIVE_TIME = s.ACTIVE_TIME,
           t.IDLE_TIME = s.IDLE_TIME,
           t.FOCUS_TIME = s.FOCUS_TIME,
           t.COLLABORATION_TIME = s.COLLABORATION_TIME,
           t.PRODUCTIVE_ACTIVE_TIME = s.PRODUCTIVE_ACTIVE_TIME,
           t.PRODUCTIVE_PASSIVE_TIME = s.PRODUCTIVE_PASSIVE_TIME,
           t.UNPRODUCTIVE_ACTIVE_TIME = s.UNPRODUCTIVE_ACTIVE_TIME,
           t.UNPRODUCTIVE_PASSIVE_TIME = s.UNPRODUCTIVE_PASSIVE_TIME,
           t.UNDEFINED_ACTIVE_TIME = s.UNDEFINED_ACTIVE_TIME,
           t.UNDEFINED_PASSIVE_TIME = s.UNDEFINED_PASSIVE_TIME,
           t.UTILIZATION_LEVEL = s.UTILIZATION_LEVEL,
           t.LOCATION = s.LOCATION,
           t.TIME_OFF_TIME = s.TIME_OFF_TIME,
           t.TIME_OFF_TYPE = s.TIME_OFF_TYPE,
           t.FIRST_ACTIVITY_AT = s.FIRST_ACTIVITY_AT,
           t.LAST_ACTIVITY_AT = s.LAST_ACTIVITY_AT
         WHEN NOT MATCHED THEN INSERT (
           RECORD_DATE, EMAIL, PRODUCTIVE_TIME, UNPRODUCTIVE_TIME, NEUTRAL_TIME, TOTAL_TIME,
           PRODUCTIVITY_SCORE, ACTIVE_TIME, IDLE_TIME, FOCUS_TIME, COLLABORATION_TIME,
           PRODUCTIVE_ACTIVE_TIME, PRODUCTIVE_PASSIVE_TIME, UNPRODUCTIVE_ACTIVE_TIME, UNPRODUCTIVE_PASSIVE_TIME,
           UNDEFINED_ACTIVE_TIME, UNDEFINED_PASSIVE_TIME, UTILIZATION_LEVEL, LOCATION,
           TIME_OFF_TIME, TIME_OFF_TYPE, FIRST_ACTIVITY_AT, LAST_ACTIVITY_AT
         ) VALUES (
           s.RECORD_DATE, s.EMAIL, s.PRODUCTIVE_TIME, s.UNPRODUCTIVE_TIME, s.NEUTRAL_TIME, s.TOTAL_TIME,
           s.PRODUCTIVITY_SCORE, s.ACTIVE_TIME, s.IDLE_TIME, s.FOCUS_TIME, s.COLLABORATION_TIME,
           s.PRODUCTIVE_ACTIVE_TIME, s.PRODUCTIVE_PASSIVE_TIME, s.UNPRODUCTIVE_ACTIVE_TIME, s.UNPRODUCTIVE_PASSIVE_TIME,
           s.UNDEFINED_ACTIVE_TIME, s.UNDEFINED_PASSIVE_TIME, s.UTILIZATION_LEVEL, s.LOCATION,
           s.TIME_OFF_TIME, s.TIME_OFF_TYPE, s.FIRST_ACTIVITY_AT, s.LAST_ACTIVITY_AT
         )`,
        productivityBinds,
      );
    }

    productivitySynced = productivityBinds.length;
  } catch (error) {
    errors.push(`Productivity sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const identifiers = await fetchActivTrakIdentifiers();
    await execute(`DELETE FROM TL_ACTIVTRAK_IDENTIFIERS`);
    if (identifiers.length > 0) {
      await executeMany(
        `INSERT INTO TL_ACTIVTRAK_IDENTIFIERS (USER_ID, IDENTIFIER_EMAIL)
         VALUES (:USER_ID, :IDENTIFIER_EMAIL)`,
        identifiers.map((row) => ({
          USER_ID: row.userId,
          IDENTIFIER_EMAIL: row.identifierEmail,
        })),
      );
    }

    const userStats = await fetchActivTrakUserStats();
    await execute(`DELETE FROM TL_ACTIVTRAK_USER_STATS`);
    if (userStats.length > 0) {
      await executeMany(
        `INSERT INTO TL_ACTIVTRAK_USER_STATS (
           USER_ID, USER_NAME, FIRST_SEEN, LAST_SEEN, ACTIVITY_ROW_COUNT
         ) VALUES (
           :USER_ID, :USER_NAME, :FIRST_SEEN, :LAST_SEEN, :ACTIVITY_ROW_COUNT
         )`,
        userStats.map((row) => ({
          USER_ID: row.userId,
          USER_NAME: row.userName,
          FIRST_SEEN: row.firstSeen,
          LAST_SEEN: row.lastSeen,
          ACTIVITY_ROW_COUNT: row.activityRowCount,
        })),
      );
    }
  } catch (error) {
    errors.push(`ActivTrak identity sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const timeOff = await fetchTimeOffRequests(startDate, now);
    const ptoBinds = timeOff
      .filter((row) => row.employeeId)
      .map((row) => ({
        EMPLOYEE_ID: row.employeeId,
        EMAIL: normalizeEmailNullable(row.employeeEmail),
        EMPLOYEE_NAME: row.employeeName || null,
        DEPARTMENT: row.department || null,
        START_DATE: parseDateOnly(row.startDate),
        END_DATE: parseDateOnly(row.endDate),
        TYPE: row.type || null,
        STATUS: row.status || null,
        AMOUNT: row.amount || 0,
        UNIT: row.unit || null,
      }));

    if (ptoBinds.length > 0) {
      await executeMany(
        `MERGE INTO TL_TIME_OFF t
         USING (SELECT
           :EMPLOYEE_ID AS EMPLOYEE_ID,
           :START_DATE AS START_DATE,
           :END_DATE AS END_DATE,
           :TYPE AS TYPE,
           :EMAIL AS EMAIL,
           :EMPLOYEE_NAME AS EMPLOYEE_NAME,
           :DEPARTMENT AS DEPARTMENT,
           :STATUS AS STATUS,
           :AMOUNT AS AMOUNT,
           :UNIT AS UNIT
         FROM DUAL) s
         ON (
           t.EMPLOYEE_ID = s.EMPLOYEE_ID
           AND t.START_DATE = s.START_DATE
           AND t.END_DATE = s.END_DATE
           AND NVL(t.TYPE, 'N/A') = NVL(s.TYPE, 'N/A')
         )
         WHEN MATCHED THEN UPDATE SET
           t.EMAIL = s.EMAIL,
           t.EMPLOYEE_NAME = s.EMPLOYEE_NAME,
           t.DEPARTMENT = s.DEPARTMENT,
           t.STATUS = s.STATUS,
           t.AMOUNT = s.AMOUNT,
           t.UNIT = s.UNIT
         WHEN NOT MATCHED THEN INSERT (
           EMPLOYEE_ID, EMAIL, EMPLOYEE_NAME, DEPARTMENT,
           START_DATE, END_DATE, TYPE, STATUS, AMOUNT, UNIT
         ) VALUES (
           s.EMPLOYEE_ID, s.EMAIL, s.EMPLOYEE_NAME, s.DEPARTMENT,
           s.START_DATE, s.END_DATE, s.TYPE, s.STATUS, s.AMOUNT, s.UNIT
         )`,
        ptoBinds,
      );
    }

    timeOffSynced = ptoBinds.length;
  } catch (error) {
    errors.push(`Time-off sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const remoteWorkRequests = await fetchRemoteWorkRequests();
    const remoteWorkBinds = remoteWorkRequests
      .filter((row) => row.rowId && row.employeeId && row.remoteWorkStartDate)
      .map((row) => ({
        BAMBOO_ROW_ID: Number(row.rowId),
        EMPLOYEE_ID: row.employeeId,
        EMAIL: normalizeEmailNullable(row.employeeEmail),
        EMPLOYEE_NAME: normalizeOracleText(row.employeeName),
        DEPARTMENT: normalizeOracleText(row.department),
        REQUEST_DATE: row.requestDate ? parseDateOnly(row.requestDate) : null,
        REMOTE_WORK_START_DATE: parseDateOnly(row.remoteWorkStartDate),
        REMOTE_WORK_END_DATE: row.remoteWorkEndDate ? parseDateOnly(row.remoteWorkEndDate) : null,
        REMOTE_WORK_TYPE: normalizeOracleText(row.remoteWorkType),
        REASON: normalizeOracleText(row.reason),
        SUPPORTING_DOCUMENTATION_SUBMITTED: normalizeOracleText(row.supportingDocumentationSubmitted),
        ALTERNATE_IN_OFFICE_WORK_DATE: normalizeOracleText(row.alternateInOfficeWorkDate),
        MANAGER_APPROVAL_RECEIVED: normalizeOracleText(row.managerApprovalReceived),
        MANAGER_NAME: normalizeOracleText(row.managerName),
      }));

    if (remoteWorkBinds.length > 0) {
      await executeMany(
        `MERGE INTO TL_REMOTE_WORK_REQUESTS t
         USING (SELECT
           :BAMBOO_ROW_ID AS BAMBOO_ROW_ID,
           :EMPLOYEE_ID AS EMPLOYEE_ID,
           :EMAIL AS EMAIL,
           :EMPLOYEE_NAME AS EMPLOYEE_NAME,
           :DEPARTMENT AS DEPARTMENT,
           :REQUEST_DATE AS REQUEST_DATE,
           :REMOTE_WORK_START_DATE AS REMOTE_WORK_START_DATE,
           :REMOTE_WORK_END_DATE AS REMOTE_WORK_END_DATE,
           :REMOTE_WORK_TYPE AS REMOTE_WORK_TYPE,
           :REASON AS REASON,
           :SUPPORTING_DOCUMENTATION_SUBMITTED AS SUPPORTING_DOCUMENTATION_SUBMITTED,
           :ALTERNATE_IN_OFFICE_WORK_DATE AS ALTERNATE_IN_OFFICE_WORK_DATE,
           :MANAGER_APPROVAL_RECEIVED AS MANAGER_APPROVAL_RECEIVED,
           :MANAGER_NAME AS MANAGER_NAME
         FROM DUAL) s
         ON (t.BAMBOO_ROW_ID = s.BAMBOO_ROW_ID)
         WHEN MATCHED THEN UPDATE SET
           t.EMPLOYEE_ID = s.EMPLOYEE_ID,
           t.EMAIL = s.EMAIL,
           t.EMPLOYEE_NAME = s.EMPLOYEE_NAME,
           t.DEPARTMENT = s.DEPARTMENT,
           t.REQUEST_DATE = s.REQUEST_DATE,
           t.REMOTE_WORK_START_DATE = s.REMOTE_WORK_START_DATE,
           t.REMOTE_WORK_END_DATE = s.REMOTE_WORK_END_DATE,
           t.REMOTE_WORK_TYPE = s.REMOTE_WORK_TYPE,
           t.REASON = s.REASON,
           t.SUPPORTING_DOCUMENTATION_SUBMITTED = s.SUPPORTING_DOCUMENTATION_SUBMITTED,
           t.ALTERNATE_IN_OFFICE_WORK_DATE = s.ALTERNATE_IN_OFFICE_WORK_DATE,
           t.MANAGER_APPROVAL_RECEIVED = s.MANAGER_APPROVAL_RECEIVED,
           t.MANAGER_NAME = s.MANAGER_NAME,
           t.UPDATED_AT = CURRENT_TIMESTAMP
         WHEN NOT MATCHED THEN INSERT (
           BAMBOO_ROW_ID, EMPLOYEE_ID, EMAIL, EMPLOYEE_NAME, DEPARTMENT,
           REQUEST_DATE, REMOTE_WORK_START_DATE, REMOTE_WORK_END_DATE, REMOTE_WORK_TYPE,
           REASON, SUPPORTING_DOCUMENTATION_SUBMITTED, ALTERNATE_IN_OFFICE_WORK_DATE,
           MANAGER_APPROVAL_RECEIVED, MANAGER_NAME
         ) VALUES (
           s.BAMBOO_ROW_ID, s.EMPLOYEE_ID, s.EMAIL, s.EMPLOYEE_NAME, s.DEPARTMENT,
           s.REQUEST_DATE, s.REMOTE_WORK_START_DATE, s.REMOTE_WORK_END_DATE, s.REMOTE_WORK_TYPE,
           s.REASON, s.SUPPORTING_DOCUMENTATION_SUBMITTED, s.ALTERNATE_IN_OFFICE_WORK_DATE,
           s.MANAGER_APPROVAL_RECEIVED, s.MANAGER_NAME
         )`,
        remoteWorkBinds,
      );
    }

    remoteWorkRequestsSynced = remoteWorkBinds.length;
  } catch (error) {
    errors.push(`Remote work request sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const workAbroadRequests = await fetchWorkAbroadRequests();
    const workAbroadBinds = workAbroadRequests
      .filter((row) => row.rowId && row.employeeId && row.workAbroadStartDate)
      .map((row) => ({
        BAMBOO_ROW_ID: Number(row.rowId),
        EMPLOYEE_ID: row.employeeId,
        EMAIL: normalizeEmailNullable(row.employeeEmail),
        EMPLOYEE_NAME: normalizeOracleText(row.employeeName),
        DEPARTMENT: normalizeOracleText(row.department),
        REQUEST_DATE: row.requestDate ? parseDateOnly(row.requestDate) : null,
        WORK_ABROAD_START_DATE: parseDateOnly(row.workAbroadStartDate),
        WORK_ABROAD_END_DATE: row.workAbroadEndDate ? parseDateOnly(row.workAbroadEndDate) : null,
        REMOTE_WORK_LOCATION_ADDRESS: normalizeOracleText(row.remoteWorkLocationAddress),
        COUNTRY_OR_PROVINCE: normalizeOracleText(row.countryOrProvince),
        REASON: normalizeOracleText(row.reason),
        WORK_SCHEDULE: normalizeOracleText(row.workSchedule),
        REQUEST_APPROVED: normalizeOracleText(row.requestApproved),
        APPROVED_DECLINED_BY: normalizeOracleText(row.approvedDeclinedBy),
      }));

    if (workAbroadBinds.length > 0) {
      await executeMany(
        `MERGE INTO TL_WORK_ABROAD_REQUESTS t
         USING (SELECT
           :BAMBOO_ROW_ID AS BAMBOO_ROW_ID,
           :EMPLOYEE_ID AS EMPLOYEE_ID,
           :EMAIL AS EMAIL,
           :EMPLOYEE_NAME AS EMPLOYEE_NAME,
           :DEPARTMENT AS DEPARTMENT,
           :REQUEST_DATE AS REQUEST_DATE,
           :WORK_ABROAD_START_DATE AS WORK_ABROAD_START_DATE,
           :WORK_ABROAD_END_DATE AS WORK_ABROAD_END_DATE,
           :REMOTE_WORK_LOCATION_ADDRESS AS REMOTE_WORK_LOCATION_ADDRESS,
           :COUNTRY_OR_PROVINCE AS COUNTRY_OR_PROVINCE,
           :REASON AS REASON,
           :WORK_SCHEDULE AS WORK_SCHEDULE,
           :REQUEST_APPROVED AS REQUEST_APPROVED,
           :APPROVED_DECLINED_BY AS APPROVED_DECLINED_BY
         FROM DUAL) s
         ON (t.BAMBOO_ROW_ID = s.BAMBOO_ROW_ID)
         WHEN MATCHED THEN UPDATE SET
           t.EMPLOYEE_ID = s.EMPLOYEE_ID,
           t.EMAIL = s.EMAIL,
           t.EMPLOYEE_NAME = s.EMPLOYEE_NAME,
           t.DEPARTMENT = s.DEPARTMENT,
           t.REQUEST_DATE = s.REQUEST_DATE,
           t.WORK_ABROAD_START_DATE = s.WORK_ABROAD_START_DATE,
           t.WORK_ABROAD_END_DATE = s.WORK_ABROAD_END_DATE,
           t.REMOTE_WORK_LOCATION_ADDRESS = s.REMOTE_WORK_LOCATION_ADDRESS,
           t.COUNTRY_OR_PROVINCE = s.COUNTRY_OR_PROVINCE,
           t.REASON = s.REASON,
           t.WORK_SCHEDULE = s.WORK_SCHEDULE,
           t.REQUEST_APPROVED = s.REQUEST_APPROVED,
           t.APPROVED_DECLINED_BY = s.APPROVED_DECLINED_BY,
           t.UPDATED_AT = CURRENT_TIMESTAMP
         WHEN NOT MATCHED THEN INSERT (
           BAMBOO_ROW_ID, EMPLOYEE_ID, EMAIL, EMPLOYEE_NAME, DEPARTMENT,
           REQUEST_DATE, WORK_ABROAD_START_DATE, WORK_ABROAD_END_DATE,
           REMOTE_WORK_LOCATION_ADDRESS, COUNTRY_OR_PROVINCE, REASON, WORK_SCHEDULE,
           REQUEST_APPROVED, APPROVED_DECLINED_BY
         ) VALUES (
           s.BAMBOO_ROW_ID, s.EMPLOYEE_ID, s.EMAIL, s.EMPLOYEE_NAME, s.DEPARTMENT,
           s.REQUEST_DATE, s.WORK_ABROAD_START_DATE, s.WORK_ABROAD_END_DATE,
           s.REMOTE_WORK_LOCATION_ADDRESS, s.COUNTRY_OR_PROVINCE, s.REASON, s.WORK_SCHEDULE,
           s.REQUEST_APPROVED, s.APPROVED_DECLINED_BY
         )`,
        workAbroadBinds,
      );
    }

    workAbroadRequestsSynced = workAbroadBinds.length;
  } catch (error) {
    errors.push(`Work abroad request sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Step 4: Auto-map BambooHR employees to TBS employee numbers
  try {
    tbsMapped = await syncTbsEmployeeMap();
  } catch (error) {
    errors.push(`TBS mapping sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const completedAt = new Date();
  const recordsSynced =
    employeesSynced +
    attendanceSynced +
    productivitySynced +
    timeOffSynced +
    remoteWorkRequestsSynced +
    workAbroadRequestsSynced +
    tbsMapped;

  try {
    await execute(
      `UPDATE TL_SYNC_LOG
       SET COMPLETED_AT = :completedAt,
           STATUS = :status,
           RECORDS_SYNCED = :recordsSynced,
           ERROR_MESSAGE = :errorMessage
       WHERE SYNC_TYPE = :syncType
         AND STARTED_AT = :startedAt
         AND STATUS = 'running'`,
      {
        completedAt,
        status: errors.length > 0 ? 'completed_error' : 'completed',
        recordsSynced,
        errorMessage: errors.length > 0 ? errors.join(' | ').slice(0, 4000) : null,
        syncType,
        startedAt: now,
      },
    );
  } catch (error) {
    console.error('[Sync] Failed to write sync completion log:', error);
  }

  const summary: SyncSummary = {
    startedAt: now.toISOString(),
    completedAt: completedAt.toISOString(),
    daysBack,
    employeesSynced,
    attendanceSynced,
    productivitySynced,
    timeOffSynced,
    remoteWorkRequestsSynced,
    workAbroadRequestsSynced,
    tbsMapped,
    errors,
  };

  if (errors.length > 0) {
    console.error('[Sync] Completed with errors', summary);
  } else {
    console.log('[Sync] Completed successfully', summary);
  }

  return summary;
}

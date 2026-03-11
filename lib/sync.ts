import { fetchActiveEmployees, fetchRemoteWorkRequests, fetchTimeOffRequests } from './bamboohr';
import { fetchOfficeAttendanceData, fetchProductivityData } from './bigquery';
import { execute, executeMany, initializeSchema } from './oracle';
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
  tbsMapped: number;
  errors: string[];
}

function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map((part) => Number(part));
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

/**
 * Auto-maps unmapped BambooHR employees to TBS employee numbers by matching
 * on first+last name. When multiple TBS records share a name, picks the one
 * with the most recent time entry.
 */
export async function syncTbsEmployeeMap(): Promise<number> {
  const result = await execute(`
    MERGE INTO TL_TBS_EMPLOYEE_MAP m
    USING (
      SELECT b.EMAIL, t.EMPLOYEE_NO
      FROM TL_EMPLOYEES b
      JOIN (
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
      ) t ON UPPER(b.FIRST_NAME) = UPPER(TRIM(t.EMPLOYEE_FIRST_NAME))
          AND UPPER(b.LAST_NAME) = UPPER(TRIM(t.EMPLOYEE_LAST_NAME))
          AND t.RN = 1
      WHERE b.EMAIL IS NOT NULL
        AND (b.STATUS IS NULL OR UPPER(b.STATUS) != 'INACTIVE')
        AND LOWER(b.EMAIL) NOT IN (SELECT LOWER(EMAIL) FROM TL_TBS_EMPLOYEE_MAP)
    ) src
    ON (LOWER(m.EMAIL) = LOWER(src.EMAIL))
    WHEN NOT MATCHED THEN INSERT (EMAIL, TBS_EMPLOYEE_NO, MATCH_METHOD, CREATED_AT)
    VALUES (LOWER(src.EMAIL), src.EMPLOYEE_NO, 'auto-name', CURRENT_TIMESTAMP)
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
  let tbsMapped = 0;

  try {
    const employees = await fetchActiveEmployees();
    const employeeBinds = employees
      .filter((emp) => emp.workEmail)
      .map((emp) => ({
        ID: emp.id,
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
           ID, EMAIL, DISPLAY_NAME, FIRST_NAME, LAST_NAME, JOB_TITLE,
           DEPARTMENT, DIVISION, LOCATION, SUPERVISOR_ID, SUPERVISOR_NAME, SUPERVISOR_EMAIL,
           HIRE_DATE, STATUS, PHOTO_URL, REMOTE_WORKDAY_POLICY_ASSIGNED
         ) VALUES (
           s.ID, s.EMAIL, s.DISPLAY_NAME, s.FIRST_NAME, s.LAST_NAME, s.JOB_TITLE,
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
    const attendance = await fetchOfficeAttendanceData(startDate, now);
    const attendanceBinds = attendance
      .filter((row) => row.email)
      .map((row) => ({
        RECORD_DATE: row.date,
        EMAIL: normalizeEmailNullable(row.email),
        DISPLAY_NAME: row.displayName || null,
        LOCATION: row.location || 'Unknown',
        TOTAL_HOURS: row.totalHours || 0,
        IS_PTO: row.isPTO ? 1 : 0,
        PTO_TYPE: row.ptoType || null,
        PTO_HOURS: row.ptoHours || 0,
      }));

    if (attendanceBinds.length > 0) {
      await executeMany(
        `MERGE INTO TL_ATTENDANCE t
         USING (SELECT
           :RECORD_DATE AS RECORD_DATE,
           :EMAIL AS EMAIL,
           :DISPLAY_NAME AS DISPLAY_NAME,
           :LOCATION AS LOCATION,
           :TOTAL_HOURS AS TOTAL_HOURS,
           :IS_PTO AS IS_PTO,
           :PTO_TYPE AS PTO_TYPE,
           :PTO_HOURS AS PTO_HOURS
         FROM DUAL) s
         ON (t.RECORD_DATE = s.RECORD_DATE AND LOWER(t.EMAIL) = LOWER(s.EMAIL))
         WHEN MATCHED THEN UPDATE SET
           t.DISPLAY_NAME = s.DISPLAY_NAME,
           t.LOCATION = s.LOCATION,
           t.TOTAL_HOURS = s.TOTAL_HOURS,
           t.IS_PTO = s.IS_PTO,
           t.PTO_TYPE = s.PTO_TYPE,
           t.PTO_HOURS = s.PTO_HOURS
         WHEN NOT MATCHED THEN INSERT (
           RECORD_DATE, EMAIL, DISPLAY_NAME, LOCATION, TOTAL_HOURS, IS_PTO, PTO_TYPE, PTO_HOURS
         ) VALUES (
           s.RECORD_DATE, s.EMAIL, s.DISPLAY_NAME, s.LOCATION, s.TOTAL_HOURS, s.IS_PTO, s.PTO_TYPE, s.PTO_HOURS
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
        EMPLOYEE_NAME: row.employeeName || null,
        DEPARTMENT: row.department || null,
        REQUEST_DATE: row.requestDate ? parseDateOnly(row.requestDate) : null,
        REMOTE_WORK_START_DATE: parseDateOnly(row.remoteWorkStartDate),
        REMOTE_WORK_END_DATE: row.remoteWorkEndDate ? parseDateOnly(row.remoteWorkEndDate) : null,
        REMOTE_WORK_TYPE: row.remoteWorkType || null,
        REASON: row.reason || null,
        SUPPORTING_DOCUMENTATION_SUBMITTED: row.supportingDocumentationSubmitted || null,
        ALTERNATE_IN_OFFICE_WORK_DATE: row.alternateInOfficeWorkDate || null,
        MANAGER_APPROVAL_RECEIVED: row.managerApprovalReceived || null,
        MANAGER_NAME: row.managerName || null,
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

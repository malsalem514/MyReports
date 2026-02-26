import { fetchActiveEmployees, fetchTimeOffRequests } from './bamboohr';
import { fetchOfficeAttendanceData } from './bigquery';
import { executeMany, initializeSchema } from './oracle';

export interface SyncSummary {
  startedAt: string;
  completedAt: string;
  daysBack: number;
  employeesSynced: number;
  attendanceSynced: number;
  timeOffSynced: number;
  errors: string[];
}

function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map((part) => Number(part));
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

export async function runFullSync(daysBack: number = 7): Promise<SyncSummary> {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - Math.max(1, daysBack));

  await initializeSchema();

  const errors: string[] = [];
  let employeesSynced = 0;
  let attendanceSynced = 0;
  let timeOffSynced = 0;

  try {
    const employees = await fetchActiveEmployees();
    const employeeBinds = employees
      .filter((emp) => emp.workEmail)
      .map((emp) => ({
        ID: emp.id,
        EMAIL: emp.workEmail?.toLowerCase() || null,
        DISPLAY_NAME: emp.displayName || null,
        FIRST_NAME: emp.firstName || null,
        LAST_NAME: emp.lastName || null,
        JOB_TITLE: emp.jobTitle || null,
        DEPARTMENT: emp.department || null,
        DIVISION: emp.division || null,
        LOCATION: emp.location || null,
        SUPERVISOR_ID: emp.supervisorId || emp.supervisorEId || null,
        SUPERVISOR_EMAIL: emp.supervisorEmail?.toLowerCase() || null,
        HIRE_DATE: emp.hireDate ? parseDateOnly(emp.hireDate) : null,
        STATUS: emp.status || emp.employmentStatus || null,
        PHOTO_URL: emp.photoUrl || null,
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
           :SUPERVISOR_EMAIL AS SUPERVISOR_EMAIL,
           :HIRE_DATE AS HIRE_DATE,
           :STATUS AS STATUS,
           :PHOTO_URL AS PHOTO_URL
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
           t.SUPERVISOR_EMAIL = s.SUPERVISOR_EMAIL,
           t.HIRE_DATE = s.HIRE_DATE,
           t.STATUS = s.STATUS,
           t.PHOTO_URL = s.PHOTO_URL,
           t.UPDATED_AT = CURRENT_TIMESTAMP
         WHEN NOT MATCHED THEN INSERT (
           ID, EMAIL, DISPLAY_NAME, FIRST_NAME, LAST_NAME, JOB_TITLE,
           DEPARTMENT, DIVISION, LOCATION, SUPERVISOR_ID, SUPERVISOR_EMAIL,
           HIRE_DATE, STATUS, PHOTO_URL
         ) VALUES (
           s.ID, s.EMAIL, s.DISPLAY_NAME, s.FIRST_NAME, s.LAST_NAME, s.JOB_TITLE,
           s.DEPARTMENT, s.DIVISION, s.LOCATION, s.SUPERVISOR_ID, s.SUPERVISOR_EMAIL,
           s.HIRE_DATE, s.STATUS, s.PHOTO_URL
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
        EMAIL: row.email.toLowerCase(),
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
    const timeOff = await fetchTimeOffRequests(startDate, now);
    const ptoBinds = timeOff
      .filter((row) => row.employeeId)
      .map((row) => ({
        EMPLOYEE_ID: row.employeeId,
        EMAIL: row.employeeEmail?.toLowerCase() || null,
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

  const completedAt = new Date();
  const summary: SyncSummary = {
    startedAt: now.toISOString(),
    completedAt: completedAt.toISOString(),
    daysBack,
    employeesSynced,
    attendanceSynced,
    timeOffSynced,
    errors,
  };

  if (errors.length > 0) {
    console.error('[Sync] Completed with errors', summary);
  } else {
    console.log('[Sync] Completed successfully', summary);
  }

  return summary;
}

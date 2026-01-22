import { execute, executeTransaction, query, queryOne } from './oracle';
import type { Connection } from 'oracledb';

// ============================================================================
// Type Definitions
// ============================================================================

export interface Employee {
  EMPLOYEE_ID: number;
  BAMBOOHR_ID: string;
  EMAIL: string;
  FIRST_NAME: string;
  LAST_NAME: string;
  DISPLAY_NAME: string;
  JOB_TITLE: string | null;
  DEPARTMENT: string | null;
  DIVISION: string | null;
  LOCATION: string | null;
  WORK_EMAIL: string | null;
  SUPERVISOR_ID: number | null;
  SUPERVISOR_EMAIL: string | null;
  HIRE_DATE: Date | null;
  EMPLOYMENT_STATUS: string | null;
  IS_ACTIVE: number;
  CREATED_AT: Date;
  UPDATED_AT: Date;
  SYNCED_AT: Date | null;
}

export interface ProductivityDaily {
  ID: number;
  EMPLOYEE_ID: number;
  ACTIVITY_DATE: Date;
  USERNAME: string | null;
  EMAIL: string | null;
  PRODUCTIVE_TIME: number;
  UNPRODUCTIVE_TIME: number;
  NEUTRAL_TIME: number;
  TOTAL_TIME: number;
  PRODUCTIVITY_SCORE: number | null;
  PRODUCTIVE_HOURS: number;
  TOTAL_HOURS: number;
  ACTIVE_TIME: number;
  IDLE_TIME: number;
  OFFLINE_TIME: number;
  FOCUS_TIME: number;
  COLLABORATION_TIME: number;
  CREATED_AT: Date;
  SYNCED_AT: Date | null;
}

export interface SyncStatus {
  ID: number;
  SYNC_TYPE: string;
  SYNC_SOURCE: string;
  STARTED_AT: Date;
  COMPLETED_AT: Date | null;
  STATUS: 'running' | 'completed' | 'failed';
  RECORDS_PROCESSED: number;
  RECORDS_CREATED: number;
  RECORDS_UPDATED: number;
  RECORDS_FAILED: number;
  ERROR_MESSAGE: string | null;
  SYNC_PARAMS: string | null;
  CREATED_AT: Date;
}

export interface ManagerHierarchy {
  EMPLOYEE_ID: number;
  EMAIL: string;
  DISPLAY_NAME: string;
  SUPERVISOR_ID: number | null;
  MANAGER_ID: number;
  HIERARCHY_LEVEL: number;
}

export interface ProductivitySummary {
  EMPLOYEE_ID: number;
  DISPLAY_NAME: string;
  EMAIL: string;
  DEPARTMENT: string | null;
  SUPERVISOR_ID: number | null;
  DAYS_TRACKED: number;
  AVG_PRODUCTIVITY_SCORE: number | null;
  TOTAL_PRODUCTIVE_HOURS: number;
  TOTAL_HOURS: number;
  AVG_PRODUCTIVE_PERCENT: number | null;
  FIRST_ACTIVITY_DATE: Date | null;
  LAST_ACTIVITY_DATE: Date | null;
}

// ============================================================================
// Employee Queries
// ============================================================================

export async function getEmployeeById(
  employeeId: number
): Promise<Employee | null> {
  return queryOne<Employee>(
    `SELECT * FROM hr_employees WHERE employee_id = :employeeId`,
    { employeeId }
  );
}

export async function getEmployeeByEmail(
  email: string
): Promise<Employee | null> {
  return queryOne<Employee>(
    `SELECT * FROM hr_employees WHERE LOWER(email) = LOWER(:email)`,
    { email }
  );
}

export async function getEmployeeByBambooHrId(
  bamboohrId: string
): Promise<Employee | null> {
  return queryOne<Employee>(
    `SELECT * FROM hr_employees WHERE bamboohr_id = :bamboohrId`,
    { bamboohrId }
  );
}

export async function getActiveEmployees(): Promise<Employee[]> {
  return query<Employee>(
    `SELECT * FROM hr_employees WHERE is_active = 1 ORDER BY display_name`
  );
}

export async function getEmployeesByDepartment(
  department: string
): Promise<Employee[]> {
  return query<Employee>(
    `SELECT * FROM hr_employees
     WHERE department = :department AND is_active = 1
     ORDER BY display_name`,
    { department }
  );
}

export async function getDirectReports(
  supervisorId: number
): Promise<Employee[]> {
  return query<Employee>(
    `SELECT * FROM hr_employees
     WHERE supervisor_id = :supervisorId AND is_active = 1
     ORDER BY display_name`,
    { supervisorId }
  );
}

export async function getAllReports(managerId: number): Promise<Employee[]> {
  return query<Employee>(
    `SELECT e.* FROM hr_employees e
     INNER JOIN hr_manager_hierarchy h ON e.employee_id = h.employee_id
     WHERE h.manager_id = :managerId AND e.is_active = 1
     ORDER BY e.display_name`,
    { managerId }
  );
}

export async function upsertEmployee(
  employee: Partial<Employee>
): Promise<number> {
  const sql = `
    MERGE INTO hr_employees dest
    USING (
      SELECT :bamboohrId AS bamboohr_id FROM DUAL
    ) src
    ON (dest.bamboohr_id = src.bamboohr_id)
    WHEN MATCHED THEN
      UPDATE SET
        email = :email,
        first_name = :firstName,
        last_name = :lastName,
        job_title = :jobTitle,
        department = :department,
        division = :division,
        location = :location,
        work_email = :workEmail,
        supervisor_email = :supervisorEmail,
        hire_date = :hireDate,
        employment_status = :employmentStatus,
        is_active = :isActive,
        synced_at = CURRENT_TIMESTAMP
    WHEN NOT MATCHED THEN
      INSERT (
        employee_id, bamboohr_id, email, first_name, last_name,
        job_title, department, division, location, work_email,
        supervisor_email, hire_date, employment_status, is_active, synced_at
      ) VALUES (
        hr_employee_seq.NEXTVAL, :bamboohrId, :email, :firstName, :lastName,
        :jobTitle, :department, :division, :location, :workEmail,
        :supervisorEmail, :hireDate, :employmentStatus, :isActive, CURRENT_TIMESTAMP
      )
  `;

  return execute(sql, {
    bamboohrId: employee.BAMBOOHR_ID,
    email: employee.EMAIL,
    firstName: employee.FIRST_NAME,
    lastName: employee.LAST_NAME,
    jobTitle: employee.JOB_TITLE,
    department: employee.DEPARTMENT,
    division: employee.DIVISION,
    location: employee.LOCATION,
    workEmail: employee.WORK_EMAIL,
    supervisorEmail: employee.SUPERVISOR_EMAIL,
    hireDate: employee.HIRE_DATE,
    employmentStatus: employee.EMPLOYMENT_STATUS,
    isActive: employee.IS_ACTIVE ?? 1
  });
}

export async function updateEmployeeSupervisors(): Promise<void> {
  await execute(`
    UPDATE hr_employees e
    SET supervisor_id = (
      SELECT e2.employee_id
      FROM hr_employees e2
      WHERE LOWER(e2.email) = LOWER(e.supervisor_email)
    )
    WHERE e.supervisor_email IS NOT NULL
    AND e.supervisor_id IS NULL
  `);
}

// ============================================================================
// Productivity Queries
// ============================================================================

export async function getEmployeeProductivity(
  employeeId: number,
  startDate: Date,
  endDate: Date
): Promise<ProductivityDaily[]> {
  return query<ProductivityDaily>(
    `SELECT * FROM hr_productivity_daily
     WHERE employee_id = :employeeId
     AND activity_date BETWEEN :startDate AND :endDate
     ORDER BY activity_date DESC`,
    { employeeId, startDate, endDate }
  );
}

export async function getTeamProductivity(
  employeeIds: number[],
  startDate: Date,
  endDate: Date
): Promise<ProductivityDaily[]> {
  if (employeeIds.length === 0) return [];

  const placeholders = employeeIds.map((_, i) => `:id${i}`).join(',');
  const binds: Record<string, number | Date> = {
    startDate,
    endDate
  };
  employeeIds.forEach((id, i) => {
    binds[`id${i}`] = id;
  });

  return query<ProductivityDaily>(
    `SELECT p.*, e.display_name, e.department
     FROM hr_productivity_daily p
     INNER JOIN hr_employees e ON p.employee_id = e.employee_id
     WHERE p.employee_id IN (${placeholders})
     AND p.activity_date BETWEEN :startDate AND :endDate
     ORDER BY p.activity_date DESC, e.display_name`,
    binds
  );
}

export async function getProductivitySummaryByDateRange(
  employeeIds: number[],
  startDate: Date,
  endDate: Date
): Promise<
  {
    EMPLOYEE_ID: number;
    DISPLAY_NAME: string;
    DEPARTMENT: string | null;
    AVG_PRODUCTIVITY_SCORE: number;
    TOTAL_PRODUCTIVE_HOURS: number;
    TOTAL_HOURS: number;
    DAYS_TRACKED: number;
  }[]
> {
  if (employeeIds.length === 0) return [];

  const placeholders = employeeIds.map((_, i) => `:id${i}`).join(',');
  const binds: Record<string, number | Date> = {
    startDate,
    endDate
  };
  employeeIds.forEach((id, i) => {
    binds[`id${i}`] = id;
  });

  return query(
    `SELECT
      e.employee_id,
      e.display_name,
      e.department,
      ROUND(AVG(p.productivity_score), 2) AS avg_productivity_score,
      ROUND(SUM(p.productive_time) / 3600, 2) AS total_productive_hours,
      ROUND(SUM(p.total_time) / 3600, 2) AS total_hours,
      COUNT(DISTINCT p.activity_date) AS days_tracked
    FROM hr_employees e
    LEFT JOIN hr_productivity_daily p ON e.employee_id = p.employee_id
      AND p.activity_date BETWEEN :startDate AND :endDate
    WHERE e.employee_id IN (${placeholders})
    AND e.is_active = 1
    GROUP BY e.employee_id, e.display_name, e.department
    ORDER BY e.display_name`,
    binds
  );
}

export async function upsertProductivityData(
  data: Partial<ProductivityDaily>
): Promise<number> {
  const sql = `
    MERGE INTO hr_productivity_daily dest
    USING (
      SELECT :employeeId AS employee_id, :activityDate AS activity_date FROM DUAL
    ) src
    ON (dest.employee_id = src.employee_id AND dest.activity_date = src.activity_date)
    WHEN MATCHED THEN
      UPDATE SET
        username = :username,
        email = :email,
        productive_time = :productiveTime,
        unproductive_time = :unproductiveTime,
        neutral_time = :neutralTime,
        total_time = :totalTime,
        productivity_score = :productivityScore,
        active_time = :activeTime,
        idle_time = :idleTime,
        offline_time = :offlineTime,
        focus_time = :focusTime,
        collaboration_time = :collaborationTime,
        synced_at = CURRENT_TIMESTAMP
    WHEN NOT MATCHED THEN
      INSERT (
        employee_id, activity_date, username, email,
        productive_time, unproductive_time, neutral_time, total_time,
        productivity_score, active_time, idle_time, offline_time,
        focus_time, collaboration_time, synced_at
      ) VALUES (
        :employeeId, :activityDate, :username, :email,
        :productiveTime, :unproductiveTime, :neutralTime, :totalTime,
        :productivityScore, :activeTime, :idleTime, :offlineTime,
        :focusTime, :collaborationTime, CURRENT_TIMESTAMP
      )
  `;

  return execute(sql, {
    employeeId: data.EMPLOYEE_ID,
    activityDate: data.ACTIVITY_DATE,
    username: data.USERNAME,
    email: data.EMAIL,
    productiveTime: data.PRODUCTIVE_TIME ?? 0,
    unproductiveTime: data.UNPRODUCTIVE_TIME ?? 0,
    neutralTime: data.NEUTRAL_TIME ?? 0,
    totalTime: data.TOTAL_TIME ?? 0,
    productivityScore: data.PRODUCTIVITY_SCORE,
    activeTime: data.ACTIVE_TIME ?? 0,
    idleTime: data.IDLE_TIME ?? 0,
    offlineTime: data.OFFLINE_TIME ?? 0,
    focusTime: data.FOCUS_TIME ?? 0,
    collaborationTime: data.COLLABORATION_TIME ?? 0
  });
}

export async function bulkInsertProductivity(
  data: Partial<ProductivityDaily>[],
  connection: Connection
): Promise<number> {
  if (data.length === 0) return 0;

  let inserted = 0;
  for (const record of data) {
    try {
      await connection.execute(
        `INSERT INTO hr_productivity_daily (
          employee_id, activity_date, username, email,
          productive_time, unproductive_time, neutral_time, total_time,
          productivity_score, active_time, idle_time, offline_time,
          focus_time, collaboration_time, synced_at
        ) VALUES (
          :employeeId, :activityDate, :username, :email,
          :productiveTime, :unproductiveTime, :neutralTime, :totalTime,
          :productivityScore, :activeTime, :idleTime, :offlineTime,
          :focusTime, :collaborationTime, CURRENT_TIMESTAMP
        )`,
        {
          employeeId: record.EMPLOYEE_ID,
          activityDate: record.ACTIVITY_DATE,
          username: record.USERNAME,
          email: record.EMAIL,
          productiveTime: record.PRODUCTIVE_TIME ?? 0,
          unproductiveTime: record.UNPRODUCTIVE_TIME ?? 0,
          neutralTime: record.NEUTRAL_TIME ?? 0,
          totalTime: record.TOTAL_TIME ?? 0,
          productivityScore: record.PRODUCTIVITY_SCORE,
          activeTime: record.ACTIVE_TIME ?? 0,
          idleTime: record.IDLE_TIME ?? 0,
          offlineTime: record.OFFLINE_TIME ?? 0,
          focusTime: record.FOCUS_TIME ?? 0,
          collaborationTime: record.COLLABORATION_TIME ?? 0
        }
      );
      inserted++;
    } catch {
      // Skip duplicates, log other errors
    }
  }
  return inserted;
}

// ============================================================================
// Sync Status Queries
// ============================================================================

export async function createSyncStatus(
  syncType: string,
  syncSource: string,
  syncParams?: Record<string, unknown>
): Promise<number> {
  const result = await query<{ ID: number }>(
    `INSERT INTO hr_sync_status (sync_type, sync_source, started_at, status, sync_params)
     VALUES (:syncType, :syncSource, CURRENT_TIMESTAMP, 'running', :syncParams)
     RETURNING id INTO :id`,
    {
      syncType,
      syncSource,
      syncParams: syncParams ? JSON.stringify(syncParams) : null
    }
  );
  return result[0]?.ID || 0;
}

export async function updateSyncStatus(
  syncId: number,
  status: 'completed' | 'failed',
  stats: {
    recordsProcessed?: number;
    recordsCreated?: number;
    recordsUpdated?: number;
    recordsFailed?: number;
    errorMessage?: string;
  }
): Promise<void> {
  await execute(
    `UPDATE hr_sync_status SET
      completed_at = CURRENT_TIMESTAMP,
      status = :status,
      records_processed = :recordsProcessed,
      records_created = :recordsCreated,
      records_updated = :recordsUpdated,
      records_failed = :recordsFailed,
      error_message = :errorMessage
     WHERE id = :syncId`,
    {
      syncId,
      status,
      recordsProcessed: stats.recordsProcessed ?? 0,
      recordsCreated: stats.recordsCreated ?? 0,
      recordsUpdated: stats.recordsUpdated ?? 0,
      recordsFailed: stats.recordsFailed ?? 0,
      errorMessage: stats.errorMessage ?? null
    }
  );
}

export async function getLatestSync(
  syncType: string
): Promise<SyncStatus | null> {
  return queryOne<SyncStatus>(
    `SELECT * FROM hr_sync_status
     WHERE sync_type = :syncType
     ORDER BY started_at DESC
     FETCH FIRST 1 ROW ONLY`,
    { syncType }
  );
}

// ============================================================================
// Manager Hierarchy Queries
// ============================================================================

export async function getManagerReportIds(
  managerId: number
): Promise<number[]> {
  const rows = await query<{ EMPLOYEE_ID: number }>(
    `SELECT DISTINCT employee_id FROM hr_manager_hierarchy WHERE manager_id = :managerId`,
    { managerId }
  );
  return rows.map((r) => r.EMPLOYEE_ID);
}

export async function isManager(employeeId: number): Promise<boolean> {
  const result = await queryOne<{ COUNT: number }>(
    `SELECT COUNT(*) AS COUNT FROM hr_employees WHERE supervisor_id = :employeeId AND is_active = 1`,
    { employeeId }
  );
  return (result?.COUNT ?? 0) > 0;
}

// ============================================================================
// HR Admin Queries
// ============================================================================

export async function isHRAdmin(email: string): Promise<boolean> {
  const result = await queryOne<{ COUNT: number }>(
    `SELECT COUNT(*) AS COUNT FROM hr_admin_users
     WHERE LOWER(user_email) = LOWER(:email) AND is_active = 1`,
    { email }
  );
  return (result?.COUNT ?? 0) > 0;
}

export async function getHRAdminRole(email: string): Promise<string | null> {
  const result = await queryOne<{ ROLE: string }>(
    `SELECT role FROM hr_admin_users
     WHERE LOWER(user_email) = LOWER(:email) AND is_active = 1`,
    { email }
  );
  return result?.ROLE ?? null;
}

// ============================================================================
// Analytics Queries
// ============================================================================

export async function getDepartmentStats(
  startDate: Date,
  endDate: Date
): Promise<
  {
    DEPARTMENT: string;
    EMPLOYEE_COUNT: number;
    AVG_PRODUCTIVITY_SCORE: number;
    TOTAL_PRODUCTIVE_HOURS: number;
  }[]
> {
  return query(
    `SELECT
      e.department,
      COUNT(DISTINCT e.employee_id) AS employee_count,
      ROUND(AVG(p.productivity_score), 2) AS avg_productivity_score,
      ROUND(SUM(p.productive_time) / 3600, 2) AS total_productive_hours
    FROM hr_employees e
    LEFT JOIN hr_productivity_daily p ON e.employee_id = p.employee_id
      AND p.activity_date BETWEEN :startDate AND :endDate
    WHERE e.is_active = 1 AND e.department IS NOT NULL
    GROUP BY e.department
    ORDER BY avg_productivity_score DESC NULLS LAST`,
    { startDate, endDate }
  );
}

export async function getProductivityTrend(
  employeeIds: number[],
  startDate: Date,
  endDate: Date
): Promise<
  {
    ACTIVITY_DATE: Date;
    AVG_PRODUCTIVITY_SCORE: number;
    TOTAL_PRODUCTIVE_HOURS: number;
    EMPLOYEE_COUNT: number;
  }[]
> {
  if (employeeIds.length === 0) return [];

  const placeholders = employeeIds.map((_, i) => `:id${i}`).join(',');
  const binds: Record<string, number | Date> = {
    startDate,
    endDate
  };
  employeeIds.forEach((id, i) => {
    binds[`id${i}`] = id;
  });

  return query(
    `SELECT
      activity_date,
      ROUND(AVG(productivity_score), 2) AS avg_productivity_score,
      ROUND(SUM(productive_time) / 3600, 2) AS total_productive_hours,
      COUNT(DISTINCT employee_id) AS employee_count
    FROM hr_productivity_daily
    WHERE employee_id IN (${placeholders})
    AND activity_date BETWEEN :startDate AND :endDate
    GROUP BY activity_date
    ORDER BY activity_date`,
    binds
  );
}

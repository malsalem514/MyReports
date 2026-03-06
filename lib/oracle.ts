import oracledb from 'oracledb';

// ============================================================================
// Configuration
// ============================================================================

const oracleConfig = {
  user: process.env.ORACLE_USER || 'timelogs',
  password: process.env.ORACLE_PASSWORD || 'timelogs',
  connectString: process.env.ORACLE_CONNECT_STRING || 'srv-db-100/suppops',
  poolMin: 2,
  poolMax: 10,
  poolIncrement: 1,
};

// ============================================================================
// Connection Pool
// ============================================================================

let poolPromise: Promise<oracledb.Pool> | null = null;

async function createPool(): Promise<oracledb.Pool> {
  try {
    oracledb.initOracleClient();
  } catch {
    // Thin mode is default in newer versions
  }

  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  oracledb.autoCommit = true;

  const pool = await oracledb.createPool(oracleConfig);
  console.log('Oracle connection pool created');
  return pool;
}

export async function getPool(): Promise<oracledb.Pool> {
  if (!poolPromise) {
    poolPromise = createPool().catch((err) => {
      poolPromise = null; // Reset so next call retries
      throw err;
    });
  }
  return poolPromise;
}

export async function getConnection(): Promise<oracledb.Connection> {
  const pool = await getPool();
  return pool.getConnection();
}

// ============================================================================
// Query Helpers
// ============================================================================

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const conn = await getConnection();
  try {
    const result = await conn.execute<T>(sql, params, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return (result.rows || []) as T[];
  } finally {
    await conn.close();
  }
}

export async function execute(
  sql: string,
  params: Record<string, unknown> = {},
): Promise<oracledb.Result<unknown>> {
  const conn = await getConnection();
  try {
    const result = await conn.execute(sql, params, { autoCommit: true });
    return result;
  } finally {
    await conn.close();
  }
}

export async function executeMany(
  sql: string,
  binds: Record<string, unknown>[],
  options: oracledb.ExecuteManyOptions = {},
): Promise<oracledb.Result<unknown>> {
  const conn = await getConnection();
  try {
    const result = await conn.executeMany(sql, binds, {
      autoCommit: true,
      ...options,
    });
    return result;
  } finally {
    await conn.close();
  }
}

// ============================================================================
// Schema Management
// ============================================================================

export async function initializeSchema(): Promise<void> {
  const conn = await getConnection();
  try {
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_EMPLOYEES (
        ID VARCHAR2(50) PRIMARY KEY,
        EMAIL VARCHAR2(255) UNIQUE,
        DISPLAY_NAME VARCHAR2(255),
        FIRST_NAME VARCHAR2(100),
        LAST_NAME VARCHAR2(100),
        JOB_TITLE VARCHAR2(255),
        DEPARTMENT VARCHAR2(255),
        DIVISION VARCHAR2(255),
        LOCATION VARCHAR2(255),
        SUPERVISOR_ID VARCHAR2(50),
        SUPERVISOR_EMAIL VARCHAR2(255),
        HIRE_DATE DATE,
        STATUS VARCHAR2(50),
        PHOTO_URL VARCHAR2(2000),
        REMOTE_WORKDAY_POLICY_ASSIGNED NUMBER(1) DEFAULT 0,
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await safeExecuteDDL(conn, `ALTER TABLE TL_EMPLOYEES ADD REMOTE_WORKDAY_POLICY_ASSIGNED NUMBER(1) DEFAULT 0`);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_ATTENDANCE (
        ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        RECORD_DATE DATE NOT NULL,
        EMAIL VARCHAR2(255) NOT NULL,
        DISPLAY_NAME VARCHAR2(255),
        LOCATION VARCHAR2(50),
        TOTAL_HOURS NUMBER(10,2),
        IS_PTO NUMBER(1) DEFAULT 0,
        PTO_TYPE VARCHAR2(100),
        PTO_HOURS NUMBER(10,2),
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT TL_ATT_UNIQUE UNIQUE (RECORD_DATE, EMAIL)
      )
    `);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_PRODUCTIVITY (
        ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        RECORD_DATE DATE NOT NULL,
        EMAIL VARCHAR2(255) NOT NULL,
        PRODUCTIVE_TIME NUMBER(12) DEFAULT 0,
        UNPRODUCTIVE_TIME NUMBER(12) DEFAULT 0,
        NEUTRAL_TIME NUMBER(12) DEFAULT 0,
        TOTAL_TIME NUMBER(12) DEFAULT 0,
        PRODUCTIVITY_SCORE NUMBER(5,2),
        ACTIVE_TIME NUMBER(12) DEFAULT 0,
        IDLE_TIME NUMBER(12) DEFAULT 0,
        FOCUS_TIME NUMBER(12) DEFAULT 0,
        COLLABORATION_TIME NUMBER(12) DEFAULT 0,
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT TL_PROD_UNIQUE UNIQUE (RECORD_DATE, EMAIL)
      )
    `);
    await safeExecuteDDL(conn, `ALTER TABLE TL_PRODUCTIVITY ADD PRODUCTIVE_ACTIVE_TIME NUMBER(12) DEFAULT 0`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_PRODUCTIVITY ADD PRODUCTIVE_PASSIVE_TIME NUMBER(12) DEFAULT 0`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_PRODUCTIVITY ADD UNPRODUCTIVE_ACTIVE_TIME NUMBER(12) DEFAULT 0`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_PRODUCTIVITY ADD UNPRODUCTIVE_PASSIVE_TIME NUMBER(12) DEFAULT 0`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_PRODUCTIVITY ADD UNDEFINED_ACTIVE_TIME NUMBER(12) DEFAULT 0`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_PRODUCTIVITY ADD UNDEFINED_PASSIVE_TIME NUMBER(12) DEFAULT 0`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_PRODUCTIVITY ADD UTILIZATION_LEVEL VARCHAR2(100)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_PRODUCTIVITY ADD LOCATION VARCHAR2(100)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_PRODUCTIVITY ADD TIME_OFF_TIME NUMBER(12) DEFAULT 0`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_PRODUCTIVITY ADD TIME_OFF_TYPE VARCHAR2(100)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_PRODUCTIVITY ADD FIRST_ACTIVITY_AT TIMESTAMP`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_PRODUCTIVITY ADD LAST_ACTIVITY_AT TIMESTAMP`);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_TIME_OFF (
        ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        EMPLOYEE_ID VARCHAR2(50) NOT NULL,
        EMAIL VARCHAR2(255),
        EMPLOYEE_NAME VARCHAR2(255),
        DEPARTMENT VARCHAR2(255),
        START_DATE DATE NOT NULL,
        END_DATE DATE NOT NULL,
        TYPE VARCHAR2(100),
        STATUS VARCHAR2(50),
        AMOUNT NUMBER(10,2),
        UNIT VARCHAR2(50),
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT TL_PTO_UNIQUE UNIQUE (EMPLOYEE_ID, START_DATE, END_DATE, TYPE)
      )
    `);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_SYNC_LOG (
        ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        SYNC_TYPE VARCHAR2(50) NOT NULL,
        STARTED_AT TIMESTAMP NOT NULL,
        COMPLETED_AT TIMESTAMP,
        STATUS VARCHAR2(20) DEFAULT 'running',
        RECORDS_SYNCED NUMBER DEFAULT 0,
        ERROR_MESSAGE VARCHAR2(4000),
        DATE_RANGE_START DATE,
        DATE_RANGE_END DATE
      )
    `);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_TBS_EMPLOYEE_MAP (
        EMAIL VARCHAR2(255) NOT NULL,
        TBS_EMPLOYEE_NO NUMBER NOT NULL,
        MATCH_METHOD VARCHAR2(50),
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT TL_TBS_EMPLOYEE_MAP_UQ_EMAIL UNIQUE (EMAIL),
        CONSTRAINT TL_TBS_EMPLOYEE_MAP_UQ_NO UNIQUE (TBS_EMPLOYEE_NO)
      )
    `);
    await safeExecuteDDL(conn, `CREATE INDEX TL_ATT_DATE_IDX ON TL_ATTENDANCE(RECORD_DATE)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_ATT_EMAIL_IDX ON TL_ATTENDANCE(EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_PROD_DATE_IDX ON TL_PRODUCTIVITY(RECORD_DATE)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_PROD_EMAIL_IDX ON TL_PRODUCTIVITY(EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_PTO_DATE_IDX ON TL_TIME_OFF(START_DATE, END_DATE)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_EMP_DEPT_IDX ON TL_EMPLOYEES(DEPARTMENT)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_EMP_STATUS_IDX ON TL_EMPLOYEES(STATUS)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_TBS_MAP_EMAIL_IDX ON TL_TBS_EMPLOYEE_MAP(EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_TBS_MAP_NO_IDX ON TL_TBS_EMPLOYEE_MAP(TBS_EMPLOYEE_NO)`);

    // Weekly report views used by the dashboard pages.
    await safeExecuteDDL(conn, `
      CREATE OR REPLACE VIEW V_ATTENDANCE_WEEKLY AS
      SELECT
        EMAIL,
        DISPLAY_NAME,
        DEPARTMENT,
        OFFICE_LOCATION,
        WEEK_START,
        SUM(OFFICE_DAYS) AS OFFICE_DAYS,
        SUM(REMOTE_DAYS) AS REMOTE_DAYS
      FROM (
        SELECT
          LOWER(e.EMAIL) AS EMAIL,
          NVL(e.DISPLAY_NAME, e.EMAIL) AS DISPLAY_NAME,
          NVL(e.DEPARTMENT, 'Unknown') AS DEPARTMENT,
          NVL(e.LOCATION, 'Unknown') AS OFFICE_LOCATION,
          TRUNC(d.RECORD_DATE, 'IW') AS WEEK_START,
          CASE WHEN d.LOCATION = 'Office' THEN 1 ELSE 0 END AS OFFICE_DAYS,
          CASE WHEN d.LOCATION = 'Remote' THEN 1 ELSE 0 END AS REMOTE_DAYS
        FROM TL_EMPLOYEES e
        JOIN (
          SELECT EMAIL, RECORD_DATE, LOCATION
          FROM (
            SELECT
              EMAIL,
              RECORD_DATE,
              LOCATION,
              ROW_NUMBER() OVER (
                PARTITION BY EMAIL, TRUNC(RECORD_DATE)
                ORDER BY DECODE(LOCATION, 'Office', 1, 'Remote', 2, 3)
              ) AS rn
            FROM TL_ATTENDANCE
            WHERE TO_CHAR(RECORD_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')
          )
          WHERE rn = 1
        ) d ON LOWER(d.EMAIL) = LOWER(e.EMAIL)
        WHERE e.EMAIL IS NOT NULL
          AND (e.STATUS IS NULL OR UPPER(e.STATUS) != 'INACTIVE')
          AND e.DEPARTMENT NOT IN ('Executive', 'Administration')
      )
      GROUP BY EMAIL, DISPLAY_NAME, DEPARTMENT, OFFICE_LOCATION, WEEK_START
    `);

    await safeExecuteDDL(conn, `
      CREATE OR REPLACE VIEW V_PTO_WEEKLY AS
      SELECT
        LOWER(EMAIL) AS EMAIL,
        TRUNC(PTO_DATE, 'IW') AS WEEK_START,
        COUNT(*) AS PTO_DAYS
      FROM (
        SELECT
          t.EMAIL,
          t.START_DATE + LEVEL - 1 AS PTO_DATE
        FROM TL_TIME_OFF t
        CONNECT BY LEVEL <= (TRUNC(t.END_DATE) - TRUNC(t.START_DATE) + 1)
          AND PRIOR t.ROWID = t.ROWID
          AND PRIOR SYS_GUID() IS NOT NULL
      )
      WHERE TO_CHAR(PTO_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')
      GROUP BY LOWER(EMAIL), TRUNC(PTO_DATE, 'IW')
    `);

    // Tab visibility — role defaults
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_TAB_ROLES (
        ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ROLE_NAME VARCHAR2(50) NOT NULL,
        TAB_KEY VARCHAR2(50) NOT NULL,
        VISIBLE NUMBER(1) DEFAULT 1,
        CONSTRAINT TL_TAB_ROLES_UQ UNIQUE (ROLE_NAME, TAB_KEY)
      )
    `);

    // Tab visibility — per-email overrides (wins over role)
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_TAB_OVERRIDES (
        ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        EMAIL VARCHAR2(255) NOT NULL,
        TAB_KEY VARCHAR2(50) NOT NULL,
        VISIBLE NUMBER(1) DEFAULT 1,
        CONSTRAINT TL_TAB_OVERRIDES_UQ UNIQUE (EMAIL, TAB_KEY)
      )
    `);

    // Seed role defaults (MERGE = idempotent)
    const allTabs = ['office-attendance','timesheet-compare','working-hours'];
    const directorTabs = ['office-attendance','timesheet-compare','working-hours'];
    const managerTabs = ['office-attendance','timesheet-compare','working-hours'];
    const employeeTabs = ['office-attendance'];

    for (const tab of allTabs) {
      await safeExecuteDDL(conn, `
        MERGE INTO TL_TAB_ROLES t
        USING (SELECT 'hr-admin' AS ROLE_NAME, '${tab}' AS TAB_KEY FROM DUAL) s
        ON (t.ROLE_NAME = s.ROLE_NAME AND t.TAB_KEY = s.TAB_KEY)
        WHEN NOT MATCHED THEN INSERT (ROLE_NAME, TAB_KEY, VISIBLE) VALUES ('hr-admin', '${tab}', 1)
      `);
    }
    for (const tab of allTabs) {
      const visible = directorTabs.includes(tab) ? 1 : 0;
      await safeExecuteDDL(conn, `
        MERGE INTO TL_TAB_ROLES t
        USING (SELECT 'director' AS ROLE_NAME, '${tab}' AS TAB_KEY FROM DUAL) s
        ON (t.ROLE_NAME = s.ROLE_NAME AND t.TAB_KEY = s.TAB_KEY)
        WHEN NOT MATCHED THEN INSERT (ROLE_NAME, TAB_KEY, VISIBLE) VALUES ('director', '${tab}', ${visible})
      `);
    }
    for (const tab of allTabs) {
      const visible = managerTabs.includes(tab) ? 1 : 0;
      await safeExecuteDDL(conn, `
        MERGE INTO TL_TAB_ROLES t
        USING (SELECT 'manager' AS ROLE_NAME, '${tab}' AS TAB_KEY FROM DUAL) s
        ON (t.ROLE_NAME = s.ROLE_NAME AND t.TAB_KEY = s.TAB_KEY)
        WHEN NOT MATCHED THEN INSERT (ROLE_NAME, TAB_KEY, VISIBLE) VALUES ('manager', '${tab}', ${visible})
      `);
    }
    for (const tab of allTabs) {
      const visible = employeeTabs.includes(tab) ? 1 : 0;
      await safeExecuteDDL(conn, `
        MERGE INTO TL_TAB_ROLES t
        USING (SELECT 'employee' AS ROLE_NAME, '${tab}' AS TAB_KEY FROM DUAL) s
        ON (t.ROLE_NAME = s.ROLE_NAME AND t.TAB_KEY = s.TAB_KEY)
        WHEN NOT MATCHED THEN INSERT (ROLE_NAME, TAB_KEY, VISIBLE) VALUES ('employee', '${tab}', ${visible})
      `);
    }

    console.log('Oracle schema initialized successfully');
  } finally {
    await conn.close();
  }
}

async function safeExecuteDDL(conn: oracledb.Connection, sql: string): Promise<void> {
  try {
    await conn.execute(sql);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'errorNum' in error) {
      const errNum = (error as { errorNum: number }).errorNum;
      // Ignore: already exists (955), name used (957), index exists (1408), column exists (1430)
      if (errNum === 955 || errNum === 957 || errNum === 1408 || errNum === 1430) return;
    }
    console.error('DDL Error:', sql, error);
  }
}

// ============================================================================
// Health Check & Shutdown
// ============================================================================

export async function healthCheck(): Promise<boolean> {
  try {
    const result = await query<{ RESULT: number }>('SELECT 1 as RESULT FROM DUAL');
    return result[0]?.RESULT === 1;
  } catch (error) {
    console.error('Oracle health check failed:', error);
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (poolPromise) {
    const pool = await poolPromise;
    await pool.close(0);
    poolPromise = null;
    console.log('Oracle connection pool closed');
  }
}

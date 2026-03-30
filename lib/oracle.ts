import oracledb from 'oracledb';
import { EMAIL_ALIAS_TO_CANONICAL } from './email';

// ============================================================================
// Configuration
// ============================================================================

function getOracleConfig(): Record<string, unknown> {
  const user = process.env.ORACLE_USER?.trim();
  const password = process.env.ORACLE_PASSWORD?.trim();
  const connectString = process.env.ORACLE_CONNECT_STRING?.trim();
  const missing = [
    !user ? 'ORACLE_USER' : null,
    !password ? 'ORACLE_PASSWORD' : null,
    !connectString ? 'ORACLE_CONNECT_STRING' : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required Oracle configuration: ${missing.join(', ')}`);
  }

  return {
    user,
    password,
    connectString,
    poolMin: 2,
    poolMax: 10,
    poolIncrement: 1,
  };
}

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

  const pool = await oracledb.createPool(getOracleConfig());
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
        EMPLOYEE_NUMBER NUMBER,
        EMAIL VARCHAR2(255) UNIQUE,
        DISPLAY_NAME VARCHAR2(255),
        FIRST_NAME VARCHAR2(100),
        LAST_NAME VARCHAR2(100),
        JOB_TITLE VARCHAR2(255),
        DEPARTMENT VARCHAR2(255),
        DIVISION VARCHAR2(255),
        LOCATION VARCHAR2(255),
        SUPERVISOR_ID VARCHAR2(50),
        SUPERVISOR_NAME VARCHAR2(255),
        SUPERVISOR_EMAIL VARCHAR2(255),
        HIRE_DATE DATE,
        STATUS VARCHAR2(50),
        PHOTO_URL VARCHAR2(2000),
        REMOTE_WORKDAY_POLICY_ASSIGNED NUMBER(1) DEFAULT 0,
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await safeExecuteDDL(conn, `ALTER TABLE TL_EMPLOYEES ADD EMPLOYEE_NUMBER NUMBER`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_EMPLOYEES ADD SUPERVISOR_NAME VARCHAR2(255)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_EMPLOYEES ADD REMOTE_WORKDAY_POLICY_ASSIGNED NUMBER(1) DEFAULT 0`);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_ATTENDANCE (
        ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        RECORD_DATE DATE NOT NULL,
        EMAIL VARCHAR2(255) NOT NULL,
        DISPLAY_NAME VARCHAR2(255),
        LOCATION VARCHAR2(50),
        RAW_LOCATION VARCHAR2(50),
        OFFICE_IP_OVERRIDE NUMBER(1) DEFAULT 0,
        OFFICE_IP_MATCHES VARCHAR2(1000),
        TOTAL_HOURS NUMBER(10,2),
        IS_PTO NUMBER(1) DEFAULT 0,
        PTO_TYPE VARCHAR2(100),
        PTO_HOURS NUMBER(10,2),
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT TL_ATT_UNIQUE UNIQUE (RECORD_DATE, EMAIL)
      )
    `);
    await safeExecuteDDL(conn, `ALTER TABLE TL_ATTENDANCE ADD RAW_LOCATION VARCHAR2(50)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_ATTENDANCE ADD OFFICE_IP_OVERRIDE NUMBER(1) DEFAULT 0`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_ATTENDANCE ADD OFFICE_IP_MATCHES VARCHAR2(1000)`);
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
      CREATE TABLE TL_REMOTE_WORK_REQUESTS (
        BAMBOO_ROW_ID NUMBER PRIMARY KEY,
        EMPLOYEE_ID VARCHAR2(50) NOT NULL,
        EMAIL VARCHAR2(255),
        EMPLOYEE_NAME VARCHAR2(255),
        DEPARTMENT VARCHAR2(255),
        REQUEST_DATE DATE,
        REMOTE_WORK_START_DATE DATE NOT NULL,
        REMOTE_WORK_END_DATE DATE,
        REMOTE_WORK_TYPE VARCHAR2(100),
        REASON VARCHAR2(4000),
        SUPPORTING_DOCUMENTATION_SUBMITTED VARCHAR2(100),
        ALTERNATE_IN_OFFICE_WORK_DATE VARCHAR2(100),
        MANAGER_APPROVAL_RECEIVED VARCHAR2(100),
        MANAGER_NAME VARCHAR2(255),
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_WORK_ABROAD_REQUESTS (
        BAMBOO_ROW_ID NUMBER PRIMARY KEY,
        EMPLOYEE_ID VARCHAR2(50) NOT NULL,
        EMAIL VARCHAR2(255),
        EMPLOYEE_NAME VARCHAR2(255),
        DEPARTMENT VARCHAR2(255),
        REQUEST_DATE DATE,
        WORK_ABROAD_START_DATE DATE NOT NULL,
        WORK_ABROAD_END_DATE DATE,
        REMOTE_WORK_LOCATION_ADDRESS VARCHAR2(4000),
        COUNTRY_OR_PROVINCE VARCHAR2(255),
        REASON VARCHAR2(4000),
        WORK_SCHEDULE VARCHAR2(4000),
        REQUEST_APPROVED VARCHAR2(100),
        APPROVED_DECLINED_BY VARCHAR2(255),
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_ACTIVTRAK_IDENTIFIERS (
        USER_ID NUMBER NOT NULL,
        IDENTIFIER_EMAIL VARCHAR2(500) NOT NULL,
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT TL_ACTRK_IDS_UQ UNIQUE (USER_ID, IDENTIFIER_EMAIL)
      )
    `);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_ACTIVTRAK_USER_STATS (
        USER_ID NUMBER PRIMARY KEY,
        USER_NAME VARCHAR2(500),
        FIRST_SEEN DATE,
        LAST_SEEN DATE,
        ACTIVITY_ROW_COUNT NUMBER DEFAULT 0,
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_OFFICE_IPS (
        PUBLIC_IP VARCHAR2(255) PRIMARY KEY,
        LABEL VARCHAR2(255),
        OFFICE_LOCATION VARCHAR2(255),
        IS_ACTIVE NUMBER(1) DEFAULT 1 NOT NULL,
        NOTES VARCHAR2(1000),
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_OFFICE_IP_ACTIVITY (
        RECORD_DATE DATE NOT NULL,
        EMAIL VARCHAR2(255) NOT NULL,
        DISPLAY_NAME VARCHAR2(255),
        PUBLIC_IP VARCHAR2(255) NOT NULL,
        DURATION_SECONDS NUMBER DEFAULT 0,
        EVENT_COUNT NUMBER DEFAULT 0,
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT TL_OFFICE_IP_ACTIVITY_UQ UNIQUE (RECORD_DATE, EMAIL, PUBLIC_IP)
      )
    `);
    await safeExecuteDDL(conn, `CREATE INDEX TL_ATT_DATE_IDX ON TL_ATTENDANCE(RECORD_DATE)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_ATT_EMAIL_IDX ON TL_ATTENDANCE(EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_PROD_DATE_IDX ON TL_PRODUCTIVITY(RECORD_DATE)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_PROD_EMAIL_IDX ON TL_PRODUCTIVITY(EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_PTO_DATE_IDX ON TL_TIME_OFF(START_DATE, END_DATE)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_RWR_EMAIL_IDX ON TL_REMOTE_WORK_REQUESTS(EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_RWR_DATE_IDX ON TL_REMOTE_WORK_REQUESTS(REMOTE_WORK_START_DATE, REMOTE_WORK_END_DATE)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_WAR_EMAIL_IDX ON TL_WORK_ABROAD_REQUESTS(EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_WAR_DATE_IDX ON TL_WORK_ABROAD_REQUESTS(WORK_ABROAD_START_DATE, WORK_ABROAD_END_DATE)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_EMP_DEPT_IDX ON TL_EMPLOYEES(DEPARTMENT)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_EMP_STATUS_IDX ON TL_EMPLOYEES(STATUS)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_TBS_MAP_EMAIL_IDX ON TL_TBS_EMPLOYEE_MAP(EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_TBS_MAP_NO_IDX ON TL_TBS_EMPLOYEE_MAP(TBS_EMPLOYEE_NO)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_ACTRK_IDS_USER_IDX ON TL_ACTIVTRAK_IDENTIFIERS(USER_ID)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_ACTRK_IDS_EMAIL_IDX ON TL_ACTIVTRAK_IDENTIFIERS(IDENTIFIER_EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_OFFICE_IP_ACTIVITY_DATE_IDX ON TL_OFFICE_IP_ACTIVITY(RECORD_DATE)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_OFFICE_IP_ACTIVITY_EMAIL_IDX ON TL_OFFICE_IP_ACTIVITY(EMAIL)`);

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
        LOWER(t.EMAIL) AS EMAIL,
        TRUNC(t.PTO_DATE, 'IW') AS WEEK_START,
        COUNT(*) AS PTO_DAYS
      FROM (
        SELECT
          t.EMAIL,
          t.START_DATE + LEVEL - 1 AS PTO_DATE
        FROM TL_TIME_OFF t
        CONNECT BY LEVEL <= (TRUNC(t.END_DATE) - TRUNC(t.START_DATE) + 1)
          AND PRIOR t.ROWID = t.ROWID
          AND PRIOR SYS_GUID() IS NOT NULL
      ) t
      JOIN TL_EMPLOYEES e
        ON LOWER(e.EMAIL) = LOWER(t.EMAIL)
      WHERE TO_CHAR(t.PTO_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')
        AND e.EMAIL IS NOT NULL
        AND (e.STATUS IS NULL OR UPPER(e.STATUS) != 'INACTIVE')
        AND e.DEPARTMENT NOT IN ('Executive', 'Administration')
      GROUP BY LOWER(t.EMAIL), TRUNC(t.PTO_DATE, 'IW')
    `);

    await safeExecuteDDL(conn, `
      CREATE OR REPLACE VIEW V_USER_MAPPINGS AS
      SELECT
        e.ID AS EMPLOYEE_ID,
        LOWER(e.EMAIL) AS EMAIL,
        NVL(
          e.DISPLAY_NAME,
          TRIM(NVL(e.FIRST_NAME, '') || ' ' || NVL(e.LAST_NAME, ''))
        ) AS DISPLAY_NAME,
        e.FIRST_NAME,
        e.LAST_NAME,
        e.JOB_TITLE,
        NVL(e.DEPARTMENT, 'Unknown') AS DEPARTMENT,
        NVL(e.DIVISION, 'Unknown') AS DIVISION,
        NVL(e.LOCATION, 'Unknown') AS LOCATION,
        e.SUPERVISOR_EMAIL,
        e.HIRE_DATE,
        e.STATUS,
        m.TBS_EMPLOYEE_NO,
        CASE
          WHEN t.EMPLOYEE_NO IS NULL THEN NULL
          ELSE TRIM(NVL(t.EMPLOYEE_FIRST_NAME, '') || ' ' || NVL(t.EMPLOYEE_LAST_NAME, ''))
        END AS TBS_EMPLOYEE_NAME,
        CASE
          WHEN at.HAS_ACTIVTRAK_USER = 1 THEN NVL(act.EMPLOYEE_NAME, NVL(at.ACTIVTRAK_USER, LOWER(e.EMAIL)))
          ELSE NULL
        END AS ACTIVTRAK_USER,
        act.ACTRK_ID,
        CASE
          WHEN act.ACTRK_ID IS NULL THEN 0
          ELSE 1
        END AS HAS_ACTIVTRAK_MAPPING,
        NVL(at.HAS_ACTIVTRAK_USER, 0) AS HAS_ACTIVTRAK_USER
      FROM TL_EMPLOYEES e
      LEFT JOIN TL_TBS_EMPLOYEE_MAP m
        ON LOWER(m.EMAIL) = LOWER(e.EMAIL)
      LEFT JOIN TBS_EMPLOYEES@TBS_LINK t
        ON t.EMPLOYEE_NO = m.TBS_EMPLOYEE_NO
      LEFT JOIN ACTRK_TBS_IDS act
        ON act.EMPLOYEE_NO = m.TBS_EMPLOYEE_NO
      LEFT JOIN (
        SELECT
          activity.EMAIL,
          MAX(activity.DISPLAY_NAME) KEEP (DENSE_RANK LAST ORDER BY activity.LAST_SEEN) AS ACTIVTRAK_USER,
          1 AS HAS_ACTIVTRAK_USER
        FROM (
          SELECT
            LOWER(a.EMAIL) AS EMAIL,
            NULLIF(TRIM(a.DISPLAY_NAME), '') AS DISPLAY_NAME,
            MAX(a.RECORD_DATE) AS LAST_SEEN
          FROM TL_ATTENDANCE a
          GROUP BY LOWER(a.EMAIL), NULLIF(TRIM(a.DISPLAY_NAME), '')

          UNION ALL

          SELECT
            LOWER(p.EMAIL) AS EMAIL,
            NULL AS DISPLAY_NAME,
            MAX(p.RECORD_DATE) AS LAST_SEEN
          FROM TL_PRODUCTIVITY p
          GROUP BY LOWER(p.EMAIL)
        ) activity
        GROUP BY activity.EMAIL
      ) at
        ON at.EMAIL = LOWER(e.EMAIL)
      WHERE e.EMAIL IS NOT NULL
        AND (e.STATUS IS NULL OR UPPER(e.STATUS) != 'INACTIVE')
        AND e.DEPARTMENT NOT IN ('Executive', 'Administration')
    `);

    await safeExecuteDDL(conn, `
      CREATE OR REPLACE VIEW V_BAMBOO_NOT_IN_ACTIVTRAK AS
      SELECT *
      FROM V_USER_MAPPINGS
      WHERE HAS_ACTIVTRAK_USER = 0
    `);
    await safeExecuteDDL(conn, `
      CREATE OR REPLACE VIEW V_SUSPICIOUS_ACTIVTRAK_IDENTITIES AS
      WITH identifier_rollup AS (
        SELECT
          ai.USER_ID,
          LISTAGG(ai.IDENTIFIER_EMAIL, '; ') WITHIN GROUP (ORDER BY ai.IDENTIFIER_EMAIL) AS IDENTIFIERS,
          COUNT(*) AS IDENTIFIER_COUNT,
          MAX(CASE
            WHEN REGEXP_LIKE(ai.IDENTIFIER_EMAIL, '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$', 'i')
              THEN 0 ELSE 1
          END) AS HAS_NON_EMAIL_IDENTIFIER,
          MAX(CASE
            WHEN REGEXP_LIKE(LOWER(ai.IDENTIFIER_EMAIL), 'macbook|laptop|desktop|(^|[^a-z])pc([^a-z]|$)|imac|book pro')
              THEN 1 ELSE 0
          END) AS HAS_DEVICE_STYLE_IDENTIFIER,
          MAX(CASE
            WHEN REGEXP_LIKE(LOWER(ai.IDENTIFIER_EMAIL), '@(jestais\\.com|jesta\\.com|jestais\\.onmicrosoft\\.com)$')
              THEN 0 ELSE 1
          END) AS HAS_NON_CORPORATE_DOMAIN
        FROM TL_ACTIVTRAK_IDENTIFIERS ai
        GROUP BY ai.USER_ID
      )
      SELECT
        LOWER(e.EMAIL) AS EMAIL,
        NVL(
          e.DISPLAY_NAME,
          TRIM(NVL(e.FIRST_NAME, '') || ' ' || NVL(e.LAST_NAME, ''))
        ) AS DISPLAY_NAME,
        NVL(e.DEPARTMENT, 'Unknown') AS DEPARTMENT,
        NVL(e.LOCATION, 'Unknown') AS LOCATION,
        m.TBS_EMPLOYEE_NO,
        act.ACTRK_ID,
        act.EMPLOYEE_NAME AS ACTRK_EMPLOYEE_NAME,
        stats.USER_NAME AS ACTIVTRAK_USER_NAME,
        ids.IDENTIFIERS,
        NVL(ids.IDENTIFIER_COUNT, 0) AS IDENTIFIER_COUNT,
        NVL(stats.ACTIVITY_ROW_COUNT, 0) AS ACTIVITY_ROW_COUNT,
        stats.FIRST_SEEN,
        stats.LAST_SEEN,
        CASE WHEN ids.USER_ID IS NULL THEN 1 ELSE 0 END AS HAS_NO_IDENTIFIER,
        CASE
          WHEN ids.USER_ID IS NULL THEN 0
          WHEN EXISTS (
            SELECT 1
            FROM TL_ACTIVTRAK_IDENTIFIERS ai_match
            WHERE ai_match.USER_ID = act.ACTRK_ID
              AND LOWER(ai_match.IDENTIFIER_EMAIL) = LOWER(e.EMAIL)
          ) THEN 0
          ELSE 1
        END AS HAS_IDENTIFIER_MISMATCH,
        NVL(ids.HAS_DEVICE_STYLE_IDENTIFIER, 0) AS HAS_DEVICE_STYLE_IDENTIFIER,
        NVL(ids.HAS_NON_EMAIL_IDENTIFIER, 0) AS HAS_NON_EMAIL_IDENTIFIER,
        NVL(ids.HAS_NON_CORPORATE_DOMAIN, 0) AS HAS_NON_CORPORATE_DOMAIN,
        CASE WHEN NVL(stats.ACTIVITY_ROW_COUNT, 0) = 0 THEN 1 ELSE 0 END AS HAS_NO_ACTIVITY
      FROM TL_EMPLOYEES e
      JOIN TL_TBS_EMPLOYEE_MAP m
        ON LOWER(m.EMAIL) = LOWER(e.EMAIL)
      JOIN ACTRK_TBS_IDS act
        ON act.EMPLOYEE_NO = m.TBS_EMPLOYEE_NO
       AND act.ACTRK_ID IS NOT NULL
      LEFT JOIN identifier_rollup ids
        ON ids.USER_ID = act.ACTRK_ID
      LEFT JOIN TL_ACTIVTRAK_USER_STATS stats
        ON stats.USER_ID = act.ACTRK_ID
      WHERE (e.STATUS IS NULL OR UPPER(e.STATUS) != 'INACTIVE')
        AND (
          ids.USER_ID IS NULL
          OR NVL(stats.ACTIVITY_ROW_COUNT, 0) = 0
          OR NVL(ids.HAS_DEVICE_STYLE_IDENTIFIER, 0) = 1
          OR NVL(ids.HAS_NON_EMAIL_IDENTIFIER, 0) = 1
          OR NVL(ids.HAS_NON_CORPORATE_DOMAIN, 0) = 1
          OR NOT EXISTS (
            SELECT 1
            FROM TL_ACTIVTRAK_IDENTIFIERS ai_match
            WHERE ai_match.USER_ID = act.ACTRK_ID
              AND LOWER(ai_match.IDENTIFIER_EMAIL) = LOWER(e.EMAIL)
          )
        )
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

    // Report Builder tables
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_SAVED_REPORTS (
        REPORT_ID     VARCHAR2(36)  NOT NULL,
        OWNER_EMAIL   VARCHAR2(255) NOT NULL,
        NAME          VARCHAR2(255) NOT NULL,
        DESCRIPTION   VARCHAR2(1000),
        REPORT_SPEC   CLOB          NOT NULL,
        CREATED_AT    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
        UPDATED_AT    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT PK_SAVED_REPORTS PRIMARY KEY (REPORT_ID)
      )
    `);
    await safeExecuteDDL(conn, `CREATE INDEX IDX_SAVED_REPORTS_OWNER ON TL_SAVED_REPORTS(LOWER(OWNER_EMAIL))`);

    await safeExecuteDDL(conn, `
      CREATE TABLE TL_DASHBOARDS (
        DASHBOARD_ID  VARCHAR2(36)  NOT NULL,
        OWNER_EMAIL   VARCHAR2(255) NOT NULL,
        NAME          VARCHAR2(255) NOT NULL,
        DESCRIPTION   VARCHAR2(1000),
        DASHBOARD_SPEC CLOB         NOT NULL,
        IS_SHARED     NUMBER(1)     DEFAULT 0,
        CREATED_AT    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
        UPDATED_AT    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT PK_DASHBOARDS PRIMARY KEY (DASHBOARD_ID)
      )
    `);
    await safeExecuteDDL(conn, `CREATE INDEX IDX_DASHBOARDS_OWNER ON TL_DASHBOARDS(LOWER(OWNER_EMAIL))`);

    await conn.execute(
      `MERGE INTO TL_OFFICE_IPS t
         USING (
           SELECT
             '67.70.186.132' AS PUBLIC_IP,
             'Known Office Network' AS LABEL,
             'Quebec (Montreal Head Office)' AS OFFICE_LOCATION,
             1 AS IS_ACTIVE,
             'Seeded from ActivTrak office-day validation' AS NOTES
           FROM DUAL
         ) s
         ON (t.PUBLIC_IP = s.PUBLIC_IP)
         WHEN MATCHED THEN UPDATE SET
           t.LABEL = s.LABEL,
           t.OFFICE_LOCATION = s.OFFICE_LOCATION,
           t.IS_ACTIVE = s.IS_ACTIVE,
           t.NOTES = s.NOTES,
           t.UPDATED_AT = CURRENT_TIMESTAMP
         WHEN NOT MATCHED THEN INSERT (
           PUBLIC_IP, LABEL, OFFICE_LOCATION, IS_ACTIVE, NOTES
         ) VALUES (
           s.PUBLIC_IP, s.LABEL, s.OFFICE_LOCATION, s.IS_ACTIVE, s.NOTES
         )`,
    );

    // Seed role defaults (MERGE = idempotent)
    const allTabs = ['office-attendance', 'timesheet-compare', 'working-hours', 'bamboo-not-in-activtrak'];
    const roleDefaults = [
      { roleName: 'root-admin', visibleTabs: allTabs },
      { roleName: 'hr-admin', visibleTabs: allTabs },
      { roleName: 'director', visibleTabs: ['office-attendance', 'timesheet-compare', 'working-hours'] },
      { roleName: 'manager', visibleTabs: ['office-attendance', 'timesheet-compare', 'working-hours'] },
      { roleName: 'employee', visibleTabs: ['office-attendance'] },
    ];

    for (const { roleName, visibleTabs } of roleDefaults) {
      for (const tab of allTabs) {
        const visible = visibleTabs.includes(tab) ? 1 : 0;
        await safeExecuteDDL(conn, `
          MERGE INTO TL_TAB_ROLES t
          USING (SELECT '${roleName}' AS ROLE_NAME, '${tab}' AS TAB_KEY FROM DUAL) s
          ON (t.ROLE_NAME = s.ROLE_NAME AND t.TAB_KEY = s.TAB_KEY)
          WHEN NOT MATCHED THEN INSERT (ROLE_NAME, TAB_KEY, VISIBLE) VALUES ('${roleName}', '${tab}', ${visible})
        `);
      }
    }

    await conn.execute(`
      UPDATE TL_TAB_ROLES
         SET VISIBLE = 1
       WHERE ROLE_NAME = 'root-admin'
         AND TAB_KEY IN (${allTabs.map((tab) => `'${tab}'`).join(', ')})
    `);

    const roleList = `'root-admin', 'hr-admin', 'director', 'manager', 'employee'`;
    const tabList = allTabs.map((tab) => `'${tab}'`).join(', ');
    await conn.execute(`
      DELETE FROM TL_TAB_ROLES
       WHERE ROLE_NAME NOT IN (${roleList})
          OR TAB_KEY NOT IN (${tabList})
    `);
    await conn.execute(`
      DELETE FROM TL_TAB_OVERRIDES
       WHERE TAB_KEY NOT IN (${tabList})
    `);

    for (const [sourceEmail, canonicalEmail] of Object.entries(EMAIL_ALIAS_TO_CANONICAL)) {
      if (sourceEmail === canonicalEmail) continue;

      await conn.execute(
        `DELETE FROM TL_ATTENDANCE
          WHERE LOWER(EMAIL) = :sourceEmail
            AND EXISTS (
              SELECT 1
                FROM TL_ATTENDANCE existing
               WHERE existing.RECORD_DATE = TL_ATTENDANCE.RECORD_DATE
                 AND LOWER(existing.EMAIL) = :canonicalEmail
            )`,
        { sourceEmail, canonicalEmail },
      );
      await conn.execute(
        `UPDATE TL_ATTENDANCE
            SET EMAIL = :canonicalEmail
          WHERE LOWER(EMAIL) = :sourceEmail`,
        { sourceEmail, canonicalEmail },
      );

      await conn.execute(
        `DELETE FROM TL_PRODUCTIVITY
          WHERE LOWER(EMAIL) = :sourceEmail
            AND EXISTS (
              SELECT 1
                FROM TL_PRODUCTIVITY existing
               WHERE existing.RECORD_DATE = TL_PRODUCTIVITY.RECORD_DATE
                 AND LOWER(existing.EMAIL) = :canonicalEmail
            )`,
        { sourceEmail, canonicalEmail },
      );
      await conn.execute(
        `UPDATE TL_PRODUCTIVITY
            SET EMAIL = :canonicalEmail
          WHERE LOWER(EMAIL) = :sourceEmail`,
        { sourceEmail, canonicalEmail },
      );

      await conn.execute(
        `UPDATE TL_EMPLOYEES
            SET EMAIL = :canonicalEmail
          WHERE LOWER(EMAIL) = :sourceEmail`,
        { sourceEmail, canonicalEmail },
      );
      await conn.execute(
        `UPDATE TL_EMPLOYEES
            SET SUPERVISOR_EMAIL = :canonicalEmail
          WHERE LOWER(SUPERVISOR_EMAIL) = :sourceEmail`,
        { sourceEmail, canonicalEmail },
      );
      await conn.execute(
        `UPDATE TL_TIME_OFF
            SET EMAIL = :canonicalEmail
          WHERE LOWER(EMAIL) = :sourceEmail`,
        { sourceEmail, canonicalEmail },
      );
      await conn.execute(
        `UPDATE TL_REMOTE_WORK_REQUESTS
            SET EMAIL = :canonicalEmail
          WHERE LOWER(EMAIL) = :sourceEmail`,
        { sourceEmail, canonicalEmail },
      );
      await conn.execute(
        `UPDATE TL_WORK_ABROAD_REQUESTS
            SET EMAIL = :canonicalEmail
          WHERE LOWER(EMAIL) = :sourceEmail`,
        { sourceEmail, canonicalEmail },
      );
      await conn.execute(
        `UPDATE TL_TBS_EMPLOYEE_MAP
            SET EMAIL = :canonicalEmail
          WHERE LOWER(EMAIL) = :sourceEmail`,
        { sourceEmail, canonicalEmail },
      );
      await conn.execute(
        `DELETE FROM TL_TAB_OVERRIDES
          WHERE LOWER(EMAIL) = :sourceEmail
            AND EXISTS (
              SELECT 1
                FROM TL_TAB_OVERRIDES existing
               WHERE existing.TAB_KEY = TL_TAB_OVERRIDES.TAB_KEY
                 AND LOWER(existing.EMAIL) = :canonicalEmail
            )`,
        { sourceEmail, canonicalEmail },
      );
      await conn.execute(
        `UPDATE TL_TAB_OVERRIDES
            SET EMAIL = :canonicalEmail
          WHERE LOWER(EMAIL) = :sourceEmail`,
        { sourceEmail, canonicalEmail },
      );
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

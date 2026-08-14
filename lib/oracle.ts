import oracledb from 'oracledb';
import { EMAIL_ALIAS_TO_CANONICAL } from './email';
import { getIntegrationTimeouts } from './integration-config';

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
    queueTimeout: getIntegrationTimeouts().oracleQueueMs,
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
  const connection = await pool.getConnection();
  connection.callTimeout = getIntegrationTimeouts().oracleCallMs;
  return connection;
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

export interface OracleTransaction {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
  execute(sql: string, params?: Record<string, unknown>): Promise<oracledb.Result<unknown>>;
  executeMany(
    sql: string,
    binds: Record<string, unknown>[],
    options?: oracledb.ExecuteManyOptions,
  ): Promise<oracledb.Result<unknown>>;
}

export interface TransactionControl {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export async function runOracleTransaction<T>(
  connection: TransactionControl,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    const result = await operation();
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('[Oracle] Transaction rollback failed:', rollbackError);
    }
    throw error;
  }
}

export async function withTransaction<T>(
  operation: (transaction: OracleTransaction) => Promise<T>,
): Promise<T> {
  const conn = await getConnection();
  const transaction: OracleTransaction = {
    async query<T = Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
      const result = await conn.execute<T>(sql, params, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: false,
      });
      return (result.rows || []) as T[];
    },
    execute(sql: string, params: Record<string, unknown> = {}) {
      return conn.execute(sql, params, { autoCommit: false });
    },
    executeMany(
      sql: string,
      binds: Record<string, unknown>[],
      options: oracledb.ExecuteManyOptions = {},
    ) {
      return conn.executeMany(sql, binds, {
        ...options,
        autoCommit: false,
      });
    },
  };

  try {
    return await runOracleTransaction(conn, () => operation(transaction));
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
      CREATE TABLE TL_DUO_AUTH_LOGS (
        TXID VARCHAR2(100) PRIMARY KEY,
        EVENT_TS TIMESTAMP NOT NULL,
        EVENT_TS_MS NUMBER(13) NOT NULL,
        ISO_TIMESTAMP VARCHAR2(50),
        EVENT_TYPE VARCHAR2(50),
        ALIAS VARCHAR2(255),
        RESULT VARCHAR2(50),
        REASON VARCHAR2(255),
        FACTOR VARCHAR2(100),
        USER_KEY VARCHAR2(100),
        USERNAME VARCHAR2(255),
        EMAIL VARCHAR2(255),
        APPLICATION_KEY VARCHAR2(100),
        APPLICATION_NAME VARCHAR2(255),
        DESTINATION_NAME VARCHAR2(255),
        ACCESS_DEVICE_IP VARCHAR2(255),
        ACCESS_DEVICE_HOSTNAME VARCHAR2(255),
        ACCESS_DEVICE_OS VARCHAR2(255),
        ACCESS_DEVICE_OS_VERSION VARCHAR2(100),
        ACCESS_DEVICE_BROWSER VARCHAR2(255),
        ACCESS_DEVICE_BROWSER_VERSION VARCHAR2(100),
        ACCESS_DEVICE_LOCATION VARCHAR2(500),
        ACCESS_DEVICE_CITY VARCHAR2(255),
        ACCESS_DEVICE_STATE VARCHAR2(255),
        ACCESS_DEVICE_COUNTRY VARCHAR2(255),
        AUTH_DEVICE_IP VARCHAR2(255),
        AUTH_DEVICE_KEY VARCHAR2(100),
        AUTH_DEVICE_NAME VARCHAR2(255),
        TRUSTED_ENDPOINT_STATUS VARCHAR2(100),
        RAW_JSON CLOB,
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await safeExecuteDDL(conn, `ALTER TABLE TL_DUO_AUTH_LOGS ADD ALIAS VARCHAR2(255)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_DUO_AUTH_LOGS ADD DESTINATION_NAME VARCHAR2(255)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_DUO_AUTH_LOGS ADD ACCESS_DEVICE_OS_VERSION VARCHAR2(100)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_DUO_AUTH_LOGS ADD ACCESS_DEVICE_BROWSER_VERSION VARCHAR2(100)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_DUO_AUTH_LOGS ADD ACCESS_DEVICE_CITY VARCHAR2(255)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_DUO_AUTH_LOGS ADD ACCESS_DEVICE_STATE VARCHAR2(255)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_DUO_AUTH_LOGS ADD ACCESS_DEVICE_COUNTRY VARCHAR2(255)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_DUO_AUTH_LOGS ADD AUTH_DEVICE_KEY VARCHAR2(100)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_DUO_AUTH_LOGS ADD TRUSTED_ENDPOINT_STATUS VARCHAR2(100)`);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_DUO_SYNC_STATE (
        STATE_KEY VARCHAR2(50) PRIMARY KEY,
        LAST_EVENT_TS_MS NUMBER(13),
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      CREATE TABLE TL_TBS_EMPLOYEES (
        EMPLOYEE_NO NUMBER PRIMARY KEY,
        EMPLOYEE_FIRST_NAME VARCHAR2(255),
        EMPLOYEE_LAST_NAME VARCHAR2(255),
        LAST_ENTRY DATE,
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await safeExecuteDDL(conn, `ALTER TABLE TL_TBS_EMPLOYEES ADD LAST_ENTRY DATE`);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_TBS_TIME_ENTRIES (
        ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        EMPLOYEE_NO NUMBER NOT NULL,
        ENTRY_DATE DATE NOT NULL,
        WORK_CODE VARCHAR2(255),
        WORK_DESCRIPTION VARCHAR2(1000),
        TIME_HOURS NUMBER(10,2),
        ENTRY_TYPE VARCHAR2(50),
        REMARK VARCHAR2(4000),
        DEFECT_CASE VARCHAR2(255),
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await safeExecuteDDL(conn, `ALTER TABLE TL_TBS_TIME_ENTRIES ADD REMARK VARCHAR2(4000)`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_TBS_TIME_ENTRIES ADD DEFECT_CASE VARCHAR2(255)`);
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
        FIRST_ACTIVITY_AT TIMESTAMP,
        LAST_ACTIVITY_AT TIMESTAMP,
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT TL_OFFICE_IP_ACTIVITY_UQ UNIQUE (RECORD_DATE, EMAIL, PUBLIC_IP)
      )
    `);
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_ACTIVTRAK_IP_ACTIVITY (
        RECORD_DATE DATE NOT NULL,
        EMAIL VARCHAR2(255) NOT NULL,
        USER_ID NUMBER,
        DISPLAY_NAME VARCHAR2(255),
        PUBLIC_IP VARCHAR2(255) NOT NULL,
        DURATION_SECONDS NUMBER DEFAULT 0,
        EVENT_COUNT NUMBER DEFAULT 0,
        FIRST_ACTIVITY_AT TIMESTAMP,
        LAST_ACTIVITY_AT TIMESTAMP,
        IS_OFFICE_IP NUMBER(1) DEFAULT 0,
        OFFICE_LOCATION VARCHAR2(255),
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT TL_ACTRK_IP_ACTIVITY_UQ UNIQUE (RECORD_DATE, EMAIL, PUBLIC_IP)
      )
    `);
    await safeExecuteDDL(conn, `ALTER TABLE TL_OFFICE_IP_ACTIVITY ADD FIRST_ACTIVITY_AT TIMESTAMP`);
    await safeExecuteDDL(conn, `ALTER TABLE TL_OFFICE_IP_ACTIVITY ADD LAST_ACTIVITY_AT TIMESTAMP`);
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
    await safeExecuteDDL(conn, `CREATE INDEX TL_TBS_EMP_LAST_ENTRY_IDX ON TL_TBS_EMPLOYEES(LAST_ENTRY)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_TBS_ENTRIES_DATE_IDX ON TL_TBS_TIME_ENTRIES(ENTRY_DATE)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_TBS_ENTRIES_EMP_IDX ON TL_TBS_TIME_ENTRIES(EMPLOYEE_NO)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_ACTRK_IDS_USER_IDX ON TL_ACTIVTRAK_IDENTIFIERS(USER_ID)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_ACTRK_IDS_EMAIL_IDX ON TL_ACTIVTRAK_IDENTIFIERS(IDENTIFIER_EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_OFFICE_IP_ACTIVITY_DATE_IDX ON TL_OFFICE_IP_ACTIVITY(RECORD_DATE)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_OFFICE_IP_ACTIVITY_EMAIL_IDX ON TL_OFFICE_IP_ACTIVITY(EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_DUO_AUTH_EVENT_TS_IDX ON TL_DUO_AUTH_LOGS(EVENT_TS)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_DUO_AUTH_EMAIL_IDX ON TL_DUO_AUTH_LOGS(EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_DUO_AUTH_USERNAME_IDX ON TL_DUO_AUTH_LOGS(USERNAME)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_DUO_AUTH_RESULT_IDX ON TL_DUO_AUTH_LOGS(RESULT)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_DUO_AUTH_IP_IDX ON TL_DUO_AUTH_LOGS(ACCESS_DEVICE_IP)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_ACTRK_IP_ACTIVITY_DATE_IDX ON TL_ACTIVTRAK_IP_ACTIVITY(RECORD_DATE)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_ACTRK_IP_ACTIVITY_EMAIL_IDX ON TL_ACTIVTRAK_IP_ACTIVITY(EMAIL)`);
    await safeExecuteDDL(conn, `CREATE INDEX TL_ACTRK_IP_ACTIVITY_IP_IDX ON TL_ACTIVTRAK_IP_ACTIVITY(PUBLIC_IP)`);

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
      LEFT JOIN TL_TBS_EMPLOYEES t
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
      CREATE OR REPLACE VIEW V_USER_MAPPINGS_REPORT AS
      WITH activtrak_email_activity AS (
        SELECT
          EMAIL,
          MAX(
            CASE
              WHEN ACTIVITY_AT <= CAST(SYSDATE + 1 AS TIMESTAMP) THEN ACTIVITY_AT
              ELSE NULL
            END
          ) AS LAST_ACTIVTRAK_ACTIVITY
        FROM (
          SELECT
            LOWER(p.EMAIL) AS EMAIL,
            MAX(NVL(p.LAST_ACTIVITY_AT, CAST(p.RECORD_DATE AS TIMESTAMP))) AS ACTIVITY_AT
          FROM TL_PRODUCTIVITY p
          WHERE p.EMAIL IS NOT NULL
          GROUP BY LOWER(p.EMAIL)

          UNION ALL

          SELECT
            LOWER(a.EMAIL) AS EMAIL,
            CAST(MAX(a.RECORD_DATE) AS TIMESTAMP) AS ACTIVITY_AT
          FROM TL_ATTENDANCE a
          WHERE a.EMAIL IS NOT NULL
          GROUP BY LOWER(a.EMAIL)

          UNION ALL

          SELECT
            LOWER(o.EMAIL) AS EMAIL,
            CAST(MAX(o.RECORD_DATE) AS TIMESTAMP) AS ACTIVITY_AT
          FROM TL_OFFICE_IP_ACTIVITY o
          WHERE o.EMAIL IS NOT NULL
          GROUP BY LOWER(o.EMAIL)
        )
        GROUP BY EMAIL
      ),
      activtrak_user_stats_clean AS (
        SELECT
          USER_ID,
          CASE
            WHEN LAST_SEEN <= CAST(SYSDATE + 1 AS TIMESTAMP) THEN CAST(LAST_SEEN AS TIMESTAMP)
            ELSE NULL
          END AS LAST_SEEN
        FROM TL_ACTIVTRAK_USER_STATS
      ),
      tbs_last_entry AS (
        SELECT
          EMPLOYEE_NO,
          LAST_ENTRY AS LAST_TBS_ENTRY
        FROM TL_TBS_EMPLOYEES
      )
      SELECT
        m.EMPLOYEE_ID,
        m.EMAIL,
        m.DISPLAY_NAME,
        m.FIRST_NAME,
        m.LAST_NAME,
        m.JOB_TITLE,
        m.DEPARTMENT,
        m.DIVISION,
        m.LOCATION,
        m.SUPERVISOR_EMAIL,
        m.HIRE_DATE,
        m.STATUS,
        m.TBS_EMPLOYEE_NO,
        m.TBS_EMPLOYEE_NAME,
        m.ACTIVTRAK_USER,
        m.ACTRK_ID,
        m.HAS_ACTIVTRAK_MAPPING,
        m.HAS_ACTIVTRAK_USER,
        CASE
          WHEN activity.LAST_ACTIVTRAK_ACTIVITY IS NULL THEN CAST(stats.LAST_SEEN AS TIMESTAMP)
          WHEN stats.LAST_SEEN IS NULL THEN activity.LAST_ACTIVTRAK_ACTIVITY
          ELSE GREATEST(activity.LAST_ACTIVTRAK_ACTIVITY, CAST(stats.LAST_SEEN AS TIMESTAMP))
        END AS LAST_ACTIVTRAK_ACTIVITY,
        tbs.LAST_TBS_ENTRY
      FROM V_USER_MAPPINGS m
      LEFT JOIN activtrak_email_activity activity
        ON activity.EMAIL = m.EMAIL
      LEFT JOIN activtrak_user_stats_clean stats
        ON stats.USER_ID = m.ACTRK_ID
      LEFT JOIN tbs_last_entry tbs
        ON tbs.EMPLOYEE_NO = m.TBS_EMPLOYEE_NO
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
    await safeExecuteDDL(conn, `
      CREATE OR REPLACE VIEW V_DUO_ACTIVTRAK_DAILY AS
      WITH duo_daily AS (
        SELECT
          TRUNC(EVENT_TS) AS RECORD_DATE,
          LOWER(NVL(EMAIL, USERNAME)) AS EMAIL,
          COUNT(*) AS DUO_LOGIN_COUNT,
          MIN(EVENT_TS) AS FIRST_DUO_LOGIN_AT,
          MAX(EVENT_TS) AS LAST_DUO_LOGIN_AT,
          LISTAGG(DISTINCT NVL(APPLICATION_NAME, DESTINATION_NAME), '; ')
            WITHIN GROUP (ORDER BY NVL(APPLICATION_NAME, DESTINATION_NAME)) AS DUO_APPLICATIONS,
          LISTAGG(DISTINCT ACCESS_DEVICE_IP, '; ')
            WITHIN GROUP (ORDER BY ACCESS_DEVICE_IP) AS DUO_IPS,
          LISTAGG(DISTINCT TRIM(
            NVL(ACCESS_DEVICE_CITY, '') ||
            CASE WHEN ACCESS_DEVICE_STATE IS NOT NULL THEN ', ' || ACCESS_DEVICE_STATE ELSE '' END ||
            CASE WHEN ACCESS_DEVICE_COUNTRY IS NOT NULL THEN ', ' || ACCESS_DEVICE_COUNTRY ELSE '' END
          ), '; ') WITHIN GROUP (ORDER BY ACCESS_DEVICE_COUNTRY, ACCESS_DEVICE_STATE, ACCESS_DEVICE_CITY) AS DUO_LOCATIONS,
          MAX(CASE WHEN office.PUBLIC_IP IS NOT NULL THEN 1 ELSE 0 END) AS DUO_OFFICE_IP_MATCH,
          MAX(CASE WHEN UPPER(RESULT) = 'SUCCESS' THEN 1 ELSE 0 END) AS HAS_SUCCESSFUL_DUO_LOGIN
        FROM TL_DUO_AUTH_LOGS duo
        LEFT JOIN TL_OFFICE_IPS office
          ON office.PUBLIC_IP = duo.ACCESS_DEVICE_IP
         AND office.IS_ACTIVE = 1
        WHERE LOWER(NVL(EVENT_TYPE, 'authentication')) = 'authentication'
          AND UPPER(NVL(RESULT, '')) = 'SUCCESS'
          AND NVL(EMAIL, USERNAME) IS NOT NULL
        GROUP BY TRUNC(EVENT_TS), LOWER(NVL(EMAIL, USERNAME))
      ),
      activtrak_daily AS (
        SELECT
          TRUNC(RECORD_DATE) AS RECORD_DATE,
          LOWER(EMAIL) AS EMAIL,
          SUM(NVL(DURATION_SECONDS, 0)) AS ACTIVTRAK_IP_DURATION_SECONDS,
          SUM(NVL(EVENT_COUNT, 0)) AS ACTIVTRAK_IP_EVENT_COUNT,
          MIN(FIRST_ACTIVITY_AT) AS FIRST_IP_ACTIVITY_AT,
          MAX(LAST_ACTIVITY_AT) AS LAST_IP_ACTIVITY_AT,
          LISTAGG(DISTINCT PUBLIC_IP, '; ') WITHIN GROUP (ORDER BY PUBLIC_IP) AS ACTIVTRAK_IPS,
          MAX(NVL(IS_OFFICE_IP, 0)) AS ACTIVTRAK_OFFICE_IP_MATCH
        FROM TL_ACTIVTRAK_IP_ACTIVITY
        GROUP BY TRUNC(RECORD_DATE), LOWER(EMAIL)
      )
      SELECT
        COALESCE(d.RECORD_DATE, p.RECORD_DATE, a.RECORD_DATE) AS RECORD_DATE,
        COALESCE(d.EMAIL, p.EMAIL, a.EMAIL) AS EMAIL,
        NVL(e.DISPLAY_NAME, COALESCE(d.EMAIL, p.EMAIL, a.EMAIL)) AS DISPLAY_NAME,
        NVL(e.DEPARTMENT, 'Unknown') AS DEPARTMENT,
        NVL(e.LOCATION, 'Unknown') AS EMPLOYEE_OFFICE_LOCATION,
        NVL(d.DUO_LOGIN_COUNT, 0) AS DUO_LOGIN_COUNT,
        d.FIRST_DUO_LOGIN_AT,
        d.LAST_DUO_LOGIN_AT,
        d.DUO_APPLICATIONS,
        d.DUO_IPS,
        d.DUO_LOCATIONS,
        NVL(d.DUO_OFFICE_IP_MATCH, 0) AS DUO_OFFICE_IP_MATCH,
        CASE WHEN p.EMAIL IS NULL AND a.EMAIL IS NULL THEN 0 ELSE 1 END AS HAS_ACTIVTRAK_DAY,
        p.FIRST_ACTIVITY_AT AS ACTIVTRAK_FIRST_ACTIVITY_AT,
        p.LAST_ACTIVITY_AT AS ACTIVTRAK_LAST_ACTIVITY_AT,
        NVL(p.TOTAL_TIME, 0) AS ACTIVTRAK_TOTAL_SECONDS,
        p.LOCATION AS ACTIVTRAK_LOCATION,
        NVL(a.ACTIVTRAK_IP_DURATION_SECONDS, 0) AS ACTIVTRAK_IP_DURATION_SECONDS,
        NVL(a.ACTIVTRAK_IP_EVENT_COUNT, 0) AS ACTIVTRAK_IP_EVENT_COUNT,
        a.FIRST_IP_ACTIVITY_AT,
        a.LAST_IP_ACTIVITY_AT,
        a.ACTIVTRAK_IPS,
        NVL(a.ACTIVTRAK_OFFICE_IP_MATCH, 0) AS ACTIVTRAK_OFFICE_IP_MATCH,
        CASE
          WHEN NVL(d.DUO_LOGIN_COUNT, 0) > 0 AND (p.EMAIL IS NOT NULL OR a.EMAIL IS NOT NULL) THEN 'Matched'
          WHEN NVL(d.DUO_LOGIN_COUNT, 0) > 0 AND p.EMAIL IS NULL AND a.EMAIL IS NULL THEN 'Duo Only'
          WHEN NVL(d.DUO_LOGIN_COUNT, 0) = 0 AND (p.EMAIL IS NOT NULL OR a.EMAIL IS NOT NULL) THEN 'ActivTrak Only'
          ELSE 'No Evidence'
        END AS EVIDENCE_STATUS,
        CASE
          WHEN NVL(d.DUO_OFFICE_IP_MATCH, 0) = 1 OR NVL(a.ACTIVTRAK_OFFICE_IP_MATCH, 0) = 1 THEN 'Office Confirmed'
          WHEN p.EMAIL IS NOT NULL OR a.EMAIL IS NOT NULL OR NVL(d.DUO_LOGIN_COUNT, 0) > 0 THEN 'Remote/Unknown'
          ELSE 'No Evidence'
        END AS LOCATION_CONFIDENCE,
        CASE
          WHEN NVL(d.DUO_LOGIN_COUNT, 0) > 0 AND p.EMAIL IS NULL AND a.EMAIL IS NULL THEN 1
          WHEN NVL(d.DUO_OFFICE_IP_MATCH, 0) != NVL(a.ACTIVTRAK_OFFICE_IP_MATCH, 0)
            AND (NVL(d.DUO_LOGIN_COUNT, 0) > 0 OR p.EMAIL IS NOT NULL OR a.EMAIL IS NOT NULL) THEN 1
          ELSE 0
        END AS NEEDS_REVIEW
      FROM duo_daily d
      FULL OUTER JOIN TL_PRODUCTIVITY p
        ON TRUNC(p.RECORD_DATE) = d.RECORD_DATE
       AND LOWER(p.EMAIL) = d.EMAIL
      FULL OUTER JOIN activtrak_daily a
        ON a.RECORD_DATE = COALESCE(d.RECORD_DATE, TRUNC(p.RECORD_DATE))
       AND a.EMAIL = COALESCE(d.EMAIL, LOWER(p.EMAIL))
      LEFT JOIN TL_EMPLOYEES e
        ON LOWER(e.EMAIL) = COALESCE(d.EMAIL, LOWER(p.EMAIL), a.EMAIL)
    `);

    await safeExecuteDDL(conn, `
      CREATE OR REPLACE VIEW V_DUO_DEVICES_WITHOUT_ACTIVTRAK AS
      WITH identifier_emails AS (
        SELECT LOWER(IDENTIFIER_EMAIL) AS IDENTIFIER_EMAIL
        FROM TL_ACTIVTRAK_IDENTIFIERS
        GROUP BY LOWER(IDENTIFIER_EMAIL)
      )
      SELECT
        duo.EVENT_TS,
        TRUNC(duo.EVENT_TS) AS RECORD_DATE,
        LOWER(NVL(duo.EMAIL, duo.USERNAME)) AS EMAIL,
        NVL(e.DISPLAY_NAME, NVL(duo.EMAIL, duo.USERNAME)) AS DISPLAY_NAME,
        NVL(e.DEPARTMENT, 'Unknown') AS DEPARTMENT,
        duo.APPLICATION_NAME,
        duo.DESTINATION_NAME,
        duo.ACCESS_DEVICE_IP,
        duo.ACCESS_DEVICE_HOSTNAME,
        duo.ACCESS_DEVICE_OS,
        duo.ACCESS_DEVICE_OS_VERSION,
        duo.ACCESS_DEVICE_BROWSER,
        duo.ACCESS_DEVICE_BROWSER_VERSION,
        duo.ACCESS_DEVICE_CITY,
        duo.ACCESS_DEVICE_STATE,
        duo.ACCESS_DEVICE_COUNTRY,
        duo.TRUSTED_ENDPOINT_STATUS,
        CASE WHEN ids.IDENTIFIER_EMAIL IS NULL THEN 0 ELSE 1 END AS HAS_ACTIVTRAK_IDENTIFIER,
        CASE WHEN p.EMAIL IS NULL THEN 0 ELSE 1 END AS HAS_ACTIVTRAK_DAY,
        CASE WHEN ip.PUBLIC_IP IS NULL THEN 0 ELSE 1 END AS HAS_ACTIVTRAK_SAME_IP,
        stats.LAST_SEEN AS LAST_ACTIVTRAK_ACTIVITY,
        CASE
          WHEN ids.IDENTIFIER_EMAIL IS NULL THEN 'No ActivTrak identity'
          WHEN p.EMAIL IS NULL THEN 'No ActivTrak activity same day'
          WHEN ip.PUBLIC_IP IS NULL THEN 'Duo IP not seen in ActivTrak'
          ELSE 'Matched'
        END AS ISSUE_REASON
      FROM TL_DUO_AUTH_LOGS duo
      LEFT JOIN TL_EMPLOYEES e
        ON LOWER(e.EMAIL) = LOWER(NVL(duo.EMAIL, duo.USERNAME))
      LEFT JOIN identifier_emails ids
        ON ids.IDENTIFIER_EMAIL = LOWER(NVL(duo.EMAIL, duo.USERNAME))
      LEFT JOIN TL_PRODUCTIVITY p
        ON TRUNC(p.RECORD_DATE) = TRUNC(duo.EVENT_TS)
       AND LOWER(p.EMAIL) = LOWER(NVL(duo.EMAIL, duo.USERNAME))
      LEFT JOIN TL_ACTIVTRAK_IP_ACTIVITY ip
        ON TRUNC(ip.RECORD_DATE) = TRUNC(duo.EVENT_TS)
       AND LOWER(ip.EMAIL) = LOWER(NVL(duo.EMAIL, duo.USERNAME))
       AND ip.PUBLIC_IP = duo.ACCESS_DEVICE_IP
      LEFT JOIN (
        SELECT
          LOWER(ai.IDENTIFIER_EMAIL) AS IDENTIFIER_EMAIL,
          MAX(s.LAST_SEEN) AS LAST_SEEN
        FROM TL_ACTIVTRAK_IDENTIFIERS ai
        JOIN TL_ACTIVTRAK_USER_STATS s
          ON s.USER_ID = ai.USER_ID
        GROUP BY LOWER(ai.IDENTIFIER_EMAIL)
      ) stats
        ON stats.IDENTIFIER_EMAIL = LOWER(NVL(duo.EMAIL, duo.USERNAME))
      WHERE UPPER(NVL(duo.RESULT, '')) = 'SUCCESS'
        AND NVL(duo.EMAIL, duo.USERNAME) IS NOT NULL
        AND (
          ids.IDENTIFIER_EMAIL IS NULL
          OR p.EMAIL IS NULL
          OR ip.PUBLIC_IP IS NULL
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
    const allTabs = [
      'office-attendance',
      'timesheet-compare',
      'working-hours',
      'bamboo-not-in-activtrak',
      'activtrak-identities',
      'duo-activtrak-reconciliation',
      'raw-data',
    ];
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
    await conn.execute(`
      UPDATE TL_TAB_ROLES
       SET VISIBLE = 0
       WHERE ROLE_NAME NOT IN ('root-admin', 'hr-admin')
         AND TAB_KEY IN ('bamboo-not-in-activtrak', 'activtrak-identities', 'duo-activtrak-reconciliation', 'raw-data')
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

import oracledb from 'oracledb';

// Oracle connection configuration
const dbConfig = {
  user: process.env.ORACLE_USER || 'timelogs',
  password: process.env.ORACLE_PASSWORD || 'timelogs',
  connectString:
    process.env.ORACLE_CONNECTION_STRING || 'srv-db-100:1521/SUPPOPS'
};

// Connection pool configuration
const poolConfig = {
  ...dbConfig,
  poolMin: 2,
  poolMax: 10,
  poolIncrement: 1,
  poolTimeout: 60,
  queueTimeout: 60000,
  enableStatistics: true
};

// Global pool reference
let pool: oracledb.Pool | null = null;

/**
 * Initialize Oracle connection pool
 */
export async function initializePool(): Promise<oracledb.Pool> {
  if (pool) {
    return pool;
  }

  try {
    // Set Oracle client configuration
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    oracledb.autoCommit = true;
    oracledb.fetchAsString = [oracledb.CLOB];

    pool = await oracledb.createPool(poolConfig);
    console.log('Oracle connection pool created successfully');
    return pool;
  } catch (error) {
    console.error('Failed to create Oracle connection pool:', error);
    throw error;
  }
}

/**
 * Get a connection from the pool
 */
export async function getConnection(): Promise<oracledb.Connection> {
  if (!pool) {
    await initializePool();
  }

  try {
    const connection = await pool!.getConnection();
    return connection;
  } catch (error) {
    console.error('Failed to get Oracle connection:', error);
    throw error;
  }
}

/**
 * Execute a query with automatic connection management
 */
export async function executeQuery<T = Record<string, unknown>>(
  sql: string,
  binds: oracledb.BindParameters = {},
  options: oracledb.ExecuteOptions = {}
): Promise<oracledb.Result<T>> {
  let connection: oracledb.Connection | null = null;

  try {
    connection = await getConnection();
    const result = await connection.execute<T>(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      ...options
    });
    return result;
  } catch (error) {
    console.error('Query execution failed:', error);
    throw error;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('Error closing connection:', closeError);
      }
    }
  }
}

/**
 * Execute a query and return rows
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  binds: oracledb.BindParameters = {}
): Promise<T[]> {
  const result = await executeQuery<T>(sql, binds);
  return (result.rows as T[]) || [];
}

/**
 * Execute a query and return a single row
 */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  binds: oracledb.BindParameters = {}
): Promise<T | null> {
  const rows = await query<T>(sql, binds);
  return rows[0] || null;
}

/**
 * Execute an INSERT/UPDATE/DELETE and return affected rows count
 */
export async function execute(
  sql: string,
  binds: oracledb.BindParameters = {}
): Promise<number> {
  const result = await executeQuery(sql, binds);
  return result.rowsAffected || 0;
}

/**
 * Execute multiple statements in a transaction
 */
export async function executeTransaction<T>(
  callback: (connection: oracledb.Connection) => Promise<T>
): Promise<T> {
  let connection: oracledb.Connection | null = null;

  try {
    connection = await getConnection();
    // Disable autocommit for transaction
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    throw error;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('Error closing connection:', closeError);
      }
    }
  }
}

/**
 * Close the connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    try {
      await pool.close(10); // 10 second drain timeout
      pool = null;
      console.log('Oracle connection pool closed');
    } catch (error) {
      console.error('Error closing pool:', error);
      throw error;
    }
  }
}

/**
 * Get pool statistics
 */
export function getPoolStatistics(): oracledb.PoolStatistics | null {
  if (pool) {
    return pool.getStatistics();
  }
  return null;
}

/**
 * Health check for the database connection
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const result = await queryOne<{ RESULT: number }>(
      'SELECT 1 AS RESULT FROM DUAL'
    );
    return result?.RESULT === 1;
  } catch {
    return false;
  }
}

// Export oracledb types for use in other modules
export type { Connection, Pool, Result, BindParameters } from 'oracledb';

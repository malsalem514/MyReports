declare module 'oracledb' {
  namespace oracledb {
    const OUT_FORMAT_OBJECT: number;
    let outFormat: number;
    let autoCommit: boolean;
    const BIND_OUT: number;
    const NUMBER: number;

    function initOracleClient(options?: Record<string, unknown>): void;
    function createPool(config: Record<string, unknown>): Promise<Pool>;

    interface Pool {
      getConnection(): Promise<Connection>;
      close(drainTime?: number): Promise<void>;
    }

    interface Connection {
      execute<T = unknown>(sql: string, binds?: Record<string, unknown> | unknown[], options?: Record<string, unknown>): Promise<Result<T>>;
      executeMany(sql: string, binds: unknown[], options?: ExecuteManyOptions): Promise<Result<unknown>>;
      close(): Promise<void>;
    }

    interface Result<T> {
      rows?: T[];
      rowsAffected?: number;
      metaData?: Array<{ name: string }>;
      outBinds?: Record<string, unknown[]>;
    }

    interface ExecuteManyOptions {
      autoCommit?: boolean;
      bindDefs?: Record<string, unknown>;
      [key: string]: unknown;
    }
  }

  export default oracledb;
}

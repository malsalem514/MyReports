import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

// ============================================================================
// Configuration
// ============================================================================

const bigQueryConfig = {
  projectId: process.env.BIGQUERY_PROJECT_ID || 'us-activtrak-ac-prod',
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
};

const ACTIVTRAK_DATASET = process.env.BIGQUERY_DATASET || '672561';
const DAILY_USER_SUMMARY_TABLE = 'daily_user_summary';

// ============================================================================
// Zod Schemas for Type Safety
// ============================================================================

// Raw schema from BigQuery (ActivTrak actual field names)
const RawDailyUserSummarySchema = z.object({
  local_date: z.object({ value: z.string() }).transform((d) => new Date(d.value)),
  user_name: z.string(), // This is actually an email in ActivTrak
  user_id: z.number().optional(),
  productive_active_duration_seconds: z.number().nullable().default(0),
  productive_passive_duration_seconds: z.number().nullable().default(0),
  unproductive_active_duration_seconds: z.number().nullable().default(0),
  unproductive_passive_duration_seconds: z.number().nullable().default(0),
  undefined_active_duration_seconds: z.number().nullable().default(0),
  undefined_passive_duration_seconds: z.number().nullable().default(0),
  total_duration_seconds: z.number().nullable().default(0),
  active_duration_seconds: z.number().nullable().default(0),
  focused_duration_seconds: z.number().nullable().default(0),
  collaboration_duration_seconds: z.number().nullable().default(0),
  break_duration_seconds: z.number().nullable().default(0),
  utilization_level: z.string().nullable().optional()
});

// Transformed schema for our application
export const DailyUserSummarySchema = RawDailyUserSummarySchema.transform((raw) => {
  const productive_time = (raw.productive_active_duration_seconds || 0) + (raw.productive_passive_duration_seconds || 0);
  const unproductive_time = (raw.unproductive_active_duration_seconds || 0) + (raw.unproductive_passive_duration_seconds || 0);
  const neutral_time = (raw.undefined_active_duration_seconds || 0) + (raw.undefined_passive_duration_seconds || 0);
  const total_time = raw.total_duration_seconds || 0;

  return {
    date: raw.local_date,
    username: raw.user_name,
    email: raw.user_name, // user_name is the email in ActivTrak
    productive_time,
    unproductive_time,
    neutral_time,
    total_time,
    productivity_score: total_time > 0 ? Math.round((productive_time / total_time) * 100) : null,
    active_time: raw.active_duration_seconds || 0,
    idle_time: raw.break_duration_seconds || 0,
    offline_time: 0,
    focus_time: raw.focused_duration_seconds || 0,
    collaboration_time: raw.collaboration_duration_seconds || 0
  };
});

export type DailyUserSummary = z.infer<typeof DailyUserSummarySchema>;

export const DateRangeSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date()
});

export type DateRange = z.infer<typeof DateRangeSchema>;

// ============================================================================
// BigQuery Client
// ============================================================================

let bigQueryClient: BigQuery | null = null;

/**
 * Get or create BigQuery client instance
 */
export function getBigQueryClient(): BigQuery {
  if (!bigQueryClient) {
    bigQueryClient = new BigQuery(bigQueryConfig);
  }
  return bigQueryClient;
}

/**
 * Fetch productivity data for a date range
 */
export async function fetchProductivityData(
  startDate: Date,
  endDate: Date,
  emails?: string[]
): Promise<DailyUserSummary[]> {
  const client = getBigQueryClient();

  let query = `
    SELECT
      local_date,
      user_name,
      user_id,
      productive_active_duration_seconds,
      productive_passive_duration_seconds,
      unproductive_active_duration_seconds,
      unproductive_passive_duration_seconds,
      undefined_active_duration_seconds,
      undefined_passive_duration_seconds,
      total_duration_seconds,
      active_duration_seconds,
      focused_duration_seconds,
      collaboration_duration_seconds,
      break_duration_seconds,
      utilization_level
    FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.${DAILY_USER_SUMMARY_TABLE}\`
    WHERE local_date BETWEEN @startDate AND @endDate
  `;

  const params: Record<string, unknown> = {
    startDate: formatDateForBigQuery(startDate),
    endDate: formatDateForBigQuery(endDate)
  };

  if (emails && emails.length > 0) {
    query += ` AND LOWER(user_name) IN UNNEST(@emails)`;
    params.emails = emails.map((e) => e.toLowerCase());
  }

  query += ` ORDER BY local_date DESC, user_name`;

  try {
    const [rows] = await client.query({
      query,
      params,
      location: 'US'
    });

    // Validate and transform rows
    const validatedRows: DailyUserSummary[] = [];
    for (const row of rows) {
      try {
        const validated = DailyUserSummarySchema.parse(row);
        validatedRows.push(validated);
      } catch (error) {
        console.warn('Invalid row from BigQuery:', row, error);
      }
    }

    return validatedRows;
  } catch (error) {
    console.error('BigQuery query failed:', error);
    throw new BigQueryError('Failed to fetch productivity data', error);
  }
}

/**
 * Fetch productivity data for specific usernames (emails)
 */
export async function fetchProductivityByUsernames(
  usernames: string[],
  startDate: Date,
  endDate: Date
): Promise<DailyUserSummary[]> {
  if (usernames.length === 0) return [];

  const client = getBigQueryClient();

  const query = `
    SELECT
      local_date,
      user_name,
      user_id,
      productive_active_duration_seconds,
      productive_passive_duration_seconds,
      unproductive_active_duration_seconds,
      unproductive_passive_duration_seconds,
      undefined_active_duration_seconds,
      undefined_passive_duration_seconds,
      total_duration_seconds,
      active_duration_seconds,
      focused_duration_seconds,
      collaboration_duration_seconds,
      break_duration_seconds,
      utilization_level
    FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.${DAILY_USER_SUMMARY_TABLE}\`
    WHERE local_date BETWEEN @startDate AND @endDate
    AND LOWER(user_name) IN UNNEST(@usernames)
    ORDER BY local_date DESC, user_name
  `;

  try {
    const [rows] = await client.query({
      query,
      params: {
        startDate: formatDateForBigQuery(startDate),
        endDate: formatDateForBigQuery(endDate),
        usernames: usernames.map((u) => u.toLowerCase())
      },
      location: 'US'
    });

    return rows
      .map((row) => {
        try {
          return DailyUserSummarySchema.parse(row);
        } catch {
          return null;
        }
      })
      .filter((r): r is DailyUserSummary => r !== null);
  } catch (error) {
    console.error('BigQuery query failed:', error);
    throw new BigQueryError('Failed to fetch productivity by usernames', error);
  }
}

/**
 * Fetch aggregated productivity statistics
 */
export async function fetchProductivityStats(
  startDate: Date,
  endDate: Date,
  emails?: string[]
): Promise<{
  totalEmployees: number;
  avgProductivityScore: number;
  totalProductiveHours: number;
  totalTrackedHours: number;
}> {
  const client = getBigQueryClient();

  let query = `
    SELECT
      COUNT(DISTINCT user_name) as total_employees,
      ROUND(
        SAFE_DIVIDE(
          SUM(COALESCE(productive_active_duration_seconds, 0) + COALESCE(productive_passive_duration_seconds, 0)),
          SUM(COALESCE(total_duration_seconds, 0))
        ) * 100, 2
      ) as avg_productivity_score,
      ROUND(SUM(COALESCE(productive_active_duration_seconds, 0) + COALESCE(productive_passive_duration_seconds, 0)) / 3600, 2) as total_productive_hours,
      ROUND(SUM(COALESCE(total_duration_seconds, 0)) / 3600, 2) as total_tracked_hours
    FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.${DAILY_USER_SUMMARY_TABLE}\`
    WHERE local_date BETWEEN @startDate AND @endDate
  `;

  const params: Record<string, unknown> = {
    startDate: formatDateForBigQuery(startDate),
    endDate: formatDateForBigQuery(endDate)
  };

  if (emails && emails.length > 0) {
    query += ` AND LOWER(user_name) IN UNNEST(@emails)`;
    params.emails = emails.map((e) => e.toLowerCase());
  }

  try {
    const [rows] = await client.query({
      query,
      params,
      location: 'US'
    });

    const row = rows[0] || {};
    return {
      totalEmployees: Number(row.total_employees) || 0,
      avgProductivityScore: Number(row.avg_productivity_score) || 0,
      totalProductiveHours: Number(row.total_productive_hours) || 0,
      totalTrackedHours: Number(row.total_tracked_hours) || 0
    };
  } catch (error) {
    console.error('BigQuery stats query failed:', error);
    throw new BigQueryError('Failed to fetch productivity stats', error);
  }
}

/**
 * Fetch daily trend data
 */
export async function fetchProductivityTrend(
  startDate: Date,
  endDate: Date,
  emails?: string[]
): Promise<
  {
    date: Date;
    avgProductivityScore: number;
    totalProductiveHours: number;
    employeeCount: number;
  }[]
> {
  const client = getBigQueryClient();

  let query = `
    SELECT
      local_date,
      ROUND(
        SAFE_DIVIDE(
          SUM(COALESCE(productive_active_duration_seconds, 0) + COALESCE(productive_passive_duration_seconds, 0)),
          SUM(COALESCE(total_duration_seconds, 0))
        ) * 100, 2
      ) as avg_productivity_score,
      ROUND(SUM(COALESCE(productive_active_duration_seconds, 0) + COALESCE(productive_passive_duration_seconds, 0)) / 3600, 2) as total_productive_hours,
      COUNT(DISTINCT user_name) as employee_count
    FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.${DAILY_USER_SUMMARY_TABLE}\`
    WHERE local_date BETWEEN @startDate AND @endDate
  `;

  const params: Record<string, unknown> = {
    startDate: formatDateForBigQuery(startDate),
    endDate: formatDateForBigQuery(endDate)
  };

  if (emails && emails.length > 0) {
    query += ` AND LOWER(user_name) IN UNNEST(@emails)`;
    params.emails = emails.map((e) => e.toLowerCase());
  }

  query += ` GROUP BY local_date ORDER BY local_date`;

  try {
    const [rows] = await client.query({
      query,
      params,
      location: 'US'
    });

    return rows.map((row) => ({
      date: new Date(row.local_date.value || row.local_date),
      avgProductivityScore: Number(row.avg_productivity_score) || 0,
      totalProductiveHours: Number(row.total_productive_hours) || 0,
      employeeCount: Number(row.employee_count) || 0
    }));
  } catch (error) {
    console.error('BigQuery trend query failed:', error);
    throw new BigQueryError('Failed to fetch productivity trend', error);
  }
}

/**
 * Get distinct emails from ActivTrak data
 */
export async function fetchDistinctEmails(
  startDate: Date,
  endDate: Date
): Promise<string[]> {
  const client = getBigQueryClient();

  const query = `
    SELECT DISTINCT LOWER(user_name) as email
    FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.${DAILY_USER_SUMMARY_TABLE}\`
    WHERE local_date BETWEEN @startDate AND @endDate
    AND user_name IS NOT NULL
    ORDER BY email
  `;

  try {
    const [rows] = await client.query({
      query,
      params: {
        startDate: formatDateForBigQuery(startDate),
        endDate: formatDateForBigQuery(endDate)
      },
      location: 'US'
    });

    return rows.map((row) => row.email as string);
  } catch (error) {
    console.error('BigQuery distinct emails query failed:', error);
    throw new BigQueryError('Failed to fetch distinct emails', error);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatDateForBigQuery(date: Date): string {
  return date.toISOString().split('T')[0];
}

// ============================================================================
// Custom Error Class
// ============================================================================

export class BigQueryError extends Error {
  public readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'BigQueryError';
    this.cause = cause;
  }
}

// ============================================================================
// Health Check
// ============================================================================

export async function healthCheck(): Promise<boolean> {
  try {
    const client = getBigQueryClient();
    const [rows] = await client.query({
      query: 'SELECT 1 as result',
      location: 'US'
    });
    return rows[0]?.result === 1;
  } catch {
    return false;
  }
}

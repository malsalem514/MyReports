import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';
import { cachified } from './cache';

// ============================================================================
// Configuration
// ============================================================================

const bigQueryConfig = {
  projectId: process.env.BIGQUERY_PROJECT_ID || 'us-activtrak-ac-prod',
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
};

const ACTIVTRAK_DATASET = process.env.BIGQUERY_DATASET || '672561';
const DAILY_USER_SUMMARY_TABLE = 'daily_user_summary';

// ============================================================================
// Schemas
// ============================================================================

/** Parse "YYYY-MM-DD" as local midnight (not UTC) to avoid oracledb timezone shift */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

const RawDailyUserSummarySchema = z.object({
  local_date: z.object({ value: z.string() }).transform((d) => parseLocalDate(d.value)),
  user_name: z.string(),
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
  utilization_level: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  time_off_duration_seconds: z.number().nullable().default(0),
  time_off_type: z.string().nullable().optional(),
  first_activity_datetime: z
    .union([z.string(), z.object({ value: z.string() })])
    .nullable()
    .optional()
    .transform((value) => {
      if (!value) return null;
      return typeof value === 'string' ? value : value.value;
    }),
  last_activity_datetime: z
    .union([z.string(), z.object({ value: z.string() })])
    .nullable()
    .optional()
    .transform((value) => {
      if (!value) return null;
      return typeof value === 'string' ? value : value.value;
    }),
});

export const DailyUserSummarySchema = RawDailyUserSummarySchema.transform((raw) => {
  const productive_time = (raw.productive_active_duration_seconds || 0) + (raw.productive_passive_duration_seconds || 0);
  const unproductive_time = (raw.unproductive_active_duration_seconds || 0) + (raw.unproductive_passive_duration_seconds || 0);
  const neutral_time = (raw.undefined_active_duration_seconds || 0) + (raw.undefined_passive_duration_seconds || 0);
  const total_time = raw.total_duration_seconds || 0;

  return {
    date: raw.local_date,
    username: raw.user_name,
    email: raw.user_name,
    productive_active_time: raw.productive_active_duration_seconds || 0,
    productive_passive_time: raw.productive_passive_duration_seconds || 0,
    unproductive_active_time: raw.unproductive_active_duration_seconds || 0,
    unproductive_passive_time: raw.unproductive_passive_duration_seconds || 0,
    undefined_active_time: raw.undefined_active_duration_seconds || 0,
    undefined_passive_time: raw.undefined_passive_duration_seconds || 0,
    productive_time,
    unproductive_time,
    neutral_time,
    total_time,
    productivity_score: total_time > 0 ? Math.round((productive_time / total_time) * 100) : null,
    active_time: raw.active_duration_seconds || 0,
    idle_time: raw.break_duration_seconds || 0,
    offline_time: 0,
    focus_time: raw.focused_duration_seconds || 0,
    collaboration_time: raw.collaboration_duration_seconds || 0,
    utilization_level: raw.utilization_level || null,
    location: raw.location || null,
    time_off_time: raw.time_off_duration_seconds || 0,
    time_off_type: raw.time_off_type || null,
    first_activity_datetime: raw.first_activity_datetime,
    last_activity_datetime: raw.last_activity_datetime,
  };
});

export type DailyUserSummary = z.infer<typeof DailyUserSummarySchema>;

export interface ActivTrakIdentifierRecord {
  userId: number;
  identifierEmail: string;
}

export interface ActivTrakUserStatRecord {
  userId: number;
  userName: string | null;
  firstSeen: Date | null;
  lastSeen: Date | null;
  activityRowCount: number;
}

export interface OfficeIpActivityRecord {
  date: Date;
  email: string;
  displayName: string | null;
  publicIp: string;
  durationSeconds: number;
  eventCount: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
}

// ============================================================================
// Client
// ============================================================================

let bigQueryClient: BigQuery | null = null;

export function getBigQueryClient(): BigQuery {
  if (!bigQueryClient) {
    bigQueryClient = new BigQuery(bigQueryConfig);
  }
  return bigQueryClient;
}

// ============================================================================
// Productivity Data
// ============================================================================

async function _fetchProductivityDataUncached(
  startDateStr: string,
  endDateStr: string,
  emails?: string[],
): Promise<DailyUserSummary[]> {
  const client = getBigQueryClient();

  let sql = `
    WITH user_emails AS (
      SELECT userid, LOWER(email) as email,
        ROW_NUMBER() OVER (PARTITION BY userid ORDER BY email) as rn
      FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.user_identifiers\`
      WHERE email IS NOT NULL
    )
    SELECT DISTINCT d.local_date, d.user_name, d.user_id, ue.email as user_email,
      d.productive_active_duration_seconds, d.productive_passive_duration_seconds,
      d.unproductive_active_duration_seconds, d.unproductive_passive_duration_seconds,
      d.undefined_active_duration_seconds, d.undefined_passive_duration_seconds,
      d.total_duration_seconds, d.active_duration_seconds,
      d.focused_duration_seconds, d.collaboration_duration_seconds,
      d.break_duration_seconds, d.utilization_level,
      d.location, d.time_off_duration_seconds, d.time_off_type,
      d.first_activity_datetime, d.last_activity_datetime
    FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.${DAILY_USER_SUMMARY_TABLE}\` d
    LEFT JOIN user_emails ue ON d.user_id = ue.userid AND ue.rn = 1
    WHERE d.local_date BETWEEN @startDate AND @endDate
  `;

  const params: Record<string, unknown> = { startDate: startDateStr, endDate: endDateStr };

  if (emails && emails.length > 0) {
    sql += ` AND ue.email IN UNNEST(@emails)`;
    params.emails = emails.map((e) => e.toLowerCase());
  }

  sql += ` ORDER BY d.local_date DESC, ue.email`;

  const [rows] = await client.query({ query: sql, params, location: 'US' });

  const validated: DailyUserSummary[] = [];
  for (const row of rows) {
    try {
      validated.push(DailyUserSummarySchema.parse({ ...row, user_name: row.user_email || row.user_name }));
    } catch (error) {
      console.warn('Invalid row from BigQuery:', row, error);
    }
  }
  return validated;
}

export async function fetchProductivityData(
  startDate: Date,
  endDate: Date,
  emails?: string[],
): Promise<DailyUserSummary[]> {
  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);
  const emailsKey = emails ? emails.slice().sort().join(',') : 'all';

  try {
    return await cachified({
      key: `bigquery:productivity:${startDateStr}:${endDateStr}:${emailsKey}`,
      ttl: 1000 * 60 * 5,
      staleWhileRevalidate: 1000 * 60 * 15,
      getFreshValue: () => _fetchProductivityDataUncached(startDateStr, endDateStr, emails),
    });
  } catch (error) {
    console.error('BigQuery query failed:', error);
    throw new BigQueryError('Failed to fetch productivity data', error);
  }
}

export async function fetchProductivityStats(
  startDate: Date,
  endDate: Date,
  emails?: string[],
): Promise<{
  totalEmployees: number;
  avgProductivityScore: number;
  totalProductiveHours: number;
  totalTrackedHours: number;
}> {
  const client = getBigQueryClient();

  let sql = `
    SELECT
      COUNT(DISTINCT user_name) as total_employees,
      ROUND(SAFE_DIVIDE(
        SUM(COALESCE(productive_active_duration_seconds, 0) + COALESCE(productive_passive_duration_seconds, 0)),
        SUM(COALESCE(total_duration_seconds, 0))
      ) * 100, 2) as avg_productivity_score,
      ROUND(SUM(COALESCE(productive_active_duration_seconds, 0) + COALESCE(productive_passive_duration_seconds, 0)) / 3600, 2) as total_productive_hours,
      ROUND(SUM(COALESCE(total_duration_seconds, 0)) / 3600, 2) as total_tracked_hours
    FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.${DAILY_USER_SUMMARY_TABLE}\`
    WHERE local_date BETWEEN @startDate AND @endDate
  `;

  const params: Record<string, unknown> = { startDate: formatDate(startDate), endDate: formatDate(endDate) };

  if (emails && emails.length > 0) {
    sql += ` AND LOWER(user_name) IN UNNEST(@emails)`;
    params.emails = emails.map((e) => e.toLowerCase());
  }

  const [rows] = await client.query({ query: sql, params, location: 'US' });
  const row = rows[0] || {};
  return {
    totalEmployees: Number(row.total_employees) || 0,
    avgProductivityScore: Number(row.avg_productivity_score) || 0,
    totalProductiveHours: Number(row.total_productive_hours) || 0,
    totalTrackedHours: Number(row.total_tracked_hours) || 0,
  };
}

export async function fetchActivTrakIdentifiers(): Promise<ActivTrakIdentifierRecord[]> {
  const client = getBigQueryClient();
  const sql = `
    SELECT DISTINCT
      userid,
      LOWER(email) AS email
    FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.user_identifiers\`
    WHERE email IS NOT NULL
    ORDER BY userid, email
  `;

  const [rows] = await client.query({ query: sql, location: 'US' });
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    userId: Number(row.userid),
    identifierEmail: String(row.email || '').toLowerCase(),
  }));
}

export async function fetchActivTrakUserStats(daysBack: number = 365): Promise<ActivTrakUserStatRecord[]> {
  const client = getBigQueryClient();
  const sql = `
    SELECT
      user_id,
      ARRAY_AGG(user_name IGNORE NULLS ORDER BY last_seen DESC LIMIT 1)[OFFSET(0)] AS user_name,
      MIN(local_date) AS first_seen,
      MAX(local_date) AS last_seen,
      COUNT(*) AS row_count
    FROM (
      SELECT
        user_id,
        user_name,
        local_date,
        MAX(local_date) OVER (PARTITION BY user_id, user_name) AS last_seen
      FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.${DAILY_USER_SUMMARY_TABLE}\`
      WHERE local_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @daysBack DAY)
    )
    GROUP BY user_id
    ORDER BY user_id
  `;

  const [rows] = await client.query({
    query: sql,
    params: { daysBack },
    location: 'US',
  });

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    userId: Number(row.user_id),
    userName: row.user_name ? String(row.user_name) : null,
    firstSeen: row.first_seen ? parseLocalDate((row.first_seen as { value?: string }).value || String(row.first_seen)) : null,
    lastSeen: row.last_seen ? parseLocalDate((row.last_seen as { value?: string }).value || String(row.last_seen)) : null,
    activityRowCount: Number(row.row_count) || 0,
  }));
}

export async function fetchOfficeIpActivity(
  startDate: Date,
  endDate: Date,
  officeIps: string[],
  emails?: string[],
): Promise<OfficeIpActivityRecord[]> {
  if (officeIps.length === 0) return [];

  const client = getBigQueryClient();
  let sql = `
    WITH user_emails AS (
      SELECT userid, LOWER(email) AS email,
        ROW_NUMBER() OVER (PARTITION BY userid ORDER BY email) AS rn
      FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.user_identifiers\`
      WHERE email IS NOT NULL
    )
    SELECT
      e.local_date,
      ue.email,
      ARRAY_AGG(NULLIF(TRIM(e.user_name), '') IGNORE NULLS LIMIT 1)[OFFSET(0)] AS display_name,
      e.public_ip,
      SUM(COALESCE(e.duration_sec, 0)) AS duration_seconds,
      COUNT(*) AS event_count,
      MIN(e.local_datetime) AS first_activity_datetime,
      MAX(DATETIME_ADD(e.local_datetime, INTERVAL COALESCE(e.duration_sec, 0) SECOND)) AS last_activity_datetime
    FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.events\` e
    LEFT JOIN user_emails ue
      ON e.user_id = ue.userid
     AND ue.rn = 1
    WHERE e.local_date BETWEEN @startDate AND @endDate
      AND e.public_ip IN UNNEST(@officeIps)
      AND ue.email IS NOT NULL
  `;

  const params: Record<string, unknown> = {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    officeIps: officeIps.map((ip) => ip.trim()).filter(Boolean),
  };

  if (emails && emails.length > 0) {
    sql += ` AND ue.email IN UNNEST(@emails)`;
    params.emails = emails.map((email) => email.toLowerCase());
  }

  sql += `
    GROUP BY e.local_date, ue.email, e.public_ip
    ORDER BY e.local_date DESC, ue.email, e.public_ip
  `;

  const [rows] = await client.query({ query: sql, params, location: 'US' });
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    date: parseLocalDate((row.local_date as { value?: string })?.value || String(row.local_date)),
    email: String(row.email || '').toLowerCase(),
    displayName: row.display_name ? String(row.display_name) : null,
    publicIp: String(row.public_ip || ''),
    durationSeconds: Number(row.duration_seconds) || 0,
    eventCount: Number(row.event_count) || 0,
    firstActivityAt: normalizeBigQueryDateTime(row.first_activity_datetime),
    lastActivityAt: normalizeBigQueryDateTime(row.last_activity_datetime),
  }));
}

// ============================================================================
// Office Attendance
// ============================================================================

export interface OfficeAttendanceRecord {
  date: Date;
  email: string;
  displayName: string;
  location: 'Office' | 'Remote' | 'Unknown';
  totalHours: number;
  isPTO: boolean;
  ptoType: string | null;
  ptoHours: number;
}

async function _fetchOfficeAttendanceDataUncached(
  startDateStr: string,
  endDateStr: string,
  emails?: string[],
): Promise<OfficeAttendanceRecord[]> {
  const client = getBigQueryClient();

  let sql = `
    WITH user_emails AS (
      SELECT userid, LOWER(email) as email,
        ROW_NUMBER() OVER (PARTITION BY userid ORDER BY email) as rn
      FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.user_identifiers\`
      WHERE email IS NOT NULL
    )
    SELECT DISTINCT d.local_date, d.user_name, d.user_id, ue.email,
      COALESCE(d.location, 'Unknown') as location,
      ROUND(COALESCE(d.total_duration_seconds, 0) / 3600, 2) as total_hours,
      COALESCE(d.time_off_duration_seconds, 0) as time_off_seconds,
      d.time_off_type, d.time_off_day_count
    FROM \`${bigQueryConfig.projectId}.${ACTIVTRAK_DATASET}.${DAILY_USER_SUMMARY_TABLE}\` d
    LEFT JOIN user_emails ue ON d.user_id = ue.userid AND ue.rn = 1
    WHERE d.local_date BETWEEN @startDate AND @endDate
  `;

  const params: Record<string, unknown> = { startDate: startDateStr, endDate: endDateStr };

  if (emails && emails.length > 0) {
    sql += ` AND ue.email IN UNNEST(@emails)`;
    params.emails = emails.map((e) => e.toLowerCase());
  }

  sql += ` ORDER BY d.local_date DESC, ue.email`;

  const [rows] = await client.query({ query: sql, params, location: 'US' });

  return rows.map((row: Record<string, unknown>) => {
    const ptoHours = Number(row.time_off_seconds || 0) / 3600;
    const isPTO = ptoHours > 0 || ((row.time_off_day_count as number) > 0);
    return {
      date: parseLocalDate((row.local_date as { value: string })?.value || (row.local_date as string)),
      email: ((row.email as string) || '').toLowerCase(),
      displayName: (row.user_name as string) || '',
      location: normalizeLocation(row.location as string),
      totalHours: Number(row.total_hours) || 0,
      isPTO,
      ptoType: (row.time_off_type as string) || null,
      ptoHours,
    };
  });
}

export async function fetchOfficeAttendanceData(
  startDate: Date,
  endDate: Date,
  emails?: string[],
): Promise<OfficeAttendanceRecord[]> {
  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);
  const emailsKey = emails ? emails.slice().sort().join(',') : 'all';

  try {
    return await cachified({
      key: `bigquery:attendance:${startDateStr}:${endDateStr}:${emailsKey}`,
      ttl: 1000 * 60 * 5,
      staleWhileRevalidate: 1000 * 60 * 15,
      getFreshValue: () => _fetchOfficeAttendanceDataUncached(startDateStr, endDateStr, emails),
    });
  } catch (error) {
    console.error('BigQuery attendance query failed:', error);
    throw new BigQueryError('Failed to fetch office attendance data', error);
  }
}

// ============================================================================
// Utilities
// ============================================================================

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeBigQueryDateTime(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.replace('T', ' ');
  if (typeof value === 'object' && value !== null && 'value' in value) {
    const raw = (value as { value?: unknown }).value;
    return raw ? String(raw).replace('T', ' ') : null;
  }
  return String(value).replace('T', ' ');
}

function normalizeLocation(location: string | null): 'Office' | 'Remote' | 'Unknown' {
  if (!location) return 'Unknown';
  const n = location.toLowerCase().trim();
  // Office wins: any presence in the office makes it an office day
  if (n.includes('office') || n === 'on-site' || n === 'onsite') return 'Office';
  if (n.includes('remote') || n === 'home' || n === 'wfh') return 'Remote';
  return 'Unknown';
}

export class BigQueryError extends Error {
  public readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'BigQueryError';
    this.cause = cause;
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    const client = getBigQueryClient();
    const [rows] = await client.query({ query: 'SELECT 1 as result', location: 'US' });
    return rows[0]?.result === 1;
  } catch {
    return false;
  }
}

'use server';
import { getAccessContext } from '@/lib/access';
import { query } from '@/lib/oracle';
import { fetchOfficeAttendanceData } from '@/lib/bigquery';

export interface SourceBreakdown {
  totalRecords: number;
  uniqueEmployees: number;
  officeDays: number;
  remoteDays: number;
  unknownDays: number;
}

export interface EmployeeDiscrepancy {
  email: string;
  name: string;
  department: string;
  inBamboo: boolean;
  activtrak: { office: number; remote: number; unknown: number; total: number };
  oracle: { office: number; remote: number; unknown: number; total: number };
  diff: number;
  locationMismatch: boolean;
  totalMismatch: boolean;
}

export interface ValidationResult {
  rangeStart: string;
  rangeEnd: string;
  activtrak: SourceBreakdown;
  oracle: SourceBreakdown;
  bamboo: { activeEmployees: number; withPTO: number };
  discrepancies: EmployeeDiscrepancy[];
  activtrakOnlyEmails: string[];
  oracleOnlyEmails: string[];
  notInBamboo: string[];
  ghostEmployees: string[];
}

export async function validateAttendanceData(
  startDateParam: string,
  endDateParam: string,
): Promise<ValidationResult> {
  const access = await getAccessContext();
  if (!access.isHRAdmin) throw new Error('HR Admin access required');

  const startDate = new Date(`${startDateParam}T00:00:00`);
  const endDate = new Date(`${endDateParam}T23:59:59.999`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Invalid validation date range');
  }
  const rangeStart = startDateParam;
  const rangeEnd = endDateParam;

  // --- Oracle: aggregated attendance per employee (deduped, Office wins) ---
  const oracleSQL = `
    SELECT EMAIL,
      COUNT(*) AS TOTAL_RECORDS,
      SUM(CASE WHEN LOCATION = 'Office' THEN 1 ELSE 0 END) AS OFFICE_DAYS,
      SUM(CASE WHEN LOCATION = 'Remote' THEN 1 ELSE 0 END) AS REMOTE_DAYS,
      SUM(CASE WHEN LOCATION NOT IN ('Office','Remote') OR LOCATION IS NULL THEN 1 ELSE 0 END) AS UNKNOWN_DAYS
    FROM (
      SELECT t.*,
        ROW_NUMBER() OVER (
          PARTITION BY EMAIL, TRUNC(RECORD_DATE)
          ORDER BY DECODE(LOCATION, 'Office', 1, 'Remote', 2, 3)
        ) AS rn
      FROM TL_ATTENDANCE t
      WHERE RECORD_DATE BETWEEN :startDate AND :endDate
    ) WHERE rn = 1
    GROUP BY EMAIL
  `;

  // --- Oracle: BambooHR employee count + names/dept ---
  const bambooSQL = `
    SELECT LOWER(EMAIL) AS EMAIL, NVL(DISPLAY_NAME, EMAIL) AS DISPLAY_NAME,
      NVL(DEPARTMENT, 'Unknown') AS DEPARTMENT
    FROM TL_EMPLOYEES WHERE EMAIL IS NOT NULL AND (STATUS IS NULL OR UPPER(STATUS) != 'INACTIVE')
  `;

  // --- Oracle: PTO employee count ---
  const ptoSQL = `
    SELECT COUNT(DISTINCT EMAIL) AS PTO_COUNT
    FROM TL_TIME_OFF
    WHERE START_DATE <= :endDate AND END_DATE >= :startDate
  `;

  // Fetch all 4 sources in parallel
  const [sourceRecords, oracleRows, bambooRows, ptoRows] = await Promise.all([
    fetchOfficeAttendanceData(startDate, endDate),
    query<{
      EMAIL: string; TOTAL_RECORDS: number; OFFICE_DAYS: number;
      REMOTE_DAYS: number; UNKNOWN_DAYS: number;
    }>(oracleSQL, { startDate, endDate }),
    query<{ EMAIL: string; DISPLAY_NAME: string; DEPARTMENT: string }>(bambooSQL, {}),
    query<{ PTO_COUNT: number }>(ptoSQL, { startDate, endDate }),
  ]);

  // --- BambooHR lookup ---
  const bambooEmails = new Set<string>();
  const nameMap = new Map<string, string>();
  const deptMap = new Map<string, string>();
  for (const r of bambooRows) {
    const email = r.EMAIL?.toLowerCase();
    if (!email) continue;
    bambooEmails.add(email);
    nameMap.set(email, r.DISPLAY_NAME || email);
    deptMap.set(email, r.DEPARTMENT || 'Unknown');
  }

  // --- Oracle: index by email ---
  const oracleByEmail = new Map<string, { office: number; remote: number; unknown: number; total: number }>();
  let orTotalRecords = 0, orOffice = 0, orRemote = 0, orUnknown = 0;
  for (const r of oracleRows) {
    const email = r.EMAIL?.toLowerCase();
    if (!email) continue;
    const office = r.OFFICE_DAYS || 0;
    const remote = r.REMOTE_DAYS || 0;
    const unknown = r.UNKNOWN_DAYS || 0;
    const total = r.TOTAL_RECORDS || 0;
    oracleByEmail.set(email, { office, remote, unknown, total });
    orTotalRecords += total;
    orOffice += office;
    orRemote += remote;
    orUnknown += unknown;
  }

  // --- ActivTrak: deduplicate and aggregate per employee (source has no dedup) ---
  const activtrakByEmail = new Map<string, { office: number; remote: number; unknown: number; total: number }>();
  const activtrakSeen = new Set<string>();
  let atOffice = 0, atRemote = 0, atUnknown = 0;
  for (const rec of sourceRecords) {
    if (!rec.email) continue;
    const email = rec.email.toLowerCase();
    const d = rec.date instanceof Date ? rec.date : new Date(rec.date);
    const key = `${email}|${d.toISOString().split('T')[0]}`;
    if (activtrakSeen.has(key)) continue;
    activtrakSeen.add(key);

    if (!activtrakByEmail.has(email)) activtrakByEmail.set(email, { office: 0, remote: 0, unknown: 0, total: 0 });
    const entry = activtrakByEmail.get(email)!;
    entry.total++;
    if (rec.location === 'Office') { entry.office++; atOffice++; }
    else if (rec.location === 'Remote') { entry.remote++; atRemote++; }
    else { entry.unknown++; atUnknown++; }

    if (!nameMap.has(email) && rec.displayName) nameMap.set(email, rec.displayName);
  }

  // --- Compare ---
  const allEmails = new Set([...activtrakByEmail.keys(), ...oracleByEmail.keys()]);
  const discrepancies: EmployeeDiscrepancy[] = [];
  const activtrakOnlyEmails: string[] = [];
  const oracleOnlyEmails: string[] = [];
  const notInBamboo: string[] = [];

  for (const email of allEmails) {
    const at = activtrakByEmail.get(email) || { office: 0, remote: 0, unknown: 0, total: 0 };
    const or = oracleByEmail.get(email) || { office: 0, remote: 0, unknown: 0, total: 0 };
    const inBamboo = bambooEmails.has(email);

    if (!inBamboo) notInBamboo.push(email);
    if (at.total > 0 && or.total === 0) activtrakOnlyEmails.push(email);
    else if (or.total > 0 && at.total === 0) oracleOnlyEmails.push(email);

    const diff = or.total - at.total;
    const locationMismatch =
      at.office !== or.office ||
      at.remote !== or.remote ||
      at.unknown !== or.unknown;
    const totalMismatch = at.total !== or.total;

    if (totalMismatch || locationMismatch) {
      discrepancies.push({
        email,
        name: nameMap.get(email) || email,
        department: deptMap.get(email) || 'Unknown',
        inBamboo,
        activtrak: at,
        oracle: or,
        diff,
        locationMismatch,
        totalMismatch,
      });
    }
  }

  discrepancies.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // Ghost employees: in BambooHR but zero records in both sources
  const ghostEmployees: string[] = [];
  for (const email of bambooEmails) {
    if (!activtrakByEmail.has(email) && !oracleByEmail.has(email)) {
      ghostEmployees.push(email);
    }
  }

  return {
    rangeStart,
    rangeEnd,
    activtrak: {
      totalRecords: activtrakSeen.size,
      uniqueEmployees: activtrakByEmail.size,
      officeDays: atOffice,
      remoteDays: atRemote,
      unknownDays: atUnknown,
    },
    oracle: {
      totalRecords: orTotalRecords,
      uniqueEmployees: oracleByEmail.size,
      officeDays: orOffice,
      remoteDays: orRemote,
      unknownDays: orUnknown,
    },
    bamboo: {
      activeEmployees: bambooEmails.size,
      withPTO: ptoRows[0]?.PTO_COUNT || 0,
    },
    discrepancies: discrepancies.slice(0, 50),
    activtrakOnlyEmails: activtrakOnlyEmails.slice(0, 20),
    oracleOnlyEmails: oracleOnlyEmails.slice(0, 20),
    notInBamboo: notInBamboo.slice(0, 20),
    ghostEmployees: ghostEmployees.slice(0, 20),
  };
}

/**
 * Data validation script: compares BigQuery (ActivTrak source) vs Oracle (synced)
 * and verifies the week-mapping / compliance logic.
 *
 * Usage: source .env && npx tsx scripts/validate-data.ts
 */

import { getBigQueryClient } from '../lib/bigquery';
import { query } from '../lib/oracle';

const BQ_PROJECT = process.env.BIGQUERY_PROJECT_ID || 'us-activtrak-ac-prod';
const BQ_DATASET = process.env.BIGQUERY_DATASET || '672561';

// --- helpers ---
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function isoMonday(d: Date): string {
  const copy = new Date(d);
  const dow = copy.getDay(); // 0=Sun
  const offset = dow === 0 ? -6 : 1 - dow;
  copy.setDate(copy.getDate() + offset);
  return fmt(copy);
}

async function main() {
  // Date range: 6 weeks back (matches default dashboard view)
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6 * 7);
  startDate.setHours(0, 0, 0, 0);
  const startStr = fmt(startDate);
  const endStr = fmt(endDate);

  console.log(`\n=== DATA VALIDATION: ${startStr} to ${endStr} ===\n`);

  // ====================================================================
  // 1. RAW RECORD COUNTS
  // ====================================================================
  console.log('--- 1. RAW RECORD COUNTS ---');

  const bq = getBigQueryClient();

  // BigQuery total records (all rows, including weekends)
  const [bqTotal] = await bq.query({
    query: `
      SELECT COUNT(*) as cnt,
             COUNT(DISTINCT CONCAT(CAST(d.local_date AS STRING), '|', LOWER(COALESCE(ue.email, d.user_name)))) as unique_day_emp,
             COUNT(DISTINCT LOWER(COALESCE(ue.email, d.user_name))) as unique_emps,
             MIN(d.local_date) as min_date,
             MAX(d.local_date) as max_date
      FROM \`${BQ_PROJECT}.${BQ_DATASET}.daily_user_summary\` d
      LEFT JOIN (
        SELECT userid, LOWER(email) as email,
          ROW_NUMBER() OVER (PARTITION BY userid ORDER BY email) as rn
        FROM \`${BQ_PROJECT}.${BQ_DATASET}.user_identifiers\`
        WHERE email IS NOT NULL
      ) ue ON d.user_id = ue.userid AND ue.rn = 1
      WHERE d.local_date BETWEEN @sd AND @ed
    `,
    params: { sd: startStr, ed: endStr },
    location: 'US',
  });
  const bqRow = bqTotal[0];
  console.log(`BigQuery: ${bqRow.cnt} raw rows, ${bqRow.unique_day_emp} unique (date|email) pairs, ${bqRow.unique_emps} unique employees`);
  console.log(`  Date range: ${bqRow.min_date?.value || bqRow.min_date} → ${bqRow.max_date?.value || bqRow.max_date}`);

  // BigQuery weekday-only records
  const [bqWeekdays] = await bq.query({
    query: `
      SELECT COUNT(*) as cnt,
             COUNT(DISTINCT CONCAT(CAST(d.local_date AS STRING), '|', LOWER(COALESCE(ue.email, d.user_name)))) as unique_day_emp
      FROM \`${BQ_PROJECT}.${BQ_DATASET}.daily_user_summary\` d
      LEFT JOIN (
        SELECT userid, LOWER(email) as email,
          ROW_NUMBER() OVER (PARTITION BY userid ORDER BY email) as rn
        FROM \`${BQ_PROJECT}.${BQ_DATASET}.user_identifiers\`
        WHERE email IS NOT NULL
      ) ue ON d.user_id = ue.userid AND ue.rn = 1
      WHERE d.local_date BETWEEN @sd AND @ed
        AND EXTRACT(DAYOFWEEK FROM d.local_date) NOT IN (1, 7)
    `,
    params: { sd: startStr, ed: endStr },
    location: 'US',
  });
  console.log(`BigQuery (weekdays only): ${bqWeekdays[0].cnt} rows, ${bqWeekdays[0].unique_day_emp} unique (date|email) pairs`);

  // BigQuery location breakdown
  const [bqLocations] = await bq.query({
    query: `
      SELECT COALESCE(d.location, 'NULL') as location, COUNT(*) as cnt
      FROM \`${BQ_PROJECT}.${BQ_DATASET}.daily_user_summary\` d
      WHERE d.local_date BETWEEN @sd AND @ed
        AND EXTRACT(DAYOFWEEK FROM d.local_date) NOT IN (1, 7)
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    params: { sd: startStr, ed: endStr },
    location: 'US',
  });
  console.log(`  Location breakdown (weekdays):`);
  for (const r of bqLocations) {
    console.log(`    ${r.location}: ${r.cnt}`);
  }

  // Oracle total records
  const oraTotal = await query<{ CNT: number; UNIQUE_DAY_EMP: number; UNIQUE_EMPS: number; MIN_DATE: Date; MAX_DATE: Date }>(`
    SELECT COUNT(*) AS CNT,
           COUNT(DISTINCT RECORD_DATE || '|' || LOWER(EMAIL)) AS UNIQUE_DAY_EMP,
           COUNT(DISTINCT LOWER(EMAIL)) AS UNIQUE_EMPS,
           MIN(RECORD_DATE) AS MIN_DATE,
           MAX(RECORD_DATE) AS MAX_DATE
    FROM TL_ATTENDANCE
    WHERE RECORD_DATE BETWEEN :sd AND :ed
  `, { sd: startDate, ed: endDate });
  const oraRow = oraTotal[0]!;
  console.log(`\nOracle:   ${oraRow.CNT} raw rows, ${oraRow.UNIQUE_DAY_EMP} unique (date|email) pairs, ${oraRow.UNIQUE_EMPS} unique employees`);
  console.log(`  Date range: ${oraRow.MIN_DATE ? fmt(oraRow.MIN_DATE) : 'null'} → ${oraRow.MAX_DATE ? fmt(oraRow.MAX_DATE) : 'null'}`);

  // Oracle weekday-only
  const oraWeekdays = await query<{ CNT: number; UNIQUE_DAY_EMP: number }>(`
    SELECT COUNT(*) AS CNT,
           COUNT(DISTINCT TRUNC(RECORD_DATE) || '|' || LOWER(EMAIL)) AS UNIQUE_DAY_EMP
    FROM TL_ATTENDANCE
    WHERE RECORD_DATE BETWEEN :sd AND :ed
      AND TO_CHAR(RECORD_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')
  `, { sd: startDate, ed: endDate });
  console.log(`Oracle (weekdays only): ${oraWeekdays[0]!.CNT} rows, ${oraWeekdays[0]!.UNIQUE_DAY_EMP} unique (date|email) pairs`);

  // Oracle location breakdown
  const oraLocations = await query<{ LOCATION: string; CNT: number }>(`
    SELECT NVL(LOCATION, 'NULL') AS LOCATION, COUNT(*) AS CNT
    FROM TL_ATTENDANCE
    WHERE RECORD_DATE BETWEEN :sd AND :ed
      AND TO_CHAR(RECORD_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')
    GROUP BY NVL(LOCATION, 'NULL')
    ORDER BY CNT DESC
  `, { sd: startDate, ed: endDate });
  console.log(`  Location breakdown (weekdays):`);
  for (const r of oraLocations) {
    console.log(`    ${r.LOCATION}: ${r.CNT}`);
  }

  // Diff
  const bqCount = Number(bqWeekdays[0].unique_day_emp);
  const oraCount = oraWeekdays[0]!.UNIQUE_DAY_EMP;
  const diff = oraCount - bqCount;
  console.log(`\n  DIFF (Oracle - BigQuery weekday unique pairs): ${diff > 0 ? '+' : ''}${diff}`);
  if (diff !== 0) {
    console.log(`  ⚠  MISMATCH — investigating...`);
  } else {
    console.log(`  ✓  Counts match`);
  }

  // ====================================================================
  // 2. PER-DATE COMPARISON
  // ====================================================================
  console.log('\n--- 2. PER-DATE RECORD COUNTS ---');

  const [bqByDate] = await bq.query({
    query: `
      SELECT CAST(d.local_date AS STRING) as dt,
             COUNT(DISTINCT LOWER(COALESCE(ue.email, d.user_name))) as emps,
             FORMAT_DATE('%A', d.local_date) as day_name
      FROM \`${BQ_PROJECT}.${BQ_DATASET}.daily_user_summary\` d
      LEFT JOIN (
        SELECT userid, LOWER(email) as email,
          ROW_NUMBER() OVER (PARTITION BY userid ORDER BY email) as rn
        FROM \`${BQ_PROJECT}.${BQ_DATASET}.user_identifiers\`
        WHERE email IS NOT NULL
      ) ue ON d.user_id = ue.userid AND ue.rn = 1
      WHERE d.local_date BETWEEN @sd AND @ed
      GROUP BY 1, 3
      ORDER BY 1
    `,
    params: { sd: startStr, ed: endStr },
    location: 'US',
  });

  const oraByDate = await query<{ DT: string; EMPS: number; DAY_NAME: string }>(`
    SELECT TO_CHAR(RECORD_DATE, 'YYYY-MM-DD') AS DT,
           COUNT(DISTINCT LOWER(EMAIL)) AS EMPS,
           TO_CHAR(RECORD_DATE, 'Day', 'NLS_DATE_LANGUAGE=ENGLISH') AS DAY_NAME
    FROM TL_ATTENDANCE
    WHERE RECORD_DATE BETWEEN :sd AND :ed
    GROUP BY TO_CHAR(RECORD_DATE, 'YYYY-MM-DD'), TO_CHAR(RECORD_DATE, 'Day', 'NLS_DATE_LANGUAGE=ENGLISH')
    ORDER BY 1
  `, { sd: startDate, ed: endDate });

  const bqDateMap = new Map<string, number>();
  for (const r of bqByDate) {
    bqDateMap.set(r.dt, Number(r.emps));
  }
  const oraDateMap = new Map<string, number>();
  for (const r of oraByDate) {
    oraDateMap.set(r.DT, r.EMPS);
  }

  const allDates = new Set([...bqDateMap.keys(), ...oraDateMap.keys()]);
  const sortedDates = [...allDates].sort();
  let dateIssues = 0;
  for (const dt of sortedDates) {
    const bqN = bqDateMap.get(dt) || 0;
    const oraN = oraDateMap.get(dt) || 0;
    const dayLabel = new Date(dt + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
    const marker = bqN !== oraN ? ' ⚠' : '';
    if (bqN !== oraN) dateIssues++;
    console.log(`  ${dt} (${dayLabel}):  BQ=${bqN}  Oracle=${oraN}  diff=${oraN - bqN}${marker}`);
  }
  console.log(dateIssues === 0 ? '  ✓  All dates match' : `  ⚠  ${dateIssues} date(s) with mismatches`);

  // ====================================================================
  // 3. WEEK MAPPING VERIFICATION
  // ====================================================================
  console.log('\n--- 3. WEEK MAPPING (ISO Monday start) ---');

  // Oracle view weeks
  const oraViewWeeks = await query<{ WEEK_START: Date; EMP_COUNT: number; TOTAL_OFFICE: number; TOTAL_REMOTE: number }>(`
    SELECT WEEK_START, COUNT(DISTINCT EMAIL) AS EMP_COUNT,
           SUM(OFFICE_DAYS) AS TOTAL_OFFICE, SUM(REMOTE_DAYS) AS TOTAL_REMOTE
    FROM V_ATTENDANCE_WEEKLY
    WHERE WEEK_START BETWEEN TRUNC(:sd, 'IW') AND TRUNC(:ed, 'IW')
    GROUP BY WEEK_START
    ORDER BY WEEK_START
  `, { sd: startDate, ed: endDate });

  console.log('  Oracle V_ATTENDANCE_WEEKLY:');
  for (const r of oraViewWeeks) {
    const ws = fmt(r.WEEK_START);
    console.log(`    Week ${ws}: ${r.EMP_COUNT} employees, ${r.TOTAL_OFFICE} office days, ${r.TOTAL_REMOTE} remote days`);
  }

  // Verify week mapping by computing manually from raw Oracle attendance
  console.log('\n  Manual week computation from TL_ATTENDANCE (weekdays, deduped):');
  const oraManualWeeks = await query<{ WEEK_START: string; EMP_COUNT: number; OFFICE_DAYS: number; REMOTE_DAYS: number }>(`
    SELECT TO_CHAR(TRUNC(RECORD_DATE, 'IW'), 'YYYY-MM-DD') AS WEEK_START,
           COUNT(DISTINCT EMAIL) AS EMP_COUNT,
           SUM(CASE WHEN LOCATION = 'Office' THEN 1 ELSE 0 END) AS OFFICE_DAYS,
           SUM(CASE WHEN LOCATION = 'Remote' THEN 1 ELSE 0 END) AS REMOTE_DAYS
    FROM (
      SELECT EMAIL, RECORD_DATE, LOCATION,
        ROW_NUMBER() OVER (
          PARTITION BY LOWER(EMAIL), TRUNC(RECORD_DATE)
          ORDER BY DECODE(LOCATION, 'Office', 1, 'Remote', 2, 3)
        ) AS rn
      FROM TL_ATTENDANCE
      WHERE RECORD_DATE BETWEEN :sd AND :ed
        AND TO_CHAR(RECORD_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')
    )
    WHERE rn = 1
    GROUP BY TO_CHAR(TRUNC(RECORD_DATE, 'IW'), 'YYYY-MM-DD')
    ORDER BY 1
  `, { sd: startDate, ed: endDate });

  for (const r of oraManualWeeks) {
    console.log(`    Week ${r.WEEK_START}: ${r.EMP_COUNT} employees, ${r.OFFICE_DAYS} office days, ${r.REMOTE_DAYS} remote days`);
  }

  // Cross-check view vs manual
  const viewWeekMap = new Map<string, { emp: number; office: number; remote: number }>();
  for (const r of oraViewWeeks) {
    viewWeekMap.set(fmt(r.WEEK_START), { emp: r.EMP_COUNT, office: r.TOTAL_OFFICE, remote: r.TOTAL_REMOTE });
  }
  let weekIssues = 0;
  for (const r of oraManualWeeks) {
    const v = viewWeekMap.get(r.WEEK_START);
    if (!v || v.office !== r.OFFICE_DAYS || v.remote !== r.REMOTE_DAYS) {
      console.log(`  ⚠  Week ${r.WEEK_START} VIEW vs MANUAL mismatch!`);
      console.log(`      VIEW:   office=${v?.office} remote=${v?.remote}`);
      console.log(`      MANUAL: office=${r.OFFICE_DAYS} remote=${r.REMOTE_DAYS}`);
      weekIssues++;
    }
  }
  console.log(weekIssues === 0 ? '\n  ✓  View matches manual computation' : `\n  ⚠  ${weekIssues} week(s) with view/manual mismatch`);

  // ====================================================================
  // 4. JS WEEK LOGIC VS ORACLE WEEK LOGIC
  // ====================================================================
  console.log('\n--- 4. JS isoMonday() vs Oracle TRUNC(date, \'IW\') ---');

  // Grab some sample dates from Oracle and compare
  const sampleDates = await query<{ DT: Date; ORA_WEEK: Date }>(`
    SELECT DISTINCT RECORD_DATE AS DT, TRUNC(RECORD_DATE, 'IW') AS ORA_WEEK
    FROM TL_ATTENDANCE
    WHERE RECORD_DATE BETWEEN :sd AND :ed
    ORDER BY 1
    FETCH FIRST 50 ROWS ONLY
  `, { sd: startDate, ed: endDate });

  let jsOracleIssues = 0;
  for (const r of sampleDates) {
    const dt = r.DT instanceof Date ? r.DT : new Date(r.DT);
    const oraWeek = r.ORA_WEEK instanceof Date ? fmt(r.ORA_WEEK) : String(r.ORA_WEEK).slice(0, 10);
    const jsWeek = isoMonday(dt);
    if (jsWeek !== oraWeek) {
      console.log(`  ⚠  ${fmt(dt)}: JS=${jsWeek} Oracle=${oraWeek}`);
      jsOracleIssues++;
    }
  }
  console.log(jsOracleIssues === 0
    ? `  ✓  All ${sampleDates.length} sample dates: JS isoMonday matches Oracle TRUNC(IW)`
    : `  ⚠  ${jsOracleIssues}/${sampleDates.length} dates have JS/Oracle week mismatch`
  );

  // ====================================================================
  // 5. CURRENT WEEK DETECTION
  // ====================================================================
  console.log('\n--- 5. CURRENT WEEK DETECTION ---');
  const now = new Date();
  const currentWeek = isoMonday(now);
  const todayDow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
  console.log(`  Today: ${fmt(now)} (${todayDow})`);
  console.log(`  Current week Monday: ${currentWeek}`);
  console.log(`  Is current week in range: ${sortedDates.some(d => isoMonday(new Date(d + 'T12:00:00')) === currentWeek)}`);

  // How many records exist for the current week?
  const oraCurrentWeek = await query<{ CNT: number; EMPS: number }>(`
    SELECT COUNT(*) AS CNT, COUNT(DISTINCT LOWER(EMAIL)) AS EMPS
    FROM TL_ATTENDANCE
    WHERE TRUNC(RECORD_DATE, 'IW') = TO_DATE(:cw, 'YYYY-MM-DD')
      AND TO_CHAR(RECORD_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')
  `, { cw: currentWeek });
  console.log(`  Current week in Oracle: ${oraCurrentWeek[0]!.CNT} records, ${oraCurrentWeek[0]!.EMPS} employees`);

  // ====================================================================
  // 6. PTO DATA CHECK
  // ====================================================================
  console.log('\n--- 6. PTO DATA ---');

  const ptoCounts = await query<{ CNT: number; UNIQUE_EMPS: number; UNIQUE_EMAILS: number }>(`
    SELECT COUNT(*) AS CNT,
           COUNT(DISTINCT EMPLOYEE_ID) AS UNIQUE_EMPS,
           COUNT(DISTINCT LOWER(EMAIL)) AS UNIQUE_EMAILS
    FROM TL_TIME_OFF
    WHERE START_DATE <= :ed AND END_DATE >= :sd
  `, { sd: startDate, ed: endDate });
  console.log(`  Time-off records overlapping range: ${ptoCounts[0]!.CNT} (${ptoCounts[0]!.UNIQUE_EMPS} employees by ID, ${ptoCounts[0]!.UNIQUE_EMAILS} by email)`);

  const ptoViewCounts = await query<{ WEEK_START: Date; TOTAL_PTO: number; EMPS: number }>(`
    SELECT WEEK_START, SUM(PTO_DAYS) AS TOTAL_PTO, COUNT(DISTINCT EMAIL) AS EMPS
    FROM V_PTO_WEEKLY
    WHERE WEEK_START BETWEEN TRUNC(:sd, 'IW') AND TRUNC(:ed, 'IW')
    GROUP BY WEEK_START
    ORDER BY WEEK_START
  `, { sd: startDate, ed: endDate });
  console.log('  V_PTO_WEEKLY:');
  for (const r of ptoViewCounts) {
    console.log(`    Week ${fmt(r.WEEK_START)}: ${r.TOTAL_PTO} PTO days, ${r.EMPS} employees`);
  }

  // ====================================================================
  // 7. SPOT-CHECK: compare specific employees BQ vs Oracle
  // ====================================================================
  console.log('\n--- 7. SPOT-CHECK: 5 random employees ---');

  // Pick 5 employees with most records
  const topEmps = await query<{ EMAIL: string; CNT: number }>(`
    SELECT LOWER(EMAIL) AS EMAIL, COUNT(*) AS CNT
    FROM TL_ATTENDANCE
    WHERE RECORD_DATE BETWEEN :sd AND :ed
      AND TO_CHAR(RECORD_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')
    GROUP BY LOWER(EMAIL)
    ORDER BY CNT DESC
    FETCH FIRST 5 ROWS ONLY
  `, { sd: startDate, ed: endDate });

  for (const emp of topEmps) {
    // Oracle per-week
    const oraEmpWeeks = await query<{ WEEK_START: string; OFFICE: number; REMOTE: number }>(`
      SELECT TO_CHAR(TRUNC(RECORD_DATE, 'IW'), 'YYYY-MM-DD') AS WEEK_START,
             SUM(CASE WHEN LOCATION = 'Office' THEN 1 ELSE 0 END) AS OFFICE,
             SUM(CASE WHEN LOCATION = 'Remote' THEN 1 ELSE 0 END) AS REMOTE
      FROM (
        SELECT RECORD_DATE, LOCATION,
          ROW_NUMBER() OVER (
            PARTITION BY TRUNC(RECORD_DATE)
            ORDER BY DECODE(LOCATION, 'Office', 1, 'Remote', 2, 3)
          ) AS rn
        FROM TL_ATTENDANCE
        WHERE LOWER(EMAIL) = :email
          AND RECORD_DATE BETWEEN :sd AND :ed
          AND TO_CHAR(RECORD_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT', 'SUN')
      )
      WHERE rn = 1
      GROUP BY TO_CHAR(TRUNC(RECORD_DATE, 'IW'), 'YYYY-MM-DD')
      ORDER BY 1
    `, { email: emp.EMAIL, sd: startDate, ed: endDate });

    // BigQuery per-week
    const [bqEmpWeeks] = await bq.query({
      query: `
        SELECT FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(d.local_date, ISOWEEK)) as week_start,
               COUNTIF(LOWER(COALESCE(d.location, '')) LIKE '%office%' OR LOWER(COALESCE(d.location, '')) = 'on-site' OR LOWER(COALESCE(d.location, '')) = 'onsite') as office,
               COUNTIF(LOWER(COALESCE(d.location, '')) LIKE '%remote%' OR LOWER(COALESCE(d.location, '')) = 'home' OR LOWER(COALESCE(d.location, '')) = 'wfh') as remote
        FROM \`${BQ_PROJECT}.${BQ_DATASET}.daily_user_summary\` d
        LEFT JOIN (
          SELECT userid, LOWER(email) as email,
            ROW_NUMBER() OVER (PARTITION BY userid ORDER BY email) as rn
          FROM \`${BQ_PROJECT}.${BQ_DATASET}.user_identifiers\`
          WHERE email IS NOT NULL
        ) ue ON d.user_id = ue.userid AND ue.rn = 1
        WHERE d.local_date BETWEEN @sd AND @ed
          AND EXTRACT(DAYOFWEEK FROM d.local_date) NOT IN (1, 7)
          AND LOWER(COALESCE(ue.email, d.user_name)) = @email
        GROUP BY 1
        ORDER BY 1
      `,
      params: { sd: startStr, ed: endStr, email: emp.EMAIL },
      location: 'US',
    });

    console.log(`\n  ${emp.EMAIL} (${emp.CNT} Oracle records):`);
    const bqEmpMap = new Map<string, { office: number; remote: number }>();
    for (const r of bqEmpWeeks) {
      bqEmpMap.set(r.week_start, { office: Number(r.office), remote: Number(r.remote) });
    }

    const allWeeks = new Set([...oraEmpWeeks.map(r => r.WEEK_START), ...bqEmpMap.keys()]);
    for (const wk of [...allWeeks].sort()) {
      const ora = oraEmpWeeks.find(r => r.WEEK_START === wk);
      const bqW = bqEmpMap.get(wk);
      const oraOffice = ora?.OFFICE ?? 0;
      const oraRemote = ora?.REMOTE ?? 0;
      const bqOffice = bqW?.office ?? 0;
      const bqRemote = bqW?.remote ?? 0;
      const match = oraOffice === bqOffice && oraRemote === bqRemote ? '✓' : '⚠';
      console.log(`    ${wk}: BQ(O=${bqOffice} R=${bqRemote}) Oracle(O=${oraOffice} R=${oraRemote}) ${match}`);
    }
  }

  // ====================================================================
  // 8. DUPLICATE CHECK
  // ====================================================================
  console.log('\n--- 8. DUPLICATE CHECK ---');

  const dupes = await query<{ EMAIL: string; DT: string; CNT: number }>(`
    SELECT LOWER(EMAIL) AS EMAIL, TO_CHAR(RECORD_DATE, 'YYYY-MM-DD') AS DT, COUNT(*) AS CNT
    FROM TL_ATTENDANCE
    WHERE RECORD_DATE BETWEEN :sd AND :ed
    GROUP BY LOWER(EMAIL), TO_CHAR(RECORD_DATE, 'YYYY-MM-DD')
    HAVING COUNT(*) > 1
    ORDER BY CNT DESC
    FETCH FIRST 20 ROWS ONLY
  `, { sd: startDate, ed: endDate });

  if (dupes.length === 0) {
    console.log('  ✓  No duplicate (email, date) pairs found');
  } else {
    console.log(`  ⚠  ${dupes.length} duplicate pairs found (showing top 20):`);
    for (const r of dupes) {
      console.log(`    ${r.EMAIL} on ${r.DT}: ${r.CNT} records`);
    }
  }

  // ====================================================================
  // 9. LOCATION NORMALIZATION CHECK
  // ====================================================================
  console.log('\n--- 9. LOCATION NORMALIZATION ---');

  const [bqRawLocs] = await bq.query({
    query: `
      SELECT COALESCE(location, 'NULL') as loc, COUNT(*) as cnt
      FROM \`${BQ_PROJECT}.${BQ_DATASET}.daily_user_summary\`
      WHERE local_date BETWEEN @sd AND @ed
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    params: { sd: startStr, ed: endStr },
    location: 'US',
  });

  console.log('  BigQuery raw location values → normalized:');
  for (const r of bqRawLocs) {
    const raw = String(r.loc);
    const n = raw.toLowerCase().trim();
    let normalized: string;
    if (n.includes('office') || n === 'on-site' || n === 'onsite') normalized = 'Office';
    else if (n.includes('remote') || n === 'home' || n === 'wfh') normalized = 'Remote';
    else normalized = 'Unknown';
    console.log(`    "${raw}" (${r.cnt}) → ${normalized}`);
  }

  // ====================================================================
  // 10. EMPLOYEE COUNT COMPARISON
  // ====================================================================
  console.log('\n--- 10. EMPLOYEE COUNTS ---');

  const oraActiveEmps = await query<{ CNT: number }>(`
    SELECT COUNT(*) AS CNT FROM TL_EMPLOYEES
    WHERE EMAIL IS NOT NULL AND (STATUS IS NULL OR UPPER(STATUS) != 'INACTIVE')
  `);
  const oraAttEmps = await query<{ CNT: number }>(`
    SELECT COUNT(DISTINCT LOWER(EMAIL)) AS CNT FROM TL_ATTENDANCE
    WHERE RECORD_DATE BETWEEN :sd AND :ed
  `, { sd: startDate, ed: endDate });

  console.log(`  Active employees in TL_EMPLOYEES: ${oraActiveEmps[0]!.CNT}`);
  console.log(`  Unique employees in TL_ATTENDANCE (range): ${oraAttEmps[0]!.CNT}`);
  console.log(`  Dashboard shows all active employees (incl. zero attendance)`);

  // Employees in attendance but not in employees table
  const orphanAtt = await query<{ CNT: number }>(`
    SELECT COUNT(DISTINCT LOWER(a.EMAIL)) AS CNT
    FROM TL_ATTENDANCE a
    LEFT JOIN TL_EMPLOYEES e ON LOWER(a.EMAIL) = LOWER(e.EMAIL)
    WHERE a.RECORD_DATE BETWEEN :sd AND :ed
      AND e.EMAIL IS NULL
  `, { sd: startDate, ed: endDate });
  console.log(`  Attendance emails NOT in TL_EMPLOYEES: ${orphanAtt[0]!.CNT}`);

  console.log('\n=== VALIDATION COMPLETE ===\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});

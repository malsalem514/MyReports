-- ============================================================================
-- V_DAILY_EMPLOYEE_HOURS — Payroll Audit View
-- Joins TBS timesheet entries with BHR employees, ActivTrak productivity,
-- and attendance location data. One row per employee per weekday.
-- ============================================================================

CREATE OR REPLACE VIEW V_DAILY_EMPLOYEE_HOURS AS
WITH tbs_data AS (
    -- TBS timesheet entries, weekdays only
    SELECT
        t.EMPLOYEE_NO,
        m.EMAIL,
        TRUNC(t.ENTRY_DATE) AS TBS_ENTRY_DATE,
        TRUNC(t.ENTRY_DATE, 'IW') AS ACTIVITY_WEEK,
        SUM(CASE
            WHEN UPPER(TRIM(t.WORK_DESCRIPTION)) NOT IN ('VACATION','ILLNESS','MISC. ABS./APPTS','ALTERNATE DAY')
             AND NVL(t.ENTRY_TYPE, 'X') != 'C'
            THEN NVL(t.TIME_HOURS, 0)
            ELSE 0
        END) AS REPORTED_HOURS,
        SUM(CASE
            WHEN UPPER(TRIM(t.WORK_DESCRIPTION)) IN ('VACATION','ILLNESS','MISC. ABS./APPTS','ALTERNATE DAY')
              OR t.ENTRY_TYPE = 'C'
            THEN NVL(t.TIME_HOURS, 0)
            ELSE 0
        END) AS ABSENCE_HOURS,
        SUM(NVL(t.TIME_HOURS, 0)) AS TOTAL_TBS
    FROM TBS_ALL_TIME_ENTRIES_V@TBS_LINK t
    JOIN TL_TBS_EMPLOYEE_MAP m ON m.TBS_EMPLOYEE_NO = t.EMPLOYEE_NO
    WHERE TO_CHAR(t.ENTRY_DATE, 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') NOT IN ('SAT','SUN')
      AND t.ENTRY_DATE <= ADD_MONTHS(SYSDATE, 6)
    GROUP BY t.EMPLOYEE_NO, m.EMAIL, TRUNC(t.ENTRY_DATE), TRUNC(t.ENTRY_DATE, 'IW')
),
attendance_dedup AS (
    -- Deduplicate attendance: Office wins over Remote
    SELECT EMAIL, TRUNC(RECORD_DATE) AS ATT_DATE, LOCATION
    FROM (
        SELECT
            EMAIL,
            RECORD_DATE,
            LOCATION,
            ROW_NUMBER() OVER (
                PARTITION BY EMAIL, TRUNC(RECORD_DATE)
                ORDER BY DECODE(LOCATION, 'Office', 1, 'Remote', 2, 3)
            ) AS RN
        FROM TL_ATTENDANCE
    )
    WHERE RN = 1
)
SELECT
    td.EMAIL,
    NVL(e.DISPLAY_NAME, td.EMAIL) AS EMPLOYEE_NAME,
    td.TBS_ENTRY_DATE,
    td.ACTIVITY_WEEK,
    td.EMPLOYEE_NO,
    td.REPORTED_HOURS,
    td.ABSENCE_HOURS,
    td.TOTAL_TBS,
    8 AS BAMBOO_HOURS_PER_DAY,
    ROUND(td.TOTAL_TBS - 8, 2) AS TBS_BAMBOO_DISCREPANCY,
    ROUND(NVL(p.ACTIVE_TIME, 0) / 3600, 2) AS ACTIVE_DURATION,
    ROUND(NVL(p.TOTAL_TIME, 0) / 3600, 2) AS TOTAL_DURATION,
    ROUND(NVL(p.PRODUCTIVE_TIME, 0) / 3600, 2) AS PRODUCTIVE_ACTIVE_DURATION,
    e.DEPARTMENT AS DEPARTMENT_BHR,
    e.JOB_TITLE AS JOB_TITLE_BHR,
    e.LOCATION AS LOCATION_BHR,
    NVL(
        (SELECT s.DISPLAY_NAME FROM TL_EMPLOYEES s WHERE LOWER(s.EMAIL) = LOWER(e.SUPERVISOR_EMAIL)),
        e.SUPERVISOR_EMAIL
    ) AS REPORTING_TO,
    att.LOCATION AS WORK_LOCATION
FROM tbs_data td
LEFT JOIN TL_EMPLOYEES e ON LOWER(e.EMAIL) = LOWER(td.EMAIL)
LEFT JOIN TL_PRODUCTIVITY p ON LOWER(p.EMAIL) = LOWER(td.EMAIL) AND p.RECORD_DATE = td.TBS_ENTRY_DATE
LEFT JOIN attendance_dedup att ON LOWER(att.EMAIL) = LOWER(td.EMAIL) AND att.ATT_DATE = td.TBS_ENTRY_DATE;

-- ============================================================================
-- Validation Queries
-- ============================================================================

-- Row count for recent 6 weeks
-- SELECT COUNT(*), COUNT(DISTINCT EMAIL), MIN(TBS_ENTRY_DATE), MAX(TBS_ENTRY_DATE)
-- FROM V_DAILY_EMPLOYEE_HOURS
-- WHERE ACTIVITY_WEEK >= TRUNC(SYSDATE - 42, 'IW');

-- Sample data
-- SELECT * FROM V_DAILY_EMPLOYEE_HOURS
-- WHERE ACTIVITY_WEEK >= TRUNC(SYSDATE - 14, 'IW')
-- ORDER BY EMAIL, TBS_ENTRY_DATE
-- FETCH FIRST 50 ROWS ONLY;

-- Discrepancy outliers
-- SELECT EMAIL, EMPLOYEE_NAME, TBS_ENTRY_DATE, TOTAL_TBS, TBS_BAMBOO_DISCREPANCY
-- FROM V_DAILY_EMPLOYEE_HOURS
-- WHERE ABS(TBS_BAMBOO_DISCREPANCY) > 2
-- ORDER BY ABS(TBS_BAMBOO_DISCREPANCY) DESC
-- FETCH FIRST 20 ROWS ONLY;

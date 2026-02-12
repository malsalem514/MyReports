-- ============================================================================
-- V_ATTENDANCE_WEEKLY
-- One row per active employee per ISO week.
-- Deduplicates TL_ATTENDANCE: Office wins over Remote for same employee-day.
-- ============================================================================

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
    LOWER(e.EMAIL)                          AS EMAIL,
    NVL(e.DISPLAY_NAME, e.EMAIL)           AS DISPLAY_NAME,
    NVL(e.DEPARTMENT, 'Unknown')           AS DEPARTMENT,
    NVL(e.LOCATION, 'Unknown')             AS OFFICE_LOCATION,
    TRUNC(d.RECORD_DATE, 'IW')             AS WEEK_START,
    CASE WHEN d.LOCATION = 'Office' THEN 1 ELSE 0 END AS OFFICE_DAYS,
    CASE WHEN d.LOCATION = 'Remote' THEN 1 ELSE 0 END AS REMOTE_DAYS
  FROM TL_EMPLOYEES e
  JOIN (
    SELECT EMAIL, RECORD_DATE, LOCATION
    FROM (
      SELECT EMAIL, RECORD_DATE, LOCATION,
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
)
GROUP BY EMAIL, DISPLAY_NAME, DEPARTMENT, OFFICE_LOCATION, WEEK_START;


-- ============================================================================
-- V_PTO_WEEKLY
-- PTO days per employee per ISO week (weekdays only).
-- Expands TL_TIME_OFF date ranges into individual days, filters weekends.
-- ============================================================================

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
GROUP BY LOWER(EMAIL), TRUNC(PTO_DATE, 'IW');

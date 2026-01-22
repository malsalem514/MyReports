-- HR Dashboard Database Schema
-- Oracle DDL Scripts for HR Productivity Dashboard

-- ============================================================================
-- HR Employees Table (Cached from BambooHR)
-- ============================================================================
CREATE TABLE hr_employees (
    employee_id         NUMBER(10) PRIMARY KEY,
    bamboohr_id         VARCHAR2(50) NOT NULL UNIQUE,
    email               VARCHAR2(255) NOT NULL UNIQUE,
    first_name          VARCHAR2(100) NOT NULL,
    last_name           VARCHAR2(100) NOT NULL,
    display_name        VARCHAR2(250) GENERATED ALWAYS AS (first_name || ' ' || last_name) VIRTUAL,
    job_title           VARCHAR2(200),
    department          VARCHAR2(200),
    division            VARCHAR2(200),
    location            VARCHAR2(200),
    work_email          VARCHAR2(255),
    supervisor_id       NUMBER(10),
    supervisor_email    VARCHAR2(255),
    hire_date           DATE,
    employment_status   VARCHAR2(50),
    is_active           NUMBER(1) DEFAULT 1,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at           TIMESTAMP,
    CONSTRAINT fk_supervisor FOREIGN KEY (supervisor_id)
        REFERENCES hr_employees(employee_id)
);

CREATE INDEX idx_employees_email ON hr_employees(email);
CREATE INDEX idx_employees_supervisor ON hr_employees(supervisor_id);
CREATE INDEX idx_employees_department ON hr_employees(department);
CREATE INDEX idx_employees_active ON hr_employees(is_active);

-- ============================================================================
-- HR Productivity Daily Table (Cached from BigQuery/ActivTrak)
-- ============================================================================
CREATE TABLE hr_productivity_daily (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id             NUMBER(10) NOT NULL,
    activity_date           DATE NOT NULL,
    username                VARCHAR2(255),
    email                   VARCHAR2(255),
    -- Time metrics (in seconds)
    productive_time         NUMBER DEFAULT 0,
    unproductive_time       NUMBER DEFAULT 0,
    neutral_time            NUMBER DEFAULT 0,
    total_time              NUMBER DEFAULT 0,
    -- Derived metrics
    productivity_score      NUMBER(5,2),
    productive_hours        NUMBER(10,2) GENERATED ALWAYS AS (productive_time / 3600) VIRTUAL,
    total_hours             NUMBER(10,2) GENERATED ALWAYS AS (total_time / 3600) VIRTUAL,
    -- Activity breakdown
    active_time             NUMBER DEFAULT 0,
    idle_time               NUMBER DEFAULT 0,
    offline_time            NUMBER DEFAULT 0,
    -- Additional metrics from ActivTrak
    focus_time              NUMBER DEFAULT 0,
    collaboration_time      NUMBER DEFAULT 0,
    -- Metadata
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at               TIMESTAMP,
    CONSTRAINT fk_productivity_employee FOREIGN KEY (employee_id)
        REFERENCES hr_employees(employee_id),
    CONSTRAINT uk_productivity_daily UNIQUE (employee_id, activity_date)
);

CREATE INDEX idx_productivity_date ON hr_productivity_daily(activity_date);
CREATE INDEX idx_productivity_employee ON hr_productivity_daily(employee_id);
CREATE INDEX idx_productivity_email ON hr_productivity_daily(email);
CREATE INDEX idx_productivity_score ON hr_productivity_daily(productivity_score);

-- ============================================================================
-- HR Sync Status Table
-- ============================================================================
CREATE TABLE hr_sync_status (
    id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sync_type           VARCHAR2(50) NOT NULL, -- 'employees', 'productivity'
    sync_source         VARCHAR2(50) NOT NULL, -- 'bamboohr', 'bigquery'
    started_at          TIMESTAMP NOT NULL,
    completed_at        TIMESTAMP,
    status              VARCHAR2(20) DEFAULT 'running', -- 'running', 'completed', 'failed'
    records_processed   NUMBER DEFAULT 0,
    records_created     NUMBER DEFAULT 0,
    records_updated     NUMBER DEFAULT 0,
    records_failed      NUMBER DEFAULT 0,
    error_message       CLOB,
    sync_params         CLOB, -- JSON with date range, filters, etc.
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sync_type ON hr_sync_status(sync_type);
CREATE INDEX idx_sync_status ON hr_sync_status(status);
CREATE INDEX idx_sync_started ON hr_sync_status(started_at);

-- ============================================================================
-- HR Manager Hierarchy View
-- ============================================================================
CREATE OR REPLACE VIEW hr_manager_hierarchy AS
WITH RECURSIVE employee_tree (
    employee_id,
    email,
    display_name,
    supervisor_id,
    manager_id,
    hierarchy_level
) AS (
    -- Base case: employees who are managers (have someone reporting to them)
    SELECT
        e.employee_id,
        e.email,
        e.display_name,
        e.supervisor_id,
        e.employee_id AS manager_id,
        0 AS hierarchy_level
    FROM hr_employees e
    WHERE e.is_active = 1
    AND EXISTS (
        SELECT 1 FROM hr_employees sub
        WHERE sub.supervisor_id = e.employee_id
    )

    UNION ALL

    -- Recursive case: find all reports
    SELECT
        e.employee_id,
        e.email,
        e.display_name,
        e.supervisor_id,
        t.manager_id,
        t.hierarchy_level + 1
    FROM hr_employees e
    INNER JOIN employee_tree t ON e.supervisor_id = t.employee_id
    WHERE e.is_active = 1
    AND t.hierarchy_level < 10 -- Prevent infinite recursion
)
SELECT * FROM employee_tree;

-- ============================================================================
-- HR Admin Roles Table
-- ============================================================================
CREATE TABLE hr_admin_users (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_email      VARCHAR2(255) NOT NULL UNIQUE,
    role            VARCHAR2(50) NOT NULL, -- 'hr_admin', 'hr_viewer'
    granted_by      VARCHAR2(255),
    granted_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active       NUMBER(1) DEFAULT 1
);

CREATE INDEX idx_admin_email ON hr_admin_users(user_email);
CREATE INDEX idx_admin_active ON hr_admin_users(is_active);

-- ============================================================================
-- Productivity Summary Materialized View (for dashboard performance)
-- ============================================================================
CREATE MATERIALIZED VIEW hr_productivity_summary
BUILD IMMEDIATE
REFRESH COMPLETE ON DEMAND
AS
SELECT
    e.employee_id,
    e.display_name,
    e.email,
    e.department,
    e.supervisor_id,
    COUNT(p.id) AS days_tracked,
    ROUND(AVG(p.productivity_score), 2) AS avg_productivity_score,
    ROUND(SUM(p.productive_time) / 3600, 2) AS total_productive_hours,
    ROUND(SUM(p.total_time) / 3600, 2) AS total_hours,
    ROUND(AVG(p.productive_time / NULLIF(p.total_time, 0)) * 100, 2) AS avg_productive_percent,
    MIN(p.activity_date) AS first_activity_date,
    MAX(p.activity_date) AS last_activity_date
FROM hr_employees e
LEFT JOIN hr_productivity_daily p ON e.employee_id = p.employee_id
WHERE e.is_active = 1
GROUP BY e.employee_id, e.display_name, e.email, e.department, e.supervisor_id;

-- ============================================================================
-- Stored Procedure: Refresh Productivity Summary
-- ============================================================================
CREATE OR REPLACE PROCEDURE refresh_productivity_summary
AS
BEGIN
    DBMS_MVIEW.REFRESH('hr_productivity_summary', 'C');
    COMMIT;
END;
/

-- ============================================================================
-- Sequence for Employee IDs (if not using BambooHR IDs directly)
-- ============================================================================
CREATE SEQUENCE hr_employee_seq
    START WITH 1
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;

-- ============================================================================
-- Triggers
-- ============================================================================

-- Update timestamp trigger for hr_employees
CREATE OR REPLACE TRIGGER trg_employees_updated
BEFORE UPDATE ON hr_employees
FOR EACH ROW
BEGIN
    :NEW.updated_at := CURRENT_TIMESTAMP;
END;
/

-- ============================================================================
-- Sample Data for Testing (Optional)
-- ============================================================================
/*
INSERT INTO hr_employees (employee_id, bamboohr_id, email, first_name, last_name, job_title, department)
VALUES (hr_employee_seq.NEXTVAL, 'BHR001', 'john.doe@company.com', 'John', 'Doe', 'Software Engineer', 'Engineering');

INSERT INTO hr_employees (employee_id, bamboohr_id, email, first_name, last_name, job_title, department, supervisor_id)
VALUES (hr_employee_seq.NEXTVAL, 'BHR002', 'jane.smith@company.com', 'Jane', 'Smith', 'Junior Developer', 'Engineering', 1);

COMMIT;
*/

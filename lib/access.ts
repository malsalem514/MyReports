import { cache } from 'react';
import { auth } from '@/auth';
import { getDevBypassEmail } from './dev-bypass';
import { isAdminEmail, isRootAdminEmail } from './admin';
import { normalizeEmail } from './email';
import { query } from './oracle';

// ============================================================================
// Types
// ============================================================================

export interface AccessContext {
  userEmail: string;
  employeeId: string | null;
  employeeName: string | null;
  department: string | null;
  isRootAdmin: boolean;
  isHRAdmin: boolean;
  isDirector: boolean;
  isManager: boolean;
  allowedEmails: string[];
  directReportCount: number;
  totalReportCount: number;
}

export type AccessLevel = 'none' | 'self' | 'team' | 'all';

export interface RoleDiagnostics {
  isDirector: boolean;
  reason: string | null;
}

interface AccessEmployeeRow {
  ID: string;
  EMPLOYEE_NUMBER: number | null;
  EMAIL: string;
  DISPLAY_NAME: string | null;
  FIRST_NAME: string | null;
  LAST_NAME: string | null;
  JOB_TITLE: string | null;
  DEPARTMENT: string | null;
  SUPERVISOR_ID: string | null;
  SUPERVISOR_EMAIL: string | null;
}

export function getRoleDiagnostics(employee: {
  jobTitle?: string | null;
  department?: string | null;
}): RoleDiagnostics {
  const jobTitle = (employee.jobTitle || '').toLowerCase().trim();
  const department = (employee.department || '').toLowerCase().trim();

  if (department === 'executive') {
    return { isDirector: true, reason: 'Department is Executive' };
  }

  if (/(director)/.test(jobTitle)) {
    return { isDirector: true, reason: 'Job title contains Director' };
  }

  return { isDirector: false, reason: null };
}

async function fetchActiveAccessEmployees(): Promise<AccessEmployeeRow[]> {
  return query<AccessEmployeeRow>(
    `SELECT
       ID,
       EMPLOYEE_NUMBER,
       LOWER(EMAIL) AS EMAIL,
       DISPLAY_NAME,
       FIRST_NAME,
       LAST_NAME,
       JOB_TITLE,
       DEPARTMENT,
       SUPERVISOR_ID,
       LOWER(SUPERVISOR_EMAIL) AS SUPERVISOR_EMAIL
     FROM TL_EMPLOYEES
     WHERE EMAIL IS NOT NULL
       AND (STATUS IS NULL OR UPPER(STATUS) != 'INACTIVE')`,
  );
}

function toRoleEmployee(row: AccessEmployeeRow) {
  return {
    jobTitle: row.JOB_TITLE,
    department: row.DEPARTMENT,
  };
}

function getEmployeeName(row: AccessEmployeeRow, fallbackEmail: string): string {
  return (
    row.DISPLAY_NAME ||
    `${row.FIRST_NAME || ''} ${row.LAST_NAME || ''}`.trim() ||
    fallbackEmail
  );
}

function getEmployeeLookupKeys(row: AccessEmployeeRow): string[] {
  return [
    row.ID,
    row.EMPLOYEE_NUMBER === null || row.EMPLOYEE_NUMBER === undefined ? null : String(row.EMPLOYEE_NUMBER),
    row.EMAIL,
  ].map((value) => (value ? normalizeEmail(value) : '')).filter(Boolean);
}

function collectReportRows(
  allEmployees: AccessEmployeeRow[],
  currentUser: AccessEmployeeRow,
): { directReports: AccessEmployeeRow[]; allReports: AccessEmployeeRow[] } {
  const bySupervisor = new Map<string, AccessEmployeeRow[]>();
  const addSupervisorKey = (key: string | null | undefined, employee: AccessEmployeeRow) => {
    const normalized = key ? normalizeEmail(key) : '';
    if (!normalized) return;
    if (!bySupervisor.has(normalized)) bySupervisor.set(normalized, []);
    bySupervisor.get(normalized)!.push(employee);
  };

  for (const employee of allEmployees) {
    addSupervisorKey(employee.SUPERVISOR_ID, employee);
    addSupervisorKey(employee.SUPERVISOR_EMAIL, employee);
  }

  const managerKeys = getEmployeeLookupKeys(currentUser);

  const directByEmail = new Map<string, AccessEmployeeRow>();
  for (const key of managerKeys) {
    for (const report of bySupervisor.get(key) || []) {
      directByEmail.set(normalizeEmail(report.EMAIL), report);
    }
  }

  const allByEmail = new Map<string, AccessEmployeeRow>();
  const queue = [...directByEmail.values()];
  while (queue.length > 0) {
    const report = queue.shift()!;
    const email = normalizeEmail(report.EMAIL);
    if (allByEmail.has(email)) continue;
    allByEmail.set(email, report);

    for (const key of getEmployeeLookupKeys(report)) {
      for (const child of bySupervisor.get(key) || []) {
        if (!allByEmail.has(normalizeEmail(child.EMAIL))) queue.push(child);
      }
    }
  }

  return {
    directReports: [...directByEmail.values()],
    allReports: [...allByEmail.values()],
  };
}

// ============================================================================
// Core — React.cache deduplicates per request
// ============================================================================

export const getAccessContext = cache(async (): Promise<AccessContext> => {
  // Dev-only auth bypass — use DEV_BYPASS_EMAIL as the logged-in user
  const bypassEmail = getDevBypassEmail('access-context');
  if (bypassEmail) {
    return getAccessContextByEmail(bypassEmail);
  }

  const session = await auth();
  if (!session?.user?.email) {
    return {
      userEmail: '',
      employeeId: null,
      employeeName: null,
      department: null,
      isRootAdmin: false,
      isHRAdmin: false,
      isDirector: false,
      isManager: false,
      allowedEmails: [],
      directReportCount: 0,
      totalReportCount: 0,
    };
  }
  return getAccessContextByEmail(session.user.email);
});

export async function getAccessContextByEmail(
  userEmail: string,
): Promise<AccessContext> {
  const normalizedEmail = normalizeEmail(userEmail);
  const isRootAdmin = isRootAdminEmail(normalizedEmail);
  const hasAdminAccess = isAdminEmail(normalizedEmail);

  // Root and HR-admin access must not depend on external directory availability.
  if (hasAdminAccess) {
    try {
      const allEmployees = await fetchActiveAccessEmployees();
      const allEmails = allEmployees
        .filter((emp) => emp.EMAIL)
        .map((emp) => normalizeEmail(emp.EMAIL));
      return {
        userEmail: normalizedEmail,
        employeeId: null,
        employeeName: isRootAdmin ? 'Root Admin' : 'HR Admin',
        department: null,
        isRootAdmin,
        isHRAdmin: true,
        isDirector: true,
        isManager: true,
        allowedEmails: allEmails.length > 0 ? allEmails : [normalizedEmail],
        directReportCount: allEmails.length,
        totalReportCount: allEmails.length,
      };
    } catch (error) {
      console.error('Error fetching HR admin directory context from BambooHR:', error);
      return {
        userEmail: normalizedEmail,
        employeeId: null,
        employeeName: isRootAdmin ? 'Root Admin' : 'HR Admin',
        department: null,
        isRootAdmin,
        isHRAdmin: true,
        isDirector: true,
        isManager: true,
        allowedEmails: [normalizedEmail],
        directReportCount: 0,
        totalReportCount: 0,
      };
    }
  }

  try {
    const allEmployees = await fetchActiveAccessEmployees();

    const currentUser = allEmployees.find(
      (emp) => emp.EMAIL && normalizeEmail(emp.EMAIL) === normalizedEmail,
    );

    if (!currentUser) {
      return {
        userEmail: normalizedEmail,
        employeeId: null,
        employeeName: null,
        department: null,
        isRootAdmin: false,
        isHRAdmin: false,
        isDirector: false,
        isManager: false,
        allowedEmails: [normalizedEmail],
        directReportCount: 0,
        totalReportCount: 0,
      };
    }

    const { directReports, allReports } = collectReportRows(allEmployees, currentUser);
    const diagnostics = getRoleDiagnostics(toRoleEmployee(currentUser));

    const allowedEmails = new Set<string>();
    allowedEmails.add(normalizedEmail);

    for (const report of allReports) {
      if (report.EMAIL) allowedEmails.add(normalizeEmail(report.EMAIL));
    }

    return {
      userEmail: normalizedEmail,
      employeeId: currentUser.ID,
      employeeName: getEmployeeName(currentUser, normalizedEmail),
      department: currentUser.DEPARTMENT ?? null,
      isRootAdmin: false,
      isHRAdmin: false,
      isDirector: diagnostics.isDirector,
      isManager: allReports.length > 0,
      allowedEmails: Array.from(allowedEmails),
      directReportCount: directReports.length,
      totalReportCount: allReports.length,
    };
  } catch (error) {
    console.error('Error fetching access context from Oracle:', error);
    return {
      userEmail: normalizedEmail,
      employeeId: null,
      employeeName: null,
      department: null,
      isRootAdmin: false,
      isHRAdmin: false,
      isDirector: false,
      isManager: false,
      allowedEmails: [normalizedEmail],
      directReportCount: 0,
      totalReportCount: 0,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

export function getAccessLevel(context: AccessContext): AccessLevel {
  if (context.isRootAdmin || context.isHRAdmin) return 'all';
  if ((context.isDirector || context.isManager) && context.totalReportCount > 0) return 'team';
  if (context.employeeId) return 'self';
  return 'none';
}

export function canAccessEmployee(context: AccessContext, targetEmail: string): boolean {
  if (context.isRootAdmin || context.isHRAdmin) return true;
  return context.allowedEmails.includes(normalizeEmail(targetEmail));
}

export function getScopedReportEmails(context: AccessContext): string[] | undefined {
  if (context.isRootAdmin || context.isHRAdmin) return undefined;
  return context.allowedEmails;
}

export function filterAccessibleEmails(context: AccessContext, emails: string[]): string[] {
  if (context.isRootAdmin || context.isHRAdmin) return emails;
  const allowedSet = new Set(context.allowedEmails.map((email) => normalizeEmail(email)));
  return emails.filter((email) => allowedSet.has(normalizeEmail(email)));
}

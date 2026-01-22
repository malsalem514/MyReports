import type { Employee } from '@/lib/db/queries';
import {
  fetchEmployeeDirectory,
  fetchReportingStructure,
  BambooHREmployee
} from '@/lib/api/bamboohr/client';

// HR Admin emails - these users can see all employees
const HR_ADMIN_EMAILS = [
  'admin@company.com',
  'hr@jestais.com',
  // Add more HR admin emails here
];

// Check if Clerk is configured
const hasClerkKeys = !!(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== ''
);

// Dynamic import for Clerk (only when configured)
async function getClerkAuth() {
  if (!hasClerkKeys) return { auth: null, currentUser: null };
  try {
    const clerk = await import('@clerk/nextjs/server');
    return { auth: clerk.auth, currentUser: clerk.currentUser };
  } catch {
    return { auth: null, currentUser: null };
  }
}

// Lazy import DB queries to avoid issues when DB isn't ready
async function getDbQueries() {
  try {
    return await import('@/lib/db/queries');
  } catch {
    return null;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface ManagerAccessContext {
  userId: string;
  email: string;
  employeeId: number | null;
  isManager: boolean;
  isHRAdmin: boolean;
  hrRole: string | null;
  directReportIds: number[];
  allReportIds: number[];
  canAccessAllEmployees: boolean;
}

export type AccessLevel = 'none' | 'self' | 'team' | 'all';

// ============================================================================
// Access Context
// ============================================================================

/**
 * Get the current user's manager access context
 * This is the primary function for determining what data a user can access
 */
export async function getManagerAccessContext(): Promise<ManagerAccessContext | null> {
  // If Clerk is not configured, return a default HR admin context for development
  if (!hasClerkKeys) {
    return {
      userId: 'dev-user',
      email: 'admin@jestais.com',
      employeeId: null,
      isManager: true,
      isHRAdmin: true,
      hrRole: 'hr_admin',
      directReportIds: [],
      allReportIds: [],
      canAccessAllEmployees: true
    };
  }

  const { auth, currentUser } = await getClerkAuth();
  if (!auth || !currentUser) return null;

  const { userId } = await auth();
  const user = await currentUser();

  if (!userId || !user) {
    return null;
  }

  const email =
    user.primaryEmailAddress?.emailAddress ||
    user.emailAddresses[0]?.emailAddress;

  if (!email) {
    console.error('User has no email address');
    return null;
  }

  const db = await getDbQueries();
  if (!db) {
    // Return basic context if DB not available
    return {
      userId,
      email,
      employeeId: null,
      isManager: false,
      isHRAdmin: true, // Default to admin for now
      hrRole: 'hr_admin',
      directReportIds: [],
      allReportIds: [],
      canAccessAllEmployees: true
    };
  }

  // Get employee record
  const employee = await db.getEmployeeByEmail(email);

  // Check HR admin status
  const hrAdmin = await db.isHRAdmin(email);
  const hrRole = hrAdmin ? await db.getHRAdminRole(email) : null;

  // Get manager status and reports
  let directReportIds: number[] = [];
  let allReportIds: number[] = [];
  let userIsManager = false;

  if (employee) {
    userIsManager = await db.isManager(employee.EMPLOYEE_ID);

    if (userIsManager) {
      const directReports = await db.getDirectReports(employee.EMPLOYEE_ID);
      directReportIds = directReports.map((r) => r.EMPLOYEE_ID);

      allReportIds = await db.getManagerReportIds(employee.EMPLOYEE_ID);
    }
  }

  return {
    userId,
    email,
    employeeId: employee?.EMPLOYEE_ID || null,
    isManager: userIsManager,
    isHRAdmin: hrAdmin,
    hrRole,
    directReportIds,
    allReportIds,
    canAccessAllEmployees: hrAdmin
  };
}

// ============================================================================
// Access Validation
// ============================================================================

/**
 * Check if user can access a specific employee's data
 */
export async function canAccessEmployeeData(
  targetEmployeeId: number
): Promise<boolean> {
  const context = await getManagerAccessContext();

  if (!context) {
    return false;
  }

  // HR admins can access all data
  if (context.canAccessAllEmployees) {
    return true;
  }

  // Users can access their own data
  if (context.employeeId === targetEmployeeId) {
    return true;
  }

  // Managers can access their reports' data
  if (context.allReportIds.includes(targetEmployeeId)) {
    return true;
  }

  return false;
}

/**
 * Check if user can access data for multiple employees
 * Returns list of accessible employee IDs
 */
export async function filterAccessibleEmployees(
  employeeIds: number[]
): Promise<number[]> {
  const context = await getManagerAccessContext();

  if (!context) {
    return [];
  }

  // HR admins can access all
  if (context.canAccessAllEmployees) {
    return employeeIds;
  }

  // Filter to only accessible employees
  const accessible = new Set([
    context.employeeId,
    ...context.allReportIds
  ].filter((id): id is number => id !== null));

  return employeeIds.filter((id) => accessible.has(id));
}

/**
 * Get list of employee IDs the current user can access
 */
export async function getAccessibleEmployeeIds(): Promise<number[]> {
  const context = await getManagerAccessContext();

  if (!context) {
    return [];
  }

  // HR admins - return empty to signal "all access"
  // The calling code should handle this case
  if (context.canAccessAllEmployees) {
    return [];
  }

  // Return self + all reports
  const ids = new Set<number>();

  if (context.employeeId) {
    ids.add(context.employeeId);
  }

  for (const id of context.allReportIds) {
    ids.add(id);
  }

  return Array.from(ids);
}

/**
 * Determine access level for current user
 */
export async function getAccessLevel(): Promise<AccessLevel> {
  const context = await getManagerAccessContext();

  if (!context) {
    return 'none';
  }

  if (context.canAccessAllEmployees) {
    return 'all';
  }

  if (context.isManager && context.allReportIds.length > 0) {
    return 'team';
  }

  if (context.employeeId) {
    return 'self';
  }

  return 'none';
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Require authentication and return access context
 * Throws if not authenticated
 */
export async function requireAuth(): Promise<ManagerAccessContext> {
  const context = await getManagerAccessContext();

  if (!context) {
    throw new Error('Authentication required');
  }

  return context;
}

/**
 * Require manager or HR admin access
 * Throws if user doesn't have team access
 */
export async function requireTeamAccess(): Promise<ManagerAccessContext> {
  const context = await requireAuth();

  if (!context.isManager && !context.isHRAdmin) {
    throw new Error('Team access required');
  }

  return context;
}

/**
 * Require HR admin access
 * Throws if user is not an HR admin
 */
export async function requireHRAdmin(): Promise<ManagerAccessContext> {
  const context = await requireAuth();

  if (!context.isHRAdmin) {
    throw new Error('HR Admin access required');
  }

  return context;
}

/**
 * Validate employee access and return employee data
 * Throws if access denied
 */
export async function validateEmployeeAccess(
  employeeId: number
): Promise<{ context: ManagerAccessContext; employee: Employee | null }> {
  const context = await requireAuth();

  const hasAccess = await canAccessEmployeeData(employeeId);
  if (!hasAccess) {
    throw new Error('Access denied');
  }

  const db = await getDbQueries();
  const employee = db ? await db.getEmployeeByEmail(context.email) : null;

  return { context, employee };
}

// ============================================================================
// React Server Component Helpers
// ============================================================================

/**
 * Get access context for use in React Server Components
 * Returns null if not authenticated (doesn't throw)
 */
export async function getServerAccessContext(): Promise<ManagerAccessContext | null> {
  try {
    return await getManagerAccessContext();
  } catch {
    return null;
  }
}

/**
 * Check if current user has HR dashboard access
 */
export async function hasHRDashboardAccess(): Promise<boolean> {
  const context = await getServerAccessContext();

  if (!context) {
    return false;
  }

  // User needs to be either:
  // 1. An HR admin
  // 2. A manager with reports
  // 3. An employee (can see own data)
  return context.isHRAdmin || context.isManager || context.employeeId !== null;
}

// ============================================================================
// BambooHR-based Access Control (for email-based testing)
// ============================================================================

export interface EmailBasedAccessContext {
  userEmail: string;
  employeeId: string | null;
  employeeName: string | null;
  isHRAdmin: boolean;
  isManager: boolean;
  allowedEmails: string[];
  directReportCount: number;
  totalReportCount: number;
}

/**
 * Get access context for a given email using BambooHR data
 * This is used for testing with manual email input
 */
export async function getAccessContextByEmail(
  userEmail: string
): Promise<EmailBasedAccessContext> {
  const normalizedEmail = userEmail.toLowerCase().trim();

  // Check if HR admin - can see everyone
  const isHRAdmin = HR_ADMIN_EMAILS.some(
    (admin) => admin.toLowerCase() === normalizedEmail
  );

  try {
    const allEmployees = await fetchEmployeeDirectory();

    if (isHRAdmin) {
      // HR admins see all employees
      const allEmails = allEmployees
        .filter((emp) => emp.workEmail)
        .map((emp) => emp.workEmail!.toLowerCase());

      return {
        userEmail: normalizedEmail,
        employeeId: null,
        employeeName: 'HR Admin',
        isHRAdmin: true,
        isManager: true,
        allowedEmails: allEmails,
        directReportCount: allEmails.length,
        totalReportCount: allEmails.length
      };
    }

    // Find the user in BambooHR
    const currentUser = allEmployees.find(
      (emp) => emp.workEmail?.toLowerCase() === normalizedEmail
    );

    if (!currentUser) {
      // User not found in BambooHR - can only see their own data
      return {
        userEmail: normalizedEmail,
        employeeId: null,
        employeeName: null,
        isHRAdmin: false,
        isManager: false,
        allowedEmails: [normalizedEmail],
        directReportCount: 0,
        totalReportCount: 0
      };
    }

    // Get all employees reporting to this user (direct + indirect)
    const reports = await fetchReportingStructure(currentUser.id);

    // Build list of allowed emails (self + all reports)
    const allowedEmails = new Set<string>();
    allowedEmails.add(normalizedEmail);

    // Count direct reports
    let directReportCount = 0;
    for (const emp of allEmployees) {
      if (
        emp.supervisorId === currentUser.id ||
        emp.supervisorEId === currentUser.id
      ) {
        directReportCount++;
      }
    }

    // Add all reports' emails
    for (const report of reports) {
      if (report.workEmail) {
        allowedEmails.add(report.workEmail.toLowerCase());
      }
    }

    const userName = currentUser.displayName ||
      `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() ||
      normalizedEmail;

    return {
      userEmail: normalizedEmail,
      employeeId: currentUser.id,
      employeeName: userName,
      isHRAdmin: false,
      isManager: reports.length > 0,
      allowedEmails: Array.from(allowedEmails),
      directReportCount,
      totalReportCount: reports.length
    };
  } catch (error) {
    console.error('Error fetching access context from BambooHR:', error);
    // On error, return minimal access (self only)
    return {
      userEmail: normalizedEmail,
      employeeId: null,
      employeeName: null,
      isHRAdmin: false,
      isManager: false,
      allowedEmails: [normalizedEmail],
      directReportCount: 0,
      totalReportCount: 0
    };
  }
}

/**
 * Get list of HR admin emails
 */
export function getHRAdminEmails(): string[] {
  return [...HR_ADMIN_EMAILS];
}

/**
 * Check if an email is an HR admin
 */
export function isHRAdminEmail(email: string): boolean {
  return HR_ADMIN_EMAILS.some(
    (admin) => admin.toLowerCase() === email.toLowerCase().trim()
  );
}

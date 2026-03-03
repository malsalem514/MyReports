import { cache } from 'react';
import { auth } from '@/auth';
import { getDevBypassEmail } from './dev-bypass';
import {
  fetchEmployeeDirectory,
  fetchReportingStructure,
  type BambooHREmployee,
} from './bamboohr';

// ============================================================================
// Configuration
// ============================================================================

const HR_ADMIN_EMAILS = [
  'hr@jestais.com',
  'malsalem@jestais.com',
  'iferber@jestais.com',
];

// ============================================================================
// Types
// ============================================================================

export interface AccessContext {
  userEmail: string;
  employeeId: string | null;
  employeeName: string | null;
  isHRAdmin: boolean;
  isManager: boolean;
  allowedEmails: string[];
  directReportCount: number;
  totalReportCount: number;
}

export type AccessLevel = 'none' | 'self' | 'team' | 'all';

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
      isHRAdmin: false,
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
  const normalizedEmail = userEmail.toLowerCase().trim();
  const isHRAdmin = HR_ADMIN_EMAILS.some(
    (admin) => admin.toLowerCase() === normalizedEmail,
  );

  // HR-admin access must not depend on external directory availability.
  if (isHRAdmin) {
    try {
      const allEmployees = await fetchEmployeeDirectory();
      const allEmails = allEmployees
        .filter((emp) => emp.workEmail)
        .map((emp) => emp.workEmail!.toLowerCase());
      return {
        userEmail: normalizedEmail,
        employeeId: null,
        employeeName: 'HR Admin',
        isHRAdmin: true,
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
        employeeName: 'HR Admin',
        isHRAdmin: true,
        isManager: true,
        allowedEmails: [normalizedEmail],
        directReportCount: 0,
        totalReportCount: 0,
      };
    }
  }

  try {
    const allEmployees = await fetchEmployeeDirectory();

    const currentUser = allEmployees.find(
      (emp) => emp.workEmail?.toLowerCase() === normalizedEmail,
    );

    if (!currentUser) {
      return {
        userEmail: normalizedEmail,
        employeeId: null,
        employeeName: null,
        isHRAdmin: false,
        isManager: false,
        allowedEmails: [normalizedEmail],
        directReportCount: 0,
        totalReportCount: 0,
      };
    }

    const reports = await fetchReportingStructure(currentUser.id);

    const allowedEmails = new Set<string>();
    allowedEmails.add(normalizedEmail);

    let directReportCount = 0;
    for (const emp of allEmployees) {
      if (emp.supervisorId === currentUser.id || emp.supervisorEId === currentUser.id) {
        directReportCount++;
      }
    }

    for (const report of reports) {
      if (report.workEmail) allowedEmails.add(report.workEmail.toLowerCase());
    }

    const userName =
      currentUser.displayName ||
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
      totalReportCount: reports.length,
    };
  } catch (error) {
    console.error('Error fetching access context from BambooHR:', error);
    return {
      userEmail: normalizedEmail,
      employeeId: null,
      employeeName: null,
      isHRAdmin: false,
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
  if (context.isHRAdmin) return 'all';
  if (context.isManager && context.totalReportCount > 0) return 'team';
  if (context.employeeId) return 'self';
  return 'none';
}

export function canAccessEmployee(context: AccessContext, targetEmail: string): boolean {
  if (context.isHRAdmin) return true;
  return context.allowedEmails.includes(targetEmail.toLowerCase());
}

export function filterAccessibleEmails(context: AccessContext, emails: string[]): string[] {
  if (context.isHRAdmin) return emails;
  const allowedSet = new Set(context.allowedEmails);
  return emails.filter((email) => allowedSet.has(email.toLowerCase()));
}

export function isHRAdminEmail(email: string): boolean {
  return HR_ADMIN_EMAILS.some((admin) => admin.toLowerCase() === email.toLowerCase().trim());
}

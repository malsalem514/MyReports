'use server';

import { fetchOfficeAttendanceData, OfficeAttendanceRecord } from '@/lib/api/bigquery/client';
import { fetchEmployeeDirectory, BambooHREmployee } from '@/lib/api/bamboohr/client';
import { getAccessContextByEmail, EmailBasedAccessContext } from '@/lib/auth/manager-access';

// ============================================================================
// Types
// ============================================================================

export interface QuebecEmployee {
  email: string;
  name: string;
  department: string | null;
  jobTitle: string | null;
  supervisorEmail: string | null;
}

export interface WeeklyCompliance {
  weekStart: string; // ISO date string (Monday)
  weekEnd: string;   // ISO date string (Sunday)
  officeDays: number;
  remoteDays: number;
  totalDays: number;
  isCompliant: boolean; // true if officeDays >= 2
  dailyBreakdown: {
    date: string;
    location: 'Office' | 'Remote' | 'Unknown';
    hours: number;
  }[];
}

export interface EmployeeComplianceRecord {
  employee: QuebecEmployee;
  weeks: WeeklyCompliance[];
  totalOfficeDays: number;
  totalRemoteDays: number;
  totalWeeks: number;
  compliantWeeks: number;
  complianceRate: number; // percentage
  currentWeekStatus: 'Compliant' | 'At Risk' | 'Non-Compliant' | 'No Data';
}

export interface QuebecComplianceReport {
  generatedAt: string;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalQuebecEmployees: number;
    employeesWithData: number;
    overallComplianceRate: number;
    currentWeekCompliant: number;
    currentWeekAtRisk: number;
    currentWeekNonCompliant: number;
  };
  employees: EmployeeComplianceRecord[];
  accessContext: EmailBasedAccessContext | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the Monday of the week for a given date
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the Sunday of the week for a given date
 */
function getWeekEnd(date: Date): Date {
  const weekStart = getWeekStart(date);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return weekEnd;
}

/**
 * Format date as ISO string (YYYY-MM-DD)
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Check if employee is located in Quebec
 */
function isQuebecEmployee(employee: BambooHREmployee): boolean {
  const location = employee.location?.toLowerCase() || '';
  return (
    location.includes('quebec') ||
    location.includes('québec') ||
    location.includes('qc') ||
    location.includes('montreal') ||
    location.includes('montréal') ||
    location.includes('laval') ||
    location.includes('gatineau') ||
    location.includes('sherbrooke') ||
    location.includes('trois-rivières') ||
    location.includes('longueuil')
  );
}

/**
 * Group attendance records by week
 */
function groupByWeek(
  records: OfficeAttendanceRecord[],
  startDate: Date,
  endDate: Date
): Map<string, OfficeAttendanceRecord[]> {
  const weekMap = new Map<string, OfficeAttendanceRecord[]>();

  // Initialize all weeks in the range
  let current = getWeekStart(startDate);
  while (current <= endDate) {
    const weekKey = formatDate(current);
    weekMap.set(weekKey, []);
    current.setDate(current.getDate() + 7);
  }

  // Group records into weeks
  for (const record of records) {
    const weekStart = getWeekStart(record.date);
    const weekKey = formatDate(weekStart);
    if (weekMap.has(weekKey)) {
      weekMap.get(weekKey)!.push(record);
    }
  }

  return weekMap;
}

/**
 * Calculate weekly compliance for an employee
 */
function calculateWeeklyCompliance(
  weeklyRecords: Map<string, OfficeAttendanceRecord[]>
): WeeklyCompliance[] {
  const weeks: WeeklyCompliance[] = [];

  for (const [weekStartStr, records] of weeklyRecords) {
    const weekStart = new Date(weekStartStr);
    const weekEnd = getWeekEnd(weekStart);

    let officeDays = 0;
    let remoteDays = 0;
    const dailyBreakdown: WeeklyCompliance['dailyBreakdown'] = [];

    // Count unique days by location
    const dayLocations = new Map<string, { location: 'Office' | 'Remote' | 'Unknown'; hours: number }>();

    for (const record of records) {
      const dateKey = formatDate(record.date);
      const existing = dayLocations.get(dateKey);

      if (!existing || record.totalHours > existing.hours) {
        dayLocations.set(dateKey, {
          location: record.location,
          hours: record.totalHours
        });
      }
    }

    for (const [date, data] of dayLocations) {
      dailyBreakdown.push({
        date,
        location: data.location,
        hours: data.hours
      });

      if (data.location === 'Office') {
        officeDays++;
      } else if (data.location === 'Remote') {
        remoteDays++;
      }
    }

    // Sort daily breakdown by date
    dailyBreakdown.sort((a, b) => a.date.localeCompare(b.date));

    weeks.push({
      weekStart: weekStartStr,
      weekEnd: formatDate(weekEnd),
      officeDays,
      remoteDays,
      totalDays: officeDays + remoteDays,
      isCompliant: officeDays >= 2,
      dailyBreakdown
    });
  }

  // Sort weeks by start date (most recent first)
  weeks.sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  return weeks;
}

/**
 * Determine current week status
 */
function getCurrentWeekStatus(
  weeks: WeeklyCompliance[],
  today: Date
): 'Compliant' | 'At Risk' | 'Non-Compliant' | 'No Data' {
  const currentWeekStart = formatDate(getWeekStart(today));
  const currentWeek = weeks.find((w) => w.weekStart === currentWeekStart);

  if (!currentWeek || currentWeek.totalDays === 0) {
    return 'No Data';
  }

  if (currentWeek.officeDays >= 2) {
    return 'Compliant';
  }

  // Calculate remaining work days in the week
  const dayOfWeek = today.getDay();
  const remainingDays = dayOfWeek === 0 ? 0 : 5 - dayOfWeek; // Assuming M-F work week

  if (currentWeek.officeDays + remainingDays >= 2) {
    return 'At Risk';
  }

  return 'Non-Compliant';
}

// ============================================================================
// Main Action
// ============================================================================

/**
 * Generate Quebec office attendance compliance report
 */
export async function getQuebecComplianceReport(
  filterEmail?: string,
  weeksBack: number = 4
): Promise<QuebecComplianceReport> {
  const today = new Date();
  const endDate = getWeekEnd(today);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (weeksBack * 7) + 1);

  // Get access context if email provided
  let accessContext: EmailBasedAccessContext | null = null;
  let allowedEmails: string[] | undefined = undefined;

  if (filterEmail && filterEmail.trim()) {
    accessContext = await getAccessContextByEmail(filterEmail);
    allowedEmails = accessContext.allowedEmails;
  }

  // Get all employees from BambooHR
  const allEmployees = await fetchEmployeeDirectory();

  // Filter to Quebec employees only
  let quebecEmployees = allEmployees.filter(
    (emp) => isQuebecEmployee(emp) && emp.workEmail && emp.status?.toLowerCase() !== 'inactive'
  );

  // Apply access control filter
  if (allowedEmails && allowedEmails.length > 0) {
    quebecEmployees = quebecEmployees.filter(
      (emp) => emp.workEmail && allowedEmails!.includes(emp.workEmail.toLowerCase())
    );
  }

  // Get emails for BigQuery query
  const quebecEmails = quebecEmployees
    .map((emp) => emp.workEmail!)
    .filter(Boolean);

  // Fetch attendance data from BigQuery
  const attendanceData = await fetchOfficeAttendanceData(
    startDate,
    endDate,
    quebecEmails.length > 0 ? quebecEmails : undefined
  );

  // Group attendance by employee
  const attendanceByEmployee = new Map<string, OfficeAttendanceRecord[]>();
  for (const record of attendanceData) {
    const existing = attendanceByEmployee.get(record.email) || [];
    existing.push(record);
    attendanceByEmployee.set(record.email, existing);
  }

  // Build compliance records for each employee
  const employeeRecords: EmployeeComplianceRecord[] = [];
  let totalCompliantWeeks = 0;
  let totalWeeksWithData = 0;
  let currentWeekCompliant = 0;
  let currentWeekAtRisk = 0;
  let currentWeekNonCompliant = 0;

  for (const emp of quebecEmployees) {
    const email = emp.workEmail!.toLowerCase();
    const empAttendance = attendanceByEmployee.get(email) || [];

    const weeklyRecords = groupByWeek(empAttendance, startDate, endDate);
    const weeks = calculateWeeklyCompliance(weeklyRecords);

    const weeksWithData = weeks.filter((w) => w.totalDays > 0);
    const compliantWeeks = weeksWithData.filter((w) => w.isCompliant).length;
    const complianceRate = weeksWithData.length > 0
      ? Math.round((compliantWeeks / weeksWithData.length) * 100)
      : 0;

    const totalOfficeDays = weeks.reduce((sum, w) => sum + w.officeDays, 0);
    const totalRemoteDays = weeks.reduce((sum, w) => sum + w.remoteDays, 0);

    const currentWeekStatus = getCurrentWeekStatus(weeks, today);

    if (currentWeekStatus === 'Compliant') currentWeekCompliant++;
    else if (currentWeekStatus === 'At Risk') currentWeekAtRisk++;
    else if (currentWeekStatus === 'Non-Compliant') currentWeekNonCompliant++;

    totalCompliantWeeks += compliantWeeks;
    totalWeeksWithData += weeksWithData.length;

    employeeRecords.push({
      employee: {
        email,
        name: emp.displayName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || email,
        department: emp.department || null,
        jobTitle: emp.jobTitle || null,
        supervisorEmail: emp.supervisorEmail || null
      },
      weeks,
      totalOfficeDays,
      totalRemoteDays,
      totalWeeks: weeksWithData.length,
      compliantWeeks,
      complianceRate,
      currentWeekStatus
    });
  }

  // Sort by compliance rate (lowest first to highlight issues)
  employeeRecords.sort((a, b) => {
    // Non-compliant current week first
    const statusOrder = { 'Non-Compliant': 0, 'At Risk': 1, 'No Data': 2, 'Compliant': 3 };
    const statusDiff = statusOrder[a.currentWeekStatus] - statusOrder[b.currentWeekStatus];
    if (statusDiff !== 0) return statusDiff;

    // Then by overall compliance rate
    return a.complianceRate - b.complianceRate;
  });

  const overallComplianceRate = totalWeeksWithData > 0
    ? Math.round((totalCompliantWeeks / totalWeeksWithData) * 100)
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    dateRange: {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate)
    },
    summary: {
      totalQuebecEmployees: quebecEmployees.length,
      employeesWithData: employeeRecords.filter((e) => e.totalWeeks > 0).length,
      overallComplianceRate,
      currentWeekCompliant,
      currentWeekAtRisk,
      currentWeekNonCompliant
    },
    employees: employeeRecords,
    accessContext
  };
}

/**
 * Get compliance trend over time
 */
export async function getComplianceTrend(
  filterEmail?: string,
  weeksBack: number = 12
): Promise<{
  weeks: {
    weekStart: string;
    complianceRate: number;
    compliantCount: number;
    nonCompliantCount: number;
    totalEmployees: number;
  }[];
}> {
  const report = await getQuebecComplianceReport(filterEmail, weeksBack);

  // Aggregate by week
  const weekStats = new Map<string, {
    compliant: number;
    nonCompliant: number;
    total: number;
  }>();

  for (const emp of report.employees) {
    for (const week of emp.weeks) {
      if (week.totalDays === 0) continue;

      const stats = weekStats.get(week.weekStart) || { compliant: 0, nonCompliant: 0, total: 0 };
      stats.total++;
      if (week.isCompliant) {
        stats.compliant++;
      } else {
        stats.nonCompliant++;
      }
      weekStats.set(week.weekStart, stats);
    }
  }

  const weeks = Array.from(weekStats.entries())
    .map(([weekStart, stats]) => ({
      weekStart,
      complianceRate: stats.total > 0 ? Math.round((stats.compliant / stats.total) * 100) : 0,
      compliantCount: stats.compliant,
      nonCompliantCount: stats.nonCompliant,
      totalEmployees: stats.total
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return { weeks };
}

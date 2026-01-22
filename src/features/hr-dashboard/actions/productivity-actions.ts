'use server';

import {
  getManagerAccessContext,
  getAccessibleEmployeeIds,
  canAccessEmployeeData,
  filterAccessibleEmployees
} from '@/lib/auth/manager-access';
import {
  getActiveEmployees,
  getEmployeeById,
  getEmployeeProductivity,
  getTeamProductivity,
  getProductivitySummaryByDateRange,
  getProductivityTrend,
  getDepartmentStats
} from '@/lib/db/queries';
import type { Employee, ProductivityDaily } from '@/lib/db/queries';

// ============================================================================
// Types
// ============================================================================

export interface TeamProductivityResult {
  data: {
    employeeId: number;
    displayName: string;
    email: string;
    department: string | null;
    avgProductivityScore: number | null;
    totalProductiveHours: number;
    totalHours: number;
    daysTracked: number;
  }[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ProductivitySummary {
  totalEmployees: number;
  avgProductivityScore: number;
  totalProductiveHours: number;
  totalTrackedHours: number;
  productivePercent: number;
}

export interface ProductivityTrendPoint {
  date: string;
  avgProductivityScore: number;
  totalProductiveHours: number;
  employeeCount: number;
}

export interface DepartmentStat {
  department: string;
  employeeCount: number;
  avgProductivityScore: number;
  totalProductiveHours: number;
}

// ============================================================================
// Team Productivity Actions
// ============================================================================

/**
 * Get paginated team productivity data
 */
export async function getTeamProductivityData(params: {
  startDate: Date;
  endDate: Date;
  page?: number;
  pageSize?: number;
  department?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}): Promise<TeamProductivityResult> {
  const {
    startDate,
    endDate,
    page = 1,
    pageSize = 20,
    department,
    search,
    sortBy = 'displayName',
    sortOrder = 'asc'
  } = params;

  const context = await getManagerAccessContext();
  if (!context) {
    return { data: [], total: 0, page, pageSize, hasMore: false };
  }

  // Get accessible employee IDs
  let employeeIds: number[];

  if (context.canAccessAllEmployees) {
    // HR admin - get all active employees
    const employees = await getActiveEmployees();
    employeeIds = employees.map((e) => e.EMPLOYEE_ID);
  } else {
    employeeIds = await getAccessibleEmployeeIds();
  }

  if (employeeIds.length === 0 && !context.canAccessAllEmployees) {
    return { data: [], total: 0, page, pageSize, hasMore: false };
  }

  // Get productivity summary by date range
  const summaryData = await getProductivitySummaryByDateRange(
    employeeIds,
    startDate,
    endDate
  );

  // Transform and filter data
  let data = summaryData.map((row) => ({
    employeeId: row.EMPLOYEE_ID,
    displayName: row.DISPLAY_NAME,
    email: '', // Will be filled
    department: row.DEPARTMENT,
    avgProductivityScore: row.AVG_PRODUCTIVITY_SCORE,
    totalProductiveHours: row.TOTAL_PRODUCTIVE_HOURS,
    totalHours: row.TOTAL_HOURS,
    daysTracked: row.DAYS_TRACKED
  }));

  // Apply filters
  if (department) {
    data = data.filter(
      (d) => d.department?.toLowerCase() === department.toLowerCase()
    );
  }

  if (search) {
    const searchLower = search.toLowerCase();
    data = data.filter(
      (d) =>
        d.displayName.toLowerCase().includes(searchLower) ||
        d.email.toLowerCase().includes(searchLower)
    );
  }

  // Sort
  data.sort((a, b) => {
    let aVal: string | number | null;
    let bVal: string | number | null;

    switch (sortBy) {
      case 'avgProductivityScore':
        aVal = a.avgProductivityScore;
        bVal = b.avgProductivityScore;
        break;
      case 'totalProductiveHours':
        aVal = a.totalProductiveHours;
        bVal = b.totalProductiveHours;
        break;
      case 'daysTracked':
        aVal = a.daysTracked;
        bVal = b.daysTracked;
        break;
      default:
        aVal = a.displayName;
        bVal = b.displayName;
    }

    if (aVal === null) return 1;
    if (bVal === null) return -1;
    if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  // Paginate
  const total = data.length;
  const offset = (page - 1) * pageSize;
  const paginatedData = data.slice(offset, offset + pageSize);

  return {
    data: paginatedData,
    total,
    page,
    pageSize,
    hasMore: offset + pageSize < total
  };
}

// ============================================================================
// Individual Employee Productivity
// ============================================================================

/**
 * Get productivity data for a single employee
 */
export async function getEmployeeProductivityData(params: {
  employeeId: number;
  startDate: Date;
  endDate: Date;
}): Promise<{
  employee: Employee | null;
  productivity: ProductivityDaily[];
  summary: {
    avgProductivityScore: number | null;
    totalProductiveHours: number;
    totalHours: number;
    daysTracked: number;
  };
} | null> {
  const { employeeId, startDate, endDate } = params;

  // Validate access
  const hasAccess = await canAccessEmployeeData(employeeId);
  if (!hasAccess) {
    return null;
  }

  // Get employee details
  const employee = await getEmployeeById(employeeId);
  if (!employee) {
    return null;
  }

  // Get productivity data
  const productivity = await getEmployeeProductivity(
    employeeId,
    startDate,
    endDate
  );

  // Calculate summary
  const totalProductiveTime = productivity.reduce(
    (sum, p) => sum + p.PRODUCTIVE_TIME,
    0
  );
  const totalTime = productivity.reduce((sum, p) => sum + p.TOTAL_TIME, 0);
  const avgScore =
    productivity.length > 0
      ? productivity.reduce(
          (sum, p) => sum + (p.PRODUCTIVITY_SCORE || 0),
          0
        ) / productivity.length
      : null;

  return {
    employee,
    productivity,
    summary: {
      avgProductivityScore: avgScore ? Math.round(avgScore * 100) / 100 : null,
      totalProductiveHours: Math.round((totalProductiveTime / 3600) * 100) / 100,
      totalHours: Math.round((totalTime / 3600) * 100) / 100,
      daysTracked: productivity.length
    }
  };
}

// ============================================================================
// Productivity Summary
// ============================================================================

/**
 * Get aggregated productivity summary for dashboard cards
 */
export async function getProductivitySummaryData(params: {
  startDate: Date;
  endDate: Date;
}): Promise<ProductivitySummary> {
  const { startDate, endDate } = params;

  const context = await getManagerAccessContext();
  if (!context) {
    return {
      totalEmployees: 0,
      avgProductivityScore: 0,
      totalProductiveHours: 0,
      totalTrackedHours: 0,
      productivePercent: 0
    };
  }

  // Get accessible employee IDs
  let employeeIds: number[];

  if (context.canAccessAllEmployees) {
    const employees = await getActiveEmployees();
    employeeIds = employees.map((e) => e.EMPLOYEE_ID);
  } else {
    employeeIds = await getAccessibleEmployeeIds();
  }

  if (employeeIds.length === 0) {
    return {
      totalEmployees: 0,
      avgProductivityScore: 0,
      totalProductiveHours: 0,
      totalTrackedHours: 0,
      productivePercent: 0
    };
  }

  const summaryData = await getProductivitySummaryByDateRange(
    employeeIds,
    startDate,
    endDate
  );

  const totalProductiveHours = summaryData.reduce(
    (sum, d) => sum + d.TOTAL_PRODUCTIVE_HOURS,
    0
  );
  const totalHours = summaryData.reduce((sum, d) => sum + d.TOTAL_HOURS, 0);
  const avgScore =
    summaryData.length > 0
      ? summaryData.reduce(
          (sum, d) => sum + (d.AVG_PRODUCTIVITY_SCORE || 0),
          0
        ) / summaryData.length
      : 0;

  return {
    totalEmployees: summaryData.length,
    avgProductivityScore: Math.round(avgScore * 100) / 100,
    totalProductiveHours: Math.round(totalProductiveHours * 100) / 100,
    totalTrackedHours: Math.round(totalHours * 100) / 100,
    productivePercent:
      totalHours > 0
        ? Math.round((totalProductiveHours / totalHours) * 10000) / 100
        : 0
  };
}

// ============================================================================
// Productivity Trends
// ============================================================================

/**
 * Get productivity trend data for charts
 */
export async function getProductivityTrendData(params: {
  startDate: Date;
  endDate: Date;
}): Promise<ProductivityTrendPoint[]> {
  const { startDate, endDate } = params;

  const context = await getManagerAccessContext();
  if (!context) {
    return [];
  }

  // Get accessible employee IDs
  let employeeIds: number[];

  if (context.canAccessAllEmployees) {
    const employees = await getActiveEmployees();
    employeeIds = employees.map((e) => e.EMPLOYEE_ID);
  } else {
    employeeIds = await getAccessibleEmployeeIds();
  }

  if (employeeIds.length === 0) {
    return [];
  }

  const trendData = await getProductivityTrend(employeeIds, startDate, endDate);

  return trendData.map((row) => ({
    date: row.ACTIVITY_DATE.toISOString().split('T')[0],
    avgProductivityScore: row.AVG_PRODUCTIVITY_SCORE,
    totalProductiveHours: row.TOTAL_PRODUCTIVE_HOURS,
    employeeCount: row.EMPLOYEE_COUNT
  }));
}

// ============================================================================
// Department Statistics
// ============================================================================

/**
 * Get department-level statistics (HR admin only)
 */
export async function getDepartmentStatsData(params: {
  startDate: Date;
  endDate: Date;
}): Promise<DepartmentStat[]> {
  const { startDate, endDate } = params;

  const context = await getManagerAccessContext();
  if (!context || !context.isHRAdmin) {
    return [];
  }

  const stats = await getDepartmentStats(startDate, endDate);

  return stats.map((row) => ({
    department: row.DEPARTMENT,
    employeeCount: row.EMPLOYEE_COUNT,
    avgProductivityScore: row.AVG_PRODUCTIVITY_SCORE,
    totalProductiveHours: row.TOTAL_PRODUCTIVE_HOURS
  }));
}

// ============================================================================
// Utility Actions
// ============================================================================

/**
 * Get available departments for filtering
 */
export async function getDepartmentList(): Promise<string[]> {
  const context = await getManagerAccessContext();
  if (!context) {
    return [];
  }

  const employees = await getActiveEmployees();
  const departments = new Set<string>();

  for (const emp of employees) {
    if (emp.DEPARTMENT) {
      departments.add(emp.DEPARTMENT);
    }
  }

  return Array.from(departments).sort();
}

/**
 * Get date range presets
 */
export async function getDateRangePresets(): Promise<{
  label: string;
  value: string;
  startDate: Date;
  endDate: Date;
}[]> {
  const today = new Date();
  const endDate = new Date(today);

  return [
    {
      label: 'Last 7 days',
      value: '7d',
      startDate: new Date(today.setDate(today.getDate() - 7)),
      endDate
    },
    {
      label: 'Last 14 days',
      value: '14d',
      startDate: new Date(new Date().setDate(new Date().getDate() - 14)),
      endDate
    },
    {
      label: 'Last 30 days',
      value: '30d',
      startDate: new Date(new Date().setDate(new Date().getDate() - 30)),
      endDate
    },
    {
      label: 'This month',
      value: 'this_month',
      startDate: new Date(new Date().setDate(1)),
      endDate
    },
    {
      label: 'Last month',
      value: 'last_month',
      startDate: new Date(
        new Date().getFullYear(),
        new Date().getMonth() - 1,
        1
      ),
      endDate: new Date(new Date().getFullYear(), new Date().getMonth(), 0)
    }
  ];
}

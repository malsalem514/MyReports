import { z } from 'zod';

// ============================================================================
// Configuration
// ============================================================================

const BAMBOOHR_API_KEY = process.env.BAMBOOHR_API_KEY || '597304a7ac08d727fe883570b8fc725f57b49660';
const BAMBOOHR_SUBDOMAIN = process.env.BAMBOOHR_SUBDOMAIN || 'jestais';
const BAMBOOHR_BASE_URL = `https://api.bamboohr.com/api/gateway.php/${BAMBOOHR_SUBDOMAIN}/v1`;

// ============================================================================
// Zod Schemas for Type Safety
// ============================================================================

export const BambooHREmployeeSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  preferredName: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  workPhone: z.string().optional().nullable(),
  mobilePhone: z.string().optional().nullable(),
  workEmail: z.string().email().optional().nullable(),
  department: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  division: z.string().optional().nullable(),
  supervisor: z.string().optional().nullable(),
  supervisorId: z.string().optional().nullable(),
  supervisorEId: z.string().optional().nullable(),
  supervisorEmail: z.string().email().optional().nullable(),
  hireDate: z.string().optional().nullable(),
  employmentStatus: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable()
});

export type BambooHREmployee = z.infer<typeof BambooHREmployeeSchema>;

export const BambooHRDirectorySchema = z.object({
  fields: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string()
    })
  ),
  employees: z.array(BambooHREmployeeSchema)
});

export type BambooHRDirectory = z.infer<typeof BambooHRDirectorySchema>;

// ============================================================================
// API Client
// ============================================================================

/**
 * Make authenticated request to BambooHR API
 */
async function bambooFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BAMBOOHR_BASE_URL}${endpoint}`;
  const auth = Buffer.from(`${BAMBOOHR_API_KEY}:x`).toString('base64');

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    throw new BambooHRError(
      `BambooHR API error: ${response.status} ${response.statusText}`,
      response.status
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Fetch employee directory with all fields
 */
export async function fetchEmployeeDirectory(): Promise<BambooHREmployee[]> {
  const fields = [
    'id',
    'displayName',
    'firstName',
    'lastName',
    'preferredName',
    'jobTitle',
    'workPhone',
    'mobilePhone',
    'workEmail',
    'department',
    'location',
    'division',
    'supervisor',
    'supervisorId',
    'supervisorEId',
    'hireDate',
    'employmentStatus',
    'status',
    'photoUrl'
  ];

  try {
    const data = await bambooFetch<{ employees: unknown[] }>(
      `/employees/directory?fields=${fields.join(',')}`
    );

    const employees: BambooHREmployee[] = [];
    for (const emp of data.employees || []) {
      try {
        const validated = BambooHREmployeeSchema.parse(emp);
        employees.push(validated);
      } catch (error) {
        console.warn('Invalid employee from BambooHR:', emp, error);
      }
    }

    return employees;
  } catch (error) {
    console.error('Failed to fetch BambooHR directory:', error);
    throw error;
  }
}

/**
 * Fetch single employee details
 */
export async function fetchEmployee(
  employeeId: string
): Promise<BambooHREmployee | null> {
  const fields = [
    'id',
    'displayName',
    'firstName',
    'lastName',
    'preferredName',
    'jobTitle',
    'workPhone',
    'mobilePhone',
    'workEmail',
    'department',
    'location',
    'division',
    'supervisor',
    'supervisorId',
    'supervisorEId',
    'hireDate',
    'employmentStatus',
    'status',
    'photoUrl'
  ];

  try {
    const data = await bambooFetch<Record<string, unknown>>(
      `/employees/${employeeId}?fields=${fields.join(',')}`
    );

    return BambooHREmployeeSchema.parse({ id: employeeId, ...data });
  } catch (error) {
    if (error instanceof BambooHRError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Fetch all active employees
 */
export async function fetchActiveEmployees(): Promise<BambooHREmployee[]> {
  const allEmployees = await fetchEmployeeDirectory();
  return allEmployees.filter(
    (emp) => emp.status?.toLowerCase() !== 'inactive' && emp.workEmail
  );
}

/**
 * Fetch employees by department
 */
export async function fetchEmployeesByDepartment(
  department: string
): Promise<BambooHREmployee[]> {
  const allEmployees = await fetchEmployeeDirectory();
  return allEmployees.filter(
    (emp) =>
      emp.department?.toLowerCase() === department.toLowerCase() &&
      emp.status?.toLowerCase() !== 'inactive'
  );
}

/**
 * Get supervisor email for an employee
 * BambooHR doesn't always include supervisor email, so we may need to look it up
 */
export async function getSupervisorEmail(
  supervisorId: string | null | undefined
): Promise<string | null> {
  if (!supervisorId) return null;

  try {
    const supervisor = await fetchEmployee(supervisorId);
    return supervisor?.workEmail || null;
  } catch {
    return null;
  }
}

/**
 * Build supervisor relationships map
 */
export async function buildSupervisorMap(): Promise<
  Map<string, { supervisorId: string; supervisorEmail: string | null }>
> {
  const employees = await fetchEmployeeDirectory();
  const map = new Map<
    string,
    { supervisorId: string; supervisorEmail: string | null }
  >();

  // First pass: build email lookup
  const emailById = new Map<string, string>();
  for (const emp of employees) {
    if (emp.workEmail) {
      emailById.set(emp.id, emp.workEmail);
    }
  }

  // Second pass: build supervisor map
  for (const emp of employees) {
    if (emp.supervisorId || emp.supervisorEId) {
      const supId = emp.supervisorId || emp.supervisorEId;
      if (supId) {
        map.set(emp.id, {
          supervisorId: supId,
          supervisorEmail: emailById.get(supId) || null
        });
      }
    }
  }

  return map;
}

/**
 * Fetch departments list
 */
export async function fetchDepartments(): Promise<string[]> {
  const employees = await fetchEmployeeDirectory();
  const departments = new Set<string>();

  for (const emp of employees) {
    if (emp.department) {
      departments.add(emp.department);
    }
  }

  return Array.from(departments).sort();
}

/**
 * Fetch reporting structure for a manager
 */
export async function fetchReportingStructure(
  managerId: string
): Promise<BambooHREmployee[]> {
  const allEmployees = await fetchActiveEmployees();

  // Find direct and indirect reports
  const reports: BambooHREmployee[] = [];
  const visited = new Set<string>();

  function findReports(supId: string): void {
    for (const emp of allEmployees) {
      if (
        (emp.supervisorId === supId || emp.supervisorEId === supId) &&
        !visited.has(emp.id)
      ) {
        visited.add(emp.id);
        reports.push(emp);
        findReports(emp.id);
      }
    }
  }

  findReports(managerId);
  return reports;
}

// ============================================================================
// Transform Functions
// ============================================================================

/**
 * Transform BambooHR employee to our internal format
 */
export function transformEmployee(emp: BambooHREmployee): {
  bamboohrId: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  department: string | null;
  division: string | null;
  location: string | null;
  workEmail: string | null;
  supervisorEmail: string | null;
  hireDate: Date | null;
  employmentStatus: string | null;
  isActive: boolean;
} {
  return {
    bamboohrId: emp.id,
    email: emp.workEmail || `${emp.firstName}.${emp.lastName}@unknown.com`,
    firstName: emp.firstName || 'Unknown',
    lastName: emp.lastName || 'Unknown',
    jobTitle: emp.jobTitle || null,
    department: emp.department || null,
    division: emp.division || null,
    location: emp.location || null,
    workEmail: emp.workEmail || null,
    supervisorEmail: emp.supervisorEmail || null,
    hireDate: emp.hireDate ? new Date(emp.hireDate) : null,
    employmentStatus: emp.employmentStatus || emp.status || null,
    isActive: emp.status?.toLowerCase() !== 'inactive'
  };
}

// ============================================================================
// Custom Error Class
// ============================================================================

export class BambooHRError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'BambooHRError';
    this.statusCode = statusCode;
  }
}

// ============================================================================
// Health Check
// ============================================================================

export async function healthCheck(): Promise<boolean> {
  try {
    await bambooFetch('/meta/users');
    return true;
  } catch {
    return false;
  }
}

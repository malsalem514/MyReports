import { z } from 'zod';
import { cachified } from './cache';

// ============================================================================
// Configuration
// ============================================================================

const BAMBOOHR_API_KEY = process.env.BAMBOOHR_API_KEY || '';
const BAMBOOHR_SUBDOMAIN = process.env.BAMBOOHR_SUBDOMAIN || 'jestais';
const BAMBOOHR_BASE_URL = `https://api.bamboohr.com/api/gateway.php/${BAMBOOHR_SUBDOMAIN}/v1`;

// ============================================================================
// Schemas
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
  photoUrl: z.string().optional().nullable(),
});

export type BambooHREmployee = z.infer<typeof BambooHREmployeeSchema>;

export const TimeOffRequestSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  status: z.object({
    status: z.string(),
    lastChanged: z.string().optional(),
    lastChangedByUserId: z.string().optional(),
  }),
  name: z.string(),
  start: z.string(),
  end: z.string(),
  created: z.string().optional(),
  type: z.object({
    id: z.string(),
    name: z.string(),
    icon: z.string().optional(),
  }),
  amount: z.object({
    unit: z.string(),
    amount: z.string(),
  }),
  notes: z.object({
    employee: z.string().optional(),
    manager: z.string().optional(),
  }).optional(),
});

export type TimeOffRequest = z.infer<typeof TimeOffRequestSchema>;

export interface PTORecord {
  employeeId: string;
  employeeEmail: string;
  employeeName: string;
  department: string;
  startDate: string;
  endDate: string;
  type: string;
  status: string;
  amount: number;
  unit: string;
}

// ============================================================================
// API Client
// ============================================================================

async function bambooFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${BAMBOOHR_BASE_URL}${endpoint}`;
  const authHeader = Buffer.from(`${BAMBOOHR_API_KEY}:x`).toString('base64');

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${authHeader}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new BambooHRError(
      `BambooHR API error: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

// ============================================================================
// Fetch Functions
// ============================================================================

const EMPLOYEE_FIELDS = [
  'id', 'displayName', 'firstName', 'lastName', 'preferredName',
  'jobTitle', 'workPhone', 'mobilePhone', 'workEmail', 'department',
  'location', 'division', 'supervisor', 'supervisorId', 'supervisorEId',
  'hireDate', 'employmentStatus', 'status', 'photoUrl',
];

async function _fetchEmployeeDirectoryUncached(): Promise<BambooHREmployee[]> {
  // Use custom report API — the directory endpoint does NOT return
  // supervisorId/supervisorEId, which breaks the org tree for RLS.
  const data = await bambooFetch<{ employees: unknown[] }>(
    '/reports/custom?format=JSON',
    {
      method: 'POST',
      body: JSON.stringify({
        title: 'Employee Directory',
        filters: { lastChanged: { includeNull: 'yes' } },
        fields: EMPLOYEE_FIELDS,
      }),
    },
  );

  const employees: BambooHREmployee[] = [];
  for (const emp of data.employees || []) {
    try {
      employees.push(BambooHREmployeeSchema.parse(emp));
    } catch (error) {
      console.warn('Invalid employee from BambooHR:', emp, error);
    }
  }
  return employees;
}

export async function fetchEmployeeDirectory(): Promise<BambooHREmployee[]> {
  return cachified({
    key: 'bamboohr:employee-directory',
    ttl: 1000 * 60 * 60, // 1 hour
    staleWhileRevalidate: 1000 * 60 * 60 * 2,
    getFreshValue: _fetchEmployeeDirectoryUncached,
  });
}

export async function fetchActiveEmployees(): Promise<BambooHREmployee[]> {
  const all = await fetchEmployeeDirectory();
  return all.filter((emp) => emp.status?.toLowerCase() !== 'inactive' && emp.workEmail);
}

export async function fetchDepartments(): Promise<string[]> {
  const employees = await fetchEmployeeDirectory();
  const departments = new Set<string>();
  for (const emp of employees) {
    if (emp.department) departments.add(emp.department);
  }
  return Array.from(departments).sort();
}

export async function fetchReportingStructure(managerId: string): Promise<BambooHREmployee[]> {
  const allEmployees = await fetchActiveEmployees();
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

export async function buildSupervisorMap(): Promise<
  Map<string, { supervisorId: string; supervisorEmail: string | null }>
> {
  const employees = await fetchEmployeeDirectory();
  const map = new Map<string, { supervisorId: string; supervisorEmail: string | null }>();
  const emailById = new Map<string, string>();

  for (const emp of employees) {
    if (emp.workEmail) emailById.set(emp.id, emp.workEmail);
  }

  for (const emp of employees) {
    const supId = emp.supervisorId || emp.supervisorEId;
    if (supId) {
      map.set(emp.id, {
        supervisorId: supId,
        supervisorEmail: emailById.get(supId) || null,
      });
    }
  }
  return map;
}

export function transformEmployee(emp: BambooHREmployee) {
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
    isActive: emp.status?.toLowerCase() !== 'inactive',
  };
}

// ============================================================================
// Time Off
// ============================================================================

async function _fetchTimeOffRequestsUncached(
  startStr: string,
  endStr: string,
): Promise<PTORecord[]> {
  const data = await bambooFetch<unknown[]>(
    `/time_off/requests/?start=${startStr}&end=${endStr}&status=approved`,
  );

  const employees = await fetchEmployeeDirectory();
  const employeeMap = new Map(employees.map((e) => [e.id, e]));
  const ptoRecords: PTORecord[] = [];

  for (const item of data || []) {
    try {
      const request = TimeOffRequestSchema.parse(item);
      const emp = employeeMap.get(request.employeeId);
      ptoRecords.push({
        employeeId: request.employeeId,
        employeeEmail: emp?.workEmail?.toLowerCase() || '',
        employeeName: emp?.displayName || request.name || 'Unknown',
        department: emp?.department || 'Unknown',
        startDate: request.start,
        endDate: request.end,
        type: request.type.name,
        status: request.status.status,
        amount: parseFloat(request.amount.amount) || 0,
        unit: request.amount.unit,
      });
    } catch (error) {
      console.warn('Invalid time off request:', item, error);
    }
  }
  return ptoRecords;
}

export async function fetchTimeOffRequests(
  startDate: Date,
  endDate: Date,
): Promise<PTORecord[]> {
  const startStr = startDate.toISOString().split('T')[0] ?? '';
  const endStr = endDate.toISOString().split('T')[0] ?? '';
  try {
    return await cachified({
      key: `bamboohr:time-off:${startStr}:${endStr}`,
      ttl: 1000 * 60 * 5,
      staleWhileRevalidate: 1000 * 60 * 15,
      getFreshValue: () => _fetchTimeOffRequestsUncached(startStr, endStr),
    });
  } catch (error) {
    console.error('Failed to fetch time off requests:', error);
    return [];
  }
}

export async function fetchPTOByEmployee(
  startDate: Date,
  endDate: Date,
): Promise<Map<string, PTORecord[]>> {
  const records = await fetchTimeOffRequests(startDate, endDate);
  const map = new Map<string, PTORecord[]>();
  for (const record of records) {
    if (!record.employeeEmail) continue;
    const existing = map.get(record.employeeEmail) || [];
    existing.push(record);
    map.set(record.employeeEmail, existing);
  }
  return map;
}

// ============================================================================
// Error & Health
// ============================================================================

export class BambooHRError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'BambooHRError';
    this.statusCode = statusCode;
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    await bambooFetch('/meta/users');
    return true;
  } catch {
    return false;
  }
}

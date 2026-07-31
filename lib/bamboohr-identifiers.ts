interface BambooHRSupervisorFields {
  supervisorId?: string | null;
  supervisorEId?: string | null;
}

/**
 * TL_EMPLOYEES is keyed by BambooHR's internal employee ID. In custom reports,
 * supervisorId can contain the supervisor's employee number while
 * supervisorEId contains the internal employee ID used by employee records.
 */
export function getSupervisorEmployeeId(emp: BambooHRSupervisorFields): string | null {
  return emp.supervisorEId || emp.supervisorId || null;
}

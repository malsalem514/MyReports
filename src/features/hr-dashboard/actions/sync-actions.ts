'use server';

import {
  fetchActiveEmployees,
  buildSupervisorMap,
  transformEmployee
} from '@/lib/api/bamboohr/client';
import { fetchProductivityData } from '@/lib/api/bigquery/client';
import {
  upsertEmployee,
  updateEmployeeSupervisors,
  createSyncStatus,
  updateSyncStatus,
  getLatestSync,
  upsertProductivityData,
  getActiveEmployees,
  getEmployeeByEmail
} from '@/lib/db/queries';
import { executeTransaction } from '@/lib/db/oracle';

// ============================================================================
// Employee Sync (BambooHR → Oracle)
// ============================================================================

export interface SyncResult {
  success: boolean;
  syncId?: number;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  error?: string;
}

/**
 * Sync employees from BambooHR to Oracle database
 */
export async function syncEmployees(): Promise<SyncResult> {
  let syncId: number | undefined;

  try {
    // Create sync status record
    syncId = await createSyncStatus('employees', 'bamboohr');

    // Fetch employees from BambooHR
    const bambooEmployees = await fetchActiveEmployees();
    const supervisorMap = await buildSupervisorMap();

    let created = 0;
    let updated = 0;
    let failed = 0;

    // Process each employee
    for (const emp of bambooEmployees) {
      try {
        const transformed = transformEmployee(emp);

        // Get supervisor email from map
        const supInfo = supervisorMap.get(emp.id);
        if (supInfo?.supervisorEmail) {
          transformed.supervisorEmail = supInfo.supervisorEmail;
        }

        // Upsert to Oracle
        const affected = await upsertEmployee({
          BAMBOOHR_ID: transformed.bamboohrId,
          EMAIL: transformed.email,
          FIRST_NAME: transformed.firstName,
          LAST_NAME: transformed.lastName,
          JOB_TITLE: transformed.jobTitle,
          DEPARTMENT: transformed.department,
          DIVISION: transformed.division,
          LOCATION: transformed.location,
          WORK_EMAIL: transformed.workEmail,
          SUPERVISOR_EMAIL: transformed.supervisorEmail,
          HIRE_DATE: transformed.hireDate,
          EMPLOYMENT_STATUS: transformed.employmentStatus,
          IS_ACTIVE: transformed.isActive ? 1 : 0
        });

        if (affected > 0) {
          updated++;
        } else {
          created++;
        }
      } catch (error) {
        console.error(`Failed to sync employee ${emp.id}:`, error);
        failed++;
      }
    }

    // Update supervisor_id references after all employees are synced
    await updateEmployeeSupervisors();

    // Update sync status
    await updateSyncStatus(syncId, 'completed', {
      recordsProcessed: bambooEmployees.length,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsFailed: failed
    });

    return {
      success: true,
      syncId,
      recordsProcessed: bambooEmployees.length,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsFailed: failed
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('Employee sync failed:', error);

    if (syncId) {
      await updateSyncStatus(syncId, 'failed', {
        errorMessage
      });
    }

    return {
      success: false,
      syncId,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      error: errorMessage
    };
  }
}

// ============================================================================
// Productivity Sync (BigQuery → Oracle)
// ============================================================================

/**
 * Sync productivity data from BigQuery to Oracle
 * @param daysBack Number of days to sync (default 7)
 */
export async function syncProductivityData(
  daysBack: number = 7
): Promise<SyncResult> {
  let syncId: number | undefined;

  try {
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Create sync status record
    syncId = await createSyncStatus('productivity', 'bigquery', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      daysBack
    });

    // Get all active employees from Oracle
    const employees = await getActiveEmployees();
    const emailToEmployee = new Map(
      employees.map((e) => [e.EMAIL.toLowerCase(), e])
    );

    // Fetch productivity data from BigQuery
    const emails = employees.map((e) => e.EMAIL);
    const productivityData = await fetchProductivityData(
      startDate,
      endDate,
      emails
    );

    let created = 0;
    let updated = 0;
    let failed = 0;
    let processed = 0;

    // Process productivity data
    for (const record of productivityData) {
      try {
        processed++;

        // Match by email
        const email = record.email?.toLowerCase();
        if (!email) {
          failed++;
          continue;
        }

        const employee = emailToEmployee.get(email);
        if (!employee) {
          // Try to find by username
          console.warn(`No employee found for email: ${email}`);
          failed++;
          continue;
        }

        // Upsert to Oracle
        await upsertProductivityData({
          EMPLOYEE_ID: employee.EMPLOYEE_ID,
          ACTIVITY_DATE: record.date,
          USERNAME: record.username,
          EMAIL: record.email,
          PRODUCTIVE_TIME: record.productive_time,
          UNPRODUCTIVE_TIME: record.unproductive_time,
          NEUTRAL_TIME: record.neutral_time,
          TOTAL_TIME: record.total_time,
          PRODUCTIVITY_SCORE: record.productivity_score,
          ACTIVE_TIME: record.active_time,
          IDLE_TIME: record.idle_time,
          OFFLINE_TIME: record.offline_time,
          FOCUS_TIME: record.focus_time,
          COLLABORATION_TIME: record.collaboration_time
        });

        created++;
      } catch (error) {
        console.error(`Failed to sync productivity record:`, error);
        failed++;
      }
    }

    // Update sync status
    await updateSyncStatus(syncId, 'completed', {
      recordsProcessed: processed,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsFailed: failed
    });

    return {
      success: true,
      syncId,
      recordsProcessed: processed,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsFailed: failed
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('Productivity sync failed:', error);

    if (syncId) {
      await updateSyncStatus(syncId, 'failed', {
        errorMessage
      });
    }

    return {
      success: false,
      syncId,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      error: errorMessage
    };
  }
}

// ============================================================================
// Full Sync (Both)
// ============================================================================

export interface FullSyncResult {
  employees: SyncResult;
  productivity: SyncResult;
}

/**
 * Run full sync: employees first, then productivity
 */
export async function runFullSync(
  productivityDaysBack: number = 7
): Promise<FullSyncResult> {
  // Sync employees first
  const employeesResult = await syncEmployees();

  // Then sync productivity data
  const productivityResult = await syncProductivityData(productivityDaysBack);

  return {
    employees: employeesResult,
    productivity: productivityResult
  };
}

// ============================================================================
// Sync Status Queries
// ============================================================================

/**
 * Get last sync information
 */
export async function getLastSyncInfo(): Promise<{
  employees: { lastSync: Date | null; status: string | null };
  productivity: { lastSync: Date | null; status: string | null };
}> {
  const [employeesSync, productivitySync] = await Promise.all([
    getLatestSync('employees'),
    getLatestSync('productivity')
  ]);

  return {
    employees: {
      lastSync: employeesSync?.COMPLETED_AT || employeesSync?.STARTED_AT || null,
      status: employeesSync?.STATUS || null
    },
    productivity: {
      lastSync:
        productivitySync?.COMPLETED_AT || productivitySync?.STARTED_AT || null,
      status: productivitySync?.STATUS || null
    }
  };
}

// ============================================================================
// Manual Sync Triggers
// ============================================================================

/**
 * Trigger employee sync manually
 */
export async function triggerEmployeeSync(): Promise<SyncResult> {
  return syncEmployees();
}

/**
 * Trigger productivity sync manually
 */
export async function triggerProductivitySync(
  daysBack: number = 7
): Promise<SyncResult> {
  return syncProductivityData(daysBack);
}

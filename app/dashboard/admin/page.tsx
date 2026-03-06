import { getAccessContext, getRoleDiagnostics } from '@/lib/access';
import { fetchActiveEmployees } from '@/lib/bamboohr';
import { getRoleDefaults, TAB_KEYS } from '@/lib/tab-config';
import { initializeSchema } from '@/lib/oracle';
import { redirect } from 'next/navigation';
import { AdminClient } from './admin-client';

export default async function AdminPage() {
  const access = await getAccessContext();
  if (!access.isHRAdmin) {
    redirect('/dashboard');
  }

  let roleDefaults: Awaited<ReturnType<typeof getRoleDefaults>> = [];
  let directorUsers: Array<{
    name: string;
    email: string;
    department: string;
    jobTitle: string;
    reason: string;
  }> = [];
  let dataError: string | null = null;
  try {
    // Ensure tab tables exist (idempotent — safe to call on every load)
    await initializeSchema();
    const [defaults, employees] = await Promise.all([
      getRoleDefaults(),
      fetchActiveEmployees(),
    ]);
    roleDefaults = defaults;
    directorUsers = employees
      .filter((employee) => employee.workEmail)
      .map((employee) => ({
        employee,
        diagnostics: getRoleDiagnostics(employee),
      }))
      .filter(({ diagnostics }) => diagnostics.isDirector)
      .map(({ employee, diagnostics }) => ({
        name: employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.workEmail || '',
        email: employee.workEmail?.toLowerCase() || '',
        department: employee.department || '',
        jobTitle: employee.jobTitle || '',
        reason: diagnostics.reason || 'Matched director rule',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    dataError = error instanceof Error ? error.message : 'Admin datasource unavailable';
  }

  // Build role→tab→visible map
  const roles = ['hr-admin', 'director', 'manager', 'employee'] as const;
  const roleMap: Record<string, Record<string, boolean>> = {};
  for (const role of roles) {
    roleMap[role] = {};
    for (const tab of TAB_KEYS) {
      roleMap[role][tab] = false;
    }
  }
  for (const row of roleDefaults) {
    if (roleMap[row.ROLE_NAME]) {
      roleMap[row.ROLE_NAME][row.TAB_KEY] = row.VISIBLE === 1;
    }
  }

  return (
    <div className="space-y-4">
      {dataError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          Admin configuration data is currently unavailable. {dataError}
        </div>
      )}
      <AdminClient
        roles={[...roles]}
        tabs={[...TAB_KEYS]}
        roleMap={roleMap}
        directorUsers={directorUsers}
      />
    </div>
  );
}

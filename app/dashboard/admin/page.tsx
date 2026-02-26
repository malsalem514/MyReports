import { getAccessContext } from '@/lib/access';
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
  let dataError: string | null = null;
  try {
    // Ensure tab tables exist (idempotent — safe to call on every load)
    await initializeSchema();
    roleDefaults = await getRoleDefaults();
  } catch (error) {
    dataError = error instanceof Error ? error.message : 'Admin datasource unavailable';
  }

  // Build role→tab→visible map
  const roles = ['hr-admin', 'manager', 'employee'] as const;
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
      />
    </div>
  );
}

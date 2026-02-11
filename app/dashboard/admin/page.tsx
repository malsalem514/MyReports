import { getAccessContext } from '@/lib/access';
import { getRoleDefaults, getOverridesForEmail, TAB_KEYS } from '@/lib/tab-config';
import { redirect } from 'next/navigation';
import { AdminClient } from './admin-client';

export default async function AdminPage() {
  const access = await getAccessContext();
  if (!access.isHRAdmin) {
    redirect('/dashboard');
  }

  const roleDefaults = await getRoleDefaults();

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
    <AdminClient
      roles={[...roles]}
      tabs={[...TAB_KEYS]}
      roleMap={roleMap}
    />
  );
}

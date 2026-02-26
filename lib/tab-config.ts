import { query, execute } from './oracle';
import type { AccessContext } from './access';

// ============================================================================
// Tab Keys — single source of truth
// ============================================================================

export const TAB_KEYS = [
  'office-attendance',
  'timesheet-compare',
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

// ============================================================================
// Role Resolution
// ============================================================================

export function resolveRole(access: AccessContext): string {
  if (access.isHRAdmin) return 'hr-admin';
  if (access.isManager) return 'manager';
  return 'employee';
}

// ============================================================================
// Queries
// ============================================================================

interface TabRoleRow {
  ROLE_NAME: string;
  TAB_KEY: string;
  VISIBLE: number;
}

interface TabOverrideRow {
  EMAIL: string;
  TAB_KEY: string;
  VISIBLE: number;
}

// Hardcoded fallbacks when tables don't exist yet (before first sync/schema init)
const FALLBACK_ROLES: Record<string, TabKey[]> = {
  'hr-admin': [...TAB_KEYS],
  'manager': ['office-attendance', 'timesheet-compare'],
  'employee': ['office-attendance'],
};

/** Resolve visible tab keys for a user: role defaults + email overrides */
export async function getVisibleTabs(
  email: string,
  access: AccessContext,
): Promise<TabKey[]> {
  const role = resolveRole(access);
  const normalizedEmail = email.toLowerCase().trim();

  let roleDefaults: TabRoleRow[];
  let overrides: TabOverrideRow[];
  try {
    [roleDefaults, overrides] = await Promise.all([
      query<TabRoleRow>(
        `SELECT TAB_KEY, VISIBLE FROM TL_TAB_ROLES WHERE ROLE_NAME = :role`,
        { role },
      ),
      query<TabOverrideRow>(
        `SELECT TAB_KEY, VISIBLE FROM TL_TAB_OVERRIDES WHERE EMAIL = :email`,
        { email: normalizedEmail },
      ),
    ]);
  } catch (err: unknown) {
    // ORA-00942: table or view does not exist — fall back to hardcoded defaults
    if (err && typeof err === 'object' && 'errorNum' in err && (err as { errorNum: number }).errorNum === 942) {
      return FALLBACK_ROLES[role] || [...TAB_KEYS];
    }
    // Any datasource outage should not block the UI shell.
    console.warn('Tab visibility query failed, using fallback role defaults.', err);
    return FALLBACK_ROLES[role] || [...TAB_KEYS];
  }

  // If no role rows exist yet (tables exist but empty), use fallback
  if (roleDefaults.length === 0 && overrides.length === 0) {
    return FALLBACK_ROLES[role] || [...TAB_KEYS];
  }

  // Build visibility map: start with role defaults
  const visibility = new Map<string, boolean>();
  for (const row of roleDefaults) {
    visibility.set(row.TAB_KEY, row.VISIBLE === 1);
  }

  // Apply per-email overrides (wins over role)
  for (const row of overrides) {
    visibility.set(row.TAB_KEY, row.VISIBLE === 1);
  }

  // Return only visible tabs, preserving TAB_KEYS order
  return TAB_KEYS.filter((key) => visibility.get(key) === true);
}

/** All role×tab rows (for admin UI) */
export async function getRoleDefaults(): Promise<TabRoleRow[]> {
  return query<TabRoleRow>(
    `SELECT ROLE_NAME, TAB_KEY, VISIBLE FROM TL_TAB_ROLES ORDER BY ROLE_NAME, TAB_KEY`,
  );
}

/** Overrides for one email (for admin UI) */
export async function getOverridesForEmail(
  email: string,
): Promise<TabOverrideRow[]> {
  return query<TabOverrideRow>(
    `SELECT EMAIL, TAB_KEY, VISIBLE FROM TL_TAB_OVERRIDES WHERE EMAIL = :email ORDER BY TAB_KEY`,
    { email: email.toLowerCase().trim() },
  );
}

// ============================================================================
// Mutations (MERGE upserts)
// ============================================================================

export async function setRoleTabVisibility(
  role: string,
  tabKey: string,
  visible: boolean,
): Promise<void> {
  await execute(
    `MERGE INTO TL_TAB_ROLES t
     USING (SELECT :role AS ROLE_NAME, :tabKey AS TAB_KEY FROM DUAL) s
     ON (t.ROLE_NAME = s.ROLE_NAME AND t.TAB_KEY = s.TAB_KEY)
     WHEN MATCHED THEN UPDATE SET t.VISIBLE = :visible
     WHEN NOT MATCHED THEN INSERT (ROLE_NAME, TAB_KEY, VISIBLE) VALUES (:role, :tabKey, :visible)`,
    { role, tabKey, visible: visible ? 1 : 0 },
  );
}

export async function setOverride(
  email: string,
  tabKey: string,
  visible: boolean,
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  await execute(
    `MERGE INTO TL_TAB_OVERRIDES t
     USING (SELECT :email AS EMAIL, :tabKey AS TAB_KEY FROM DUAL) s
     ON (t.EMAIL = s.EMAIL AND t.TAB_KEY = s.TAB_KEY)
     WHEN MATCHED THEN UPDATE SET t.VISIBLE = :visible
     WHEN NOT MATCHED THEN INSERT (EMAIL, TAB_KEY, VISIBLE) VALUES (:email, :tabKey, :visible)`,
    { email: normalizedEmail, tabKey, visible: visible ? 1 : 0 },
  );
}

export async function removeOverride(
  email: string,
  tabKey: string,
): Promise<void> {
  await execute(
    `DELETE FROM TL_TAB_OVERRIDES WHERE EMAIL = :email AND TAB_KEY = :tabKey`,
    { email: email.toLowerCase().trim(), tabKey },
  );
}

import { redirect } from 'next/navigation';
import { query, execute } from './oracle';
import type { AccessContext } from './access';
import { normalizeEmail } from './email';

// ============================================================================
// Tab Keys — single source of truth
// ============================================================================

export const TAB_KEYS = [
  'office-attendance',
  'timesheet-compare',
  'working-hours',
  'bamboo-not-in-activtrak',
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_ROLES = [
  'root-admin',
  'hr-admin',
  'director',
  'manager',
  'employee',
] as const;

export type TabRole = (typeof TAB_ROLES)[number];

// ============================================================================
// Role Resolution
// ============================================================================

export function resolveRole(access: AccessContext): string {
  if (access.isRootAdmin) return 'root-admin';
  if (access.isHRAdmin) return 'hr-admin';
  if (access.isDirector) return 'director';
  if (access.isManager) return 'manager';
  return 'employee';
}

// ============================================================================
// Queries
// ============================================================================

export interface TabRoleRow {
  ROLE_NAME: string;
  TAB_KEY: string;
  VISIBLE: number;
}

export interface TabOverrideRow {
  EMAIL: string;
  TAB_KEY: string;
  VISIBLE: number;
}

// Hardcoded fallbacks when tables don't exist yet (before first sync/schema init)
const FALLBACK_ROLES: Record<string, TabKey[]> = {
  'hr-admin': [...TAB_KEYS],
  'root-admin': [...TAB_KEYS],
  'director': ['office-attendance', 'timesheet-compare', 'working-hours'],
  'manager': ['office-attendance', 'timesheet-compare', 'working-hours'],
  'employee': ['office-attendance'],
};

export function isTabKey(value: string): value is TabKey {
  return TAB_KEYS.includes(value as TabKey);
}

export function isTabRole(value: string): value is TabRole {
  return TAB_ROLES.includes(value as TabRole);
}

function getFallbackVisibilityMap(role: string): Map<TabKey, boolean> {
  const visibleTabs = new Set(FALLBACK_ROLES[role] || TAB_KEYS);
  return new Map(TAB_KEYS.map((tabKey) => [tabKey, visibleTabs.has(tabKey)]));
}

/** Resolve visible tab keys for a user: role defaults + email overrides */
export async function getVisibleTabs(
  email: string,
  access: AccessContext,
): Promise<TabKey[]> {
  const role = resolveRole(access);
  const normalizedEmail = normalizeEmail(email);

  if (access.isRootAdmin) {
    return [...TAB_KEYS];
  }

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

  // Build visibility map: start with hardcoded fallbacks so newly-added tabs
  // remain visible even if TL_TAB_ROLES hasn't been reseeded yet.
  const visibility = getFallbackVisibilityMap(role);
  for (const row of roleDefaults) {
    if (TAB_KEYS.includes(row.TAB_KEY as TabKey)) {
      visibility.set(row.TAB_KEY as TabKey, row.VISIBLE === 1);
    }
  }

  // Apply per-email overrides (wins over role)
  for (const row of overrides) {
    if (TAB_KEYS.includes(row.TAB_KEY as TabKey)) {
      visibility.set(row.TAB_KEY as TabKey, row.VISIBLE === 1);
    }
  }

  // Return only visible tabs, preserving TAB_KEYS order
  return TAB_KEYS.filter((key) => visibility.get(key) === true);
}

export async function requireVisibleTab(
  email: string,
  access: AccessContext,
  tabKey: TabKey,
): Promise<void> {
  if (access.isRootAdmin) {
    return;
  }

  const visibleTabs = await getVisibleTabs(email, access);
  if (!visibleTabs.includes(tabKey)) {
    redirect('/dashboard');
  }
}

/** All role×tab rows (for admin UI) */
export async function getRoleDefaults(): Promise<TabRoleRow[]> {
  const rolePlaceholders = TAB_ROLES.map((_, index) => `:role${index}`).join(', ');
  const tabPlaceholders = TAB_KEYS.map((_, index) => `:tab${index}`).join(', ');
  const binds = Object.fromEntries([
    ...TAB_ROLES.map((role, index) => [`role${index}`, role]),
    ...TAB_KEYS.map((tab, index) => [`tab${index}`, tab]),
  ]);
  return query<TabRoleRow>(
    `SELECT ROLE_NAME, TAB_KEY, VISIBLE
       FROM TL_TAB_ROLES
      WHERE ROLE_NAME IN (${rolePlaceholders})
        AND TAB_KEY IN (${tabPlaceholders})
      ORDER BY ROLE_NAME, TAB_KEY`,
    binds,
  );
}

/** Overrides for one email (for admin UI) */
export async function getOverridesForEmail(
  email: string,
): Promise<TabOverrideRow[]> {
  return query<TabOverrideRow>(
    `SELECT EMAIL, TAB_KEY, VISIBLE
       FROM TL_TAB_OVERRIDES
      WHERE EMAIL = :email
        AND TAB_KEY IN (${TAB_KEYS.map((_, index) => `:tab${index}`).join(', ')})
      ORDER BY TAB_KEY`,
    {
      email: normalizeEmail(email),
      ...Object.fromEntries(TAB_KEYS.map((tab, index) => [`tab${index}`, tab])),
    },
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
  if (!isTabRole(role)) {
    throw new Error(`Unsupported role: ${role}`);
  }
  if (!isTabKey(tabKey)) {
    throw new Error(`Unsupported tab: ${tabKey}`);
  }
  if (role === 'root-admin' && !visible) {
    throw new Error('Root admin visibility is fixed and cannot be disabled.');
  }

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
  if (!isTabKey(tabKey)) {
    throw new Error(`Unsupported tab: ${tabKey}`);
  }
  const normalizedEmail = normalizeEmail(email);
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
  if (!isTabKey(tabKey)) {
    throw new Error(`Unsupported tab: ${tabKey}`);
  }
  await execute(
    `DELETE FROM TL_TAB_OVERRIDES WHERE EMAIL = :email AND TAB_KEY = :tabKey`,
    { email: normalizeEmail(email), tabKey },
  );
}

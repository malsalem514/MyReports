import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isHRAdminEmail } from '@/lib/access';
import { getDevBypassEmail } from '@/lib/dev-bypass';
import {
  setRoleTabVisibility,
  setOverride,
  removeOverride,
  getOverridesForEmail,
  resolveRole,
  getRoleDefaults,
  TAB_KEYS,
} from '@/lib/tab-config';
import { initializeSchema } from '@/lib/oracle';
import { getAccessContextByEmail } from '@/lib/access';
import { getEmployees } from '@/lib/dashboard-data';

interface TabsRequestBody {
  action: 'set-role' | 'set-override' | 'remove-override';
  role?: string;
  email?: string;
  tabKey: string;
  visible?: boolean;
}

async function getAdminEmail(): Promise<string | null> {
  const bypassEmail = getDevBypassEmail('api-admin-tabs');
  if (bypassEmail) return bypassEmail.toLowerCase();

  const session = await auth();
  return session?.user?.email?.toLowerCase() || null;
}

export async function GET(request: NextRequest) {
  const adminEmail = await getAdminEmail();
  if (!adminEmail || !isHRAdminEmail(adminEmail)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Employee search for autocomplete
  const search = request.nextUrl.searchParams.get('search');
  if (search) {
    const employees = await getEmployees({ activeOnly: true });
    const q = search.toLowerCase();
    const matches = employees
      .filter((e) =>
        (e.email?.toLowerCase().includes(q)) ||
        (e.displayName?.toLowerCase().includes(q)) ||
        (e.firstName?.toLowerCase().includes(q)) ||
        (e.lastName?.toLowerCase().includes(q))
      )
      .slice(0, 10)
      .map((e) => ({
        email: e.email?.toLowerCase() || '',
        name: e.displayName || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
        department: e.department || '',
        jobTitle: e.jobTitle || '',
      }));
    return NextResponse.json({ employees: matches });
  }

  // Load overrides + resolved role for a specific email
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'Missing email or search param' }, { status: 400 });
  }

  await initializeSchema();

  const [overrideRows, accessCtx, roleDefaultRows] = await Promise.all([
    getOverridesForEmail(email),
    getAccessContextByEmail(email),
    getRoleDefaults(),
  ]);

  const role = resolveRole(accessCtx);
  const overrides: Record<string, boolean> = {};
  for (const row of overrideRows) {
    overrides[row.TAB_KEY] = row.VISIBLE === 1;
  }

  // Build role defaults for this user's role
  const roleDefaults: Record<string, boolean> = {};
  for (const tab of TAB_KEYS) {
    roleDefaults[tab] = false;
  }
  for (const row of roleDefaultRows) {
    if (row.ROLE_NAME === role) {
      roleDefaults[row.TAB_KEY] = row.VISIBLE === 1;
    }
  }

  return NextResponse.json({
    role,
    name: accessCtx.employeeName || email,
    isManager: accessCtx.isManager,
    overrides,
    roleDefaults,
  });
}

export async function POST(request: NextRequest) {
  const adminEmail = await getAdminEmail();
  if (!adminEmail || !isHRAdminEmail(adminEmail)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json()) as TabsRequestBody;
  const { action, role, email, tabKey, visible } = body;

  if (!action || !tabKey) {
    return NextResponse.json({ error: 'Missing action or tabKey' }, { status: 400 });
  }

  await initializeSchema();
  try {
    switch (action) {
      case 'set-role':
        if (!role || visible === undefined) {
          return NextResponse.json({ error: 'Missing role or visible' }, { status: 400 });
        }
        await setRoleTabVisibility(role, tabKey, visible);
        break;
      case 'set-override':
        if (!email || visible === undefined) {
          return NextResponse.json({ error: 'Missing email or visible' }, { status: 400 });
        }
        await setOverride(email, tabKey, visible);
        break;
      case 'remove-override':
        if (!email) {
          return NextResponse.json({ error: 'Missing email' }, { status: 400 });
        }
        await removeOverride(email, tabKey);
        break;
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Tab config error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

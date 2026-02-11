import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isHRAdminEmail } from '@/lib/access';
import {
  setRoleTabVisibility,
  setOverride,
  removeOverride,
  getOverridesForEmail,
} from '@/lib/tab-config';

interface TabsRequestBody {
  action: 'set-role' | 'set-override' | 'remove-override';
  role?: string;
  email?: string;
  tabKey: string;
  visible?: boolean;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || !isHRAdminEmail(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'Missing email param' }, { status: 400 });
  }

  const rows = await getOverridesForEmail(email);
  const overrides: Record<string, boolean> = {};
  for (const row of rows) {
    overrides[row.TAB_KEY] = row.VISIBLE === 1;
  }
  return NextResponse.json({ overrides });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || !isHRAdminEmail(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json()) as TabsRequestBody;
  const { action, role, email, tabKey, visible } = body;

  if (!action || !tabKey) {
    return NextResponse.json({ error: 'Missing action or tabKey' }, { status: 400 });
  }

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
